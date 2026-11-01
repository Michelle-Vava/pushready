// Where a path lives in git: which commit first added it, what still holds that
// commit, whether it ever reached a remote, and what other names the same
// content has had. This is the cluster that grew most in v0.2, and the one the
// shared-snapshot stage will reshape, so it is kept together here.
//
// Only commit hashes and ref names are read in this module; never the author,
// message or date (see "What it reads" in the README).
import { git, lines } from './git.js';
import { plural } from './text.js';

// Reasons the local clone cannot show the whole history, so "nothing found"
// cannot be trusted. Each entry carries the command that fixes it. `context` is
// the repoContext() for the same run: it already asked fsck for unreachable
// commits, and this reads whether that worked rather than asking again.
export function historyLimits(dir, context) {
  const read = (args) => {
    try {
      return git(dir, args).trim();
    } catch {
      return '';
    }
  };
  const limits = [];
  // git clone --depth, or actions/checkout without fetch-depth: 0.
  if (read(['rev-parse', '--is-shallow-repository']) === 'true') {
    limits.push({ reason: 'this is a shallow clone, so older commits are not here', fix: 'git fetch --unshallow' });
  }
  // git clone --single-branch narrows the refspec, so other branches were never fetched.
  const refspec = read(['config', '--get', 'remote.origin.fetch']);
  if (refspec && !refspec.includes('*')) {
    limits.push({ reason: 'only one branch was cloned, so other branches are not here', fix: 'git remote set-branches origin "*" && git fetch' });
  }
  // Gitlinks (mode 160000). A submodule's commits live in its own repository, so
  // nothing here can see the files inside it.
  const submodules = read(['ls-files', '--stage'])
    .split('\n')
    .filter((l) => l.startsWith('160000'))
    .map((l) => l.split('\t').slice(1).join('\t'))
    .filter(Boolean);
  if (submodules.length) {
    limits.push({
      reason: `${plural(submodules.length, 'submodule')} (${submodules.join(', ')}) ${submodules.length === 1 ? 'is' : 'are'} a separate repository, so files inside ${submodules.length === 1 ? 'it' : 'them'} are not checked`,
      fix: `run pushready inside ${submodules.length === 1 ? 'it' : 'each of them'}`,
    });
  }
  // Unreachable commits are searched, so say so when that search could not run.
  // fsck is the slowest call pushready makes, so it runs once, in repoContext(),
  // and its failure is read from there instead of being provoked a second time.
  if (context.fsckFailed) {
    limits.push({ reason: 'unreachable commits could not be listed, so amended or discarded ones were not checked', fix: 'git fsck --unreachable' });
  }
  return limits;
}

// --no-renames matters. git detects renames by default, and reports one as a
// single R entry rather than A + D, so --diff-filter=A never sees the new name:
// a notes.txt renamed to deploy.pem was missed completely. Turning detection off
// decomposes every rename back into an add of the new path and a delete of the
// old one, which is what "every name this content was ever committed under"
// needs. It is also cheaper, since the similarity search is skipped.
//
// Every path ever added in any commit this repository can still reach, by any
// route: a branch, a tag, a stash, the reflog, or nothing at all.
//
// --all covers every ref, which includes refs/stash — but only the newest stash
// is a ref. Older ones (stash@{1} and up) live in the stash reflog and are not
// reachable from anything --all walks, so they have to be named explicitly.
// --reflog adds commits this clone has moved off: amended away, or on a branch
// that was deleted. Dropped stashes leave the reflog too, so the commits that
// only git fsck can find are passed in as extra tips.
//
// -m matters too. By default "git log" shows no file changes at all for a merge
// commit, so a file first added *inside* one — typed in while resolving a
// conflict, say — was never listed and a key born in a merge was reported as
// "No private key files in git history". -m diffs a merge against each parent;
// a file that came in from one side shows up twice, which a Set absorbs.
export function listEverAdded(dir, tips) {
  const out = git(dir, ['log', '--all', '--reflog', ...tips, '-m', '--no-renames', '--diff-filter=A', '--name-only', '--pretty=format:', '-z']);
  return new Set(out.split('\0').filter(Boolean));
}

