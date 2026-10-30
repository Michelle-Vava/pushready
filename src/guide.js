// The "what to do next" guide. Pure: it takes the results the checks produced
// and decides which steps apply and in what order. It never touches git or the
// filesystem, which is why it can be tested without running a single check.
//
// This is deliberately one function for now. It is the largest unit in the
// codebase; keeping it whole through v0.3.0 meant that release changed no
// behaviour. TODO(v0.3.4): split into one rule per step — rotate, data,
// gitignore-too-late, drop stash, delete ref, expire unreachable, rewrite,
// force-push — each with appliesTo(findings) and build(findings), same output.
// TODO(v0.3.5): rules return actions as data, not strings, for `pushready fix`.

export const DOCS = {
  removingData: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository',
  filterRepo: 'https://github.com/newren/git-filter-repo#how-do-i-install-it',
  support: 'https://support.github.com/',
};

// Double quotes work the same in bash, cmd and PowerShell, but only for paths
// without these characters. Anything else is handed over as a file list instead.
const HARD_TO_QUOTE = /["$`\\\n]/;
const MAX_PATHS_INLINE = 8;

function filterRepoCommand(paths) {
  if (paths.length > MAX_PATHS_INLINE || paths.some((p) => HARD_TO_QUOTE.test(p))) {
    return 'git filter-repo --invert-paths --paths-from-file paths.txt   (list one path per line in paths.txt)';
  }
  return `git filter-repo --invert-paths ${paths.map((p) => `--path "${p}"`).join(' ')}`;
}

/**
 * The "what to do next" guide, built from what the checks actually found.
 * Returns null when there is nothing in history to act on.
 *
 * pushready never runs any of this: the steps are for the user to run.
 */
export function exposureGuide(results, { detailed = false } = {}) {
  const withItems = results.filter((r) => r.items?.length);
  if (!withItems.length) return null;

  // Acknowledged findings are ones the user has already looked at and accepted,
  // so they stay on screen but drop out of the list of things to go and do.
  const pick = (ids) => withItems.filter((r) => ids.includes(r.id)).flatMap((r) => r.items).filter((i) => !i.acknowledged);
  // TODO(v0.3.1): these ids are hardcoded, so a new category added to
  // RISKY_CATEGORIES is silently left out of the guide. Derive the grouping from
  // category metadata (e.g. a `kind: 'credential' | 'data'` field) instead.
  const credentials = pick(['history-keys', 'history-credentials']);
  const data = pick(['history-data']);
  const all = [...credentials, ...data];
  if (!all.length) return null;
  const wasPushed = (i) => i.exposure === 'pushed';
  const names = (list) => list.map((i) => i.path).join(', ');

  // Where a file lives decides the tool. Branches and tags are history and need a
  // rewrite. A stash, a leftover ref or a detached HEAD is not history: telling
  // someone to run git filter-repo for a stash is the wrong advice, and the right
  // one is a single git stash drop. "unknown" is treated as history to be safe.
  const history = all.filter((i) => !['stash', 'ref', 'head', 'unreachable'].includes(i.place));
  const stashed = all.filter((i) => i.place === 'stash');
  const held = all.filter((i) => i.place === 'ref' || i.place === 'head');
  const unreachable = all.filter((i) => i.place === 'unreachable');

  const steps = [];
  if (credentials.length) {
    const pushed = credentials.filter(wasPushed);
    if (pushed.length) {
      steps.push([
        `Rotate or revoke these now: ${names(pushed)}.`,
        'They were pushed, so cleaning history will not un-leak them from clones, forks or caches.',
      ]);
    } else if (credentials.every((i) => i.place === 'stash')) {
      // Fetching cannot change this answer: a stash is never pushed.
      steps.push(['None of these have left your machine: a stash is never pushed, and nothing was committed to a branch.']);
    } else if (credentials.every((i) => i.place === 'unreachable')) {
      steps.push([
        'None of these are on a branch any more, and no remote-tracking branch has them, so they were probably never pushed.',
        'If you force-pushed to undo a mistake, the remote may still hold the old commit — rotate anything you cannot account for.',
      ]);
    } else {
      const first = [
        'None of these were pushed from this clone, so they probably never left your machine.',
        'Run "git fetch" if you are not sure, and rotate anything you cannot account for.',
      ];
      // Remote-tracking branches say nothing about tags, so for a file that is only
      // on a tag, "not on a remote" is a gap in what this clone can see, not a result.
      // TODO(v0.3.1): only credentials get this hedge. A data file that is only on
      // a tag is just as unknowable, and currently gets the plain reassurance.
      const tagOnly = credentials.filter((i) => i.place === 'tag' && i.exposure === 'not on a remote');
      if (tagOnly.length) {
        first.push(
          `Except that ${tagOnly.map((i) => `${i.path} is only on tag ${i.tags.join(', ')}`).join('; ')}, and this clone keeps no record of which tags were pushed.`,
          'If you have ever run "git push --tags" or "git push --follow-tags" here, treat it as pushed and rotate it.',
        );
      }
      steps.push(first);
    }
  }
  if (data.length) {
    const pushed = data.filter(wasPushed);
    steps.push(
      pushed.length
        ? [`Work out what ${names(pushed)} held and who it affects. Leaked data cannot be rotated.`]
        : [`Check what ${names(data)} holds before you push. Leaked data cannot be rotated.`],
    );
  }

  // The most common misunderstanding: adding a file to .gitignore after the fact.
  const ignored = all.filter((i) => i.ignored);
  if (ignored.length) {
    const tracked = ignored.filter((i) => i.present);
    const explain = [
      `.gitignore already lists ${names(ignored)}, but that does not undo anything git has already recorded.`,
      'It only stops a file being added in future: it does not remove anything from history.',
    ];
    if (tracked.length) {
      explain.push(
        `It also has no effect on a file git already tracks, which is why ${names(tracked)} is still in the repo.`,
        `Untrack it first: git rm --cached ${tracked.map((i) => `"${i.path}"`).join(' ')}`,
      );
    }
    steps.push(explain);
  }

  // Dropping an object's last holder leaves the object on disk until git's
  // garbage collection gets to it. Nothing left the machine, so this is a
  // tidy-up rather than a leak, and it is only spelled out under --history.
  const gcNote = detailed
    ? ['The commit itself stays on disk until git collects it. To clear it now: git reflog expire --expire-unreachable=now --all && git gc --prune=now']
    : [];

  if (stashed.length) {
    // Dropping stash@{0} renumbers the rest, so higher entries have to go first.
    const entries = [...new Set(stashed.flatMap((i) => i.stashes))].sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
    const drop = [
      `Drop the stash${entries.length === 1 ? '' : 'es'} holding ${names(stashed)}. ${stashed.length === 1 ? 'It is' : 'They are'} not in any commit on a branch, so there is no history to rewrite:`,
      ...entries.map((e) => `git stash drop ${e}`),
    ];
    if (entries.length > 1) drop.push('Drop them in that order: the numbers shift after each one.');
    drop.push('Check first with "git stash show -p <entry>" if you are not sure what else the stash holds.');
    steps.push([...drop, ...gcNote]);
  }

  if (held.length) {
    const refs = [...new Set(held.flatMap((i) => i.refs))];
    const lines = [`${names(held)} ${held.length === 1 ? 'is' : 'are'} not on any branch or tag, so there is no history to rewrite.`];
    if (refs.length) {
      lines.push(
        `${held.length === 1 ? 'It is' : 'They are'} kept alive only by: ${refs.join(', ')}.`,
        ...(refs.some((r) => r.startsWith('refs/original/'))
          ? ['refs/original/ is the backup git filter-branch leaves behind. It keeps the old commits reachable until you delete it:']
          : ['If that ref is a leftover you no longer need, deleting it is enough:']),
        ...refs.map((r) => `git update-ref -d "${r}"`),
      );
    }
    if (held.some((i) => i.place === 'head')) {
      lines.push(
        'You are on a detached HEAD, and the commit is only reachable from there.',
        'Check out a branch to leave it behind, or "git checkout -b <name>" to keep it — in which case it becomes history and needs the rewrite below.',
      );
    }
    steps.push([...lines, ...gcNote]);
  }

  if (unreachable.length) {
    const expire = [
      `${names(unreachable)} ${unreachable.length === 1 ? 'is in a commit' : 'are in commits'} nothing points at any more — amended away, on a deleted branch, or in a dropped stash.`,
      `There is no history to rewrite: no branch, tag or stash holds ${unreachable.length === 1 ? 'it' : 'them'}. But the ${unreachable.length === 1 ? 'commit is' : 'commits are'} still on disk and still recoverable until git collects ${unreachable.length === 1 ? 'it' : 'them'}.`,
      'Expire the reflog and collect it now:',
      'git reflog expire --expire=now --expire-unreachable=now --all && git gc --prune=now',
    ];
    if (detailed) {
      expire.push(
        'Until you do, "git fsck --unreachable" and "git reflog" can both still reach the commit.',
        'A clone made before you ran this keeps its own copy: cloning does not carry unreachable objects, but a copied folder does.',
      );
    }
    steps.push(expire);
  }

  if (history.length) {
    // A renamed file sits in history under every name it ever had, so a command
    // naming only the risky one looks like it worked and does not. Both the
    // explanation and the command have to cover the whole set.
    const renamed = history.filter((i) => i.aliases?.length);
    const paths = [...new Set(history.flatMap((i) => [i.path, ...(i.aliases ?? [])]))];
    const remove = [`Remove ${names(history)} from history yourself — pushready will not do it for you:`];
    if (renamed.length) {
      remove.push(
        `${renamed.map((i) => `${i.path} was also committed as ${i.aliases.join(', ')}`).join('; ')}.`,
        'Those names hold the same content, so removing only one of them leaves the file in history under the others.',
      );
    }
    remove.push(filterRepoCommand(paths));
    if (detailed) {
      remove.push(
        'git filter-repo is not part of git; install it first.',
        'Run it on a fresh clone. It refuses to rewrite a repo with other changes unless you pass --force,',
        'and it removes the "origin" remote afterwards, so add it back before pushing.',
      );
    }
    steps.push(remove);
  }

  if (history.length && all.some(wasPushed)) {
    const after = ['Force-push the rewritten history, and ask every collaborator to re-clone.'];
    if (detailed) {
      after.push(
        'Old clones and forks still hold the secret; a rewrite on your side does not reach them.',
        'On GitHub, cached pull request refs can keep the old commits reachable even after a force-push.',
        `Contact GitHub Support to have them purged: ${DOCS.support}`,
      );
    }
    steps.push(after);
  }

  const links = [DOCS.removingData];
  if (detailed) links.push(DOCS.filterRepo);
  return { steps, links, detailed };
}