// Every stash entry's commit, newest first, so index n is stash@{n}.
function stashCommits(dir) {
  try {
    return lines(git(dir, ['stash', 'list', '--format=%H']));
  } catch {
    return [];
  }
}

// Commits no ref points at any more: amended away, on a deleted branch, or in a
// dropped stash. The object is still on disk and still recoverable, so a secret
// in one has not gone anywhere.
//
// --reflog covers what this clone did (amends, branch deletions); it does not
// cover a dropped stash, which leaves the reflog entirely. fsck finds those.
// --connectivity-only skips validating object contents, which is the slow part
// of fsck and is not what we are asking about.
//
// Returns the commits and whether fsck ran at all, because a failure here is not
// "no unreachable commits": it is a limit on what was checked, and historyLimits
// reports it as one. This is the only fsck pushready runs.
function unreachableCommits(dir) {
  try {
    const commits = git(dir, ['fsck', '--unreachable', '--connectivity-only', '--no-progress'])
      .split('\n')
      .flatMap((line) => {
        const [, type, sha] = line.trim().split(' ');
        return type === 'commit' && sha ? [sha] : [];
      });
    return { commits, ok: true };
  } catch {
    return { commits: [], ok: false };
  }
}

// Every rename git can see, as [oldName, newName]. This is the one place that
// *wants* rename detection on: listEverAdded turns it off to get all the names,
// and this turns it back on to learn which of those names share one file's
// content. Only run when there is something risky to explain, because detection
// is the expensive part of a history walk.
function renamePairs(dir) {
  try {
    // -z gives flat "R<score>\0old\0new\0" triplets, and --format= keeps commit
    // headers out of them, so the output is three fields per rename and nothing else.
    // -m for the same reason as listEverAdded: a rename done inside a merge
    // commit is otherwise invisible.
    const fields = git(dir, ['log', '--all', '-m', '--diff-filter=R', '--name-status', '-z', '--format=']).split('\0').filter(Boolean);
    const pairs = [];
    for (let i = 0; i + 2 < fields.length; i += 3) {
      if (fields[i].startsWith('R')) pairs.push([fields[i + 1], fields[i + 2]]);
    }
    return pairs;
  } catch {
    return [];
  }
}

// Renames as an undirected graph, so a chain (a → b → c) can be walked from any
// of its names. Undirected because it does not matter which way the rename went:
// every name in the chain has the same content sitting in history behind it.
export function renameGraph(dir) {
  const graph = new Map();
  const link = (a, b) => {
    if (!graph.has(a)) graph.set(a, new Set());
    graph.get(a).add(b);
  };
  for (const [from, to] of renamePairs(dir)) {
    link(from, to);
    link(to, from);
  }
  return graph;
}

// Every name this file's content has been committed under, the given one included.
export function namesFor(graph, path) {
  const seen = new Set([path]);
  const queue = [path];
  while (queue.length) {
    for (const next of graph.get(queue.pop()) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

// Read once per run: which branch we're on, whether a remote exists at all, and
// the commits that only a stash or fsck can reach. `fsckFailed` is read by
// historyLimits so that the limit is reported without a second fsck.
export function repoContext(dir) {
  const read = (args) => {
    try {
      return git(dir, args).trim();
    } catch {
      return '';
    }
  };
  // --abbrev-ref gives the literal word "HEAD" when detached.
  const branch = read(['rev-parse', '--abbrev-ref', 'HEAD']);
  const stashes = stashCommits(dir);
  const { commits: unreachable, ok } = unreachableCommits(dir);
  // Everything the history walks need as an explicit starting point, on top of --all.
  return { branch, detached: branch === 'HEAD', hasRemote: read(['remote']).length > 0, stashes, unreachable, fsckFailed: !ok, tips: [...stashes, ...unreachable] };
}

// Everything that keeps a commit alive, sorted into the kinds that need different
// advice. Branches and tags are history: cleaning them means a rewrite. A stash, a
// leftover ref such as filter-branch's refs/original, or a detached HEAD is not
// history, and the right fix is to drop the thing holding it.
function whereIs(dir, commit, context) {
  const read = (args) => {
    try {
      return git(dir, args);
    } catch {
      return '';
    }
  };
  const isAncestorOf = (tip) => {
    try {
      git(dir, ['merge-base', '--is-ancestor', commit, tip]);
      return true;
    } catch {
      return false;
    }
  };
  const refs = commit ? lines(read(['for-each-ref', '--contains', commit, '--format=%(refname)'])) : [];
  const under = (prefix) => refs.filter((r) => r.startsWith(prefix)).map((r) => r.slice(prefix.length));
  const branches = under('refs/heads/');
  // "origin/HEAD" is a pointer to another branch, not a branch of its own.
  const remotes = under('refs/remotes/').filter((r) => !r.endsWith('/HEAD'));
  const tags = under('refs/tags/');
  // refs/stash is only the newest stash, and is reported with the others below.
  const other = refs.filter((r) => !/^refs\/(heads|remotes|tags)\//.test(r) && r !== 'refs/stash');
  // Only worth asking when nothing else holds it: the point is to tell "only in a
  // stash" from "in history", not to list every stash that happens to include main.
  const transient = commit && !branches.length && !remotes.length && !tags.length;
  const stashes = transient ? context.stashes.flatMap((sha, n) => (isAncestorOf(sha) ? [`stash@{${n}}`] : [])) : [];
  const head = transient && context.detached && isAncestorOf('HEAD');
  // Nothing points at it: amended away, on a deleted branch, or a dropped stash.
  // The object survives until git collects it, so this is still a finding — but
  // it is not history, and a rewrite cannot reach it.
  const place = !commit
    ? 'unknown'
    : branches.length || remotes.length
      ? 'branch'
      : tags.length
        ? 'tag'
        : other.length
          ? 'ref'
          : head
            ? 'head'
            : stashes.length
              ? 'stash'
              : 'unreachable';
  return { branches, remotes, tags, refs: other, stashes, place };
}

// Where one risky path lives. Only commit hashes and ref names are read here;
// never the author, message or date (see "What it reads" in the README).
export function describePath(dir, path, names, present, context) {
  const read = (args) => {
    try {
      return git(dir, args);
    } catch {
      return '';
    }
  };
  // --no-renames for the same reason as listEverAdded: without it the commit
  // that introduced a renamed-in path is an R, and this would find nothing.
  // --full-history: with a pathspec, git simplifies merges and can prune the
  // untracked-files parent of a stash, so a file stashed with -u came back with
  // no commit at all. Without simplification the earliest add is always found.
  // -m so that a file born inside a merge commit has that commit as its origin.
  const addedIn = (p) => lines(read(['log', '--all', '--reflog', ...context.tips, '--full-history', '-m', '--no-renames', '--diff-filter=A', '--format=%H', '--reverse', '--', p]))[0] ?? '';
  const commit = addedIn(path);
  const where = whereIs(dir, commit, context);
  // Other names the same content has had. The commit, branch and "still in the
  // repo" columns all describe this name, because that is the finding; exposure
  // does not, because a leak is of content, not of a name. A file pushed as
  // notes.txt and only then renamed to deploy.pem has already left the machine,
  // even though the commit that created the name "deploy.pem" never went anywhere.
  const aliases = [...names].filter((n) => n !== path).sort();
  const remotes = new Set(where.remotes);
  for (const alias of aliases) {
    const at = addedIn(alias);
    if (at) for (const ref of whereIs(dir, at, context).remotes) remotes.add(ref);
  }
  // Remote-tracking refs are only as fresh as the last fetch, so "not on a remote"
  // is a statement about this clone, not about the server. A stash is the one
  // case where the strong claim holds regardless: stashes cannot be pushed.
  const exposure = remotes.size ? 'pushed' : where.place === 'stash' || !context.hasRemote ? 'local only' : 'not on a remote';
  // One branch is enough for the default output; prefer the one the user is on.
  const branch = where.branches.includes(context.branch) ? context.branch : where.branches[0] ?? where.remotes[0] ?? '';
  // Whether the branch you have checked out is one of the branches holding it.
  // "Not in the working tree" means "deleted" only if the file is on this
  // branch's history; a file living on someone else's branch was never here to
  // delete. Free: it reuses refs already read, with no extra git call.
  const onCurrentBranch = where.branches.includes(context.branch);
  return { path, present, commit, branch, ...where, onCurrentBranch, remotes: [...remotes].sort(), exposure, aliases };
}
