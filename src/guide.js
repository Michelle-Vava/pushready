// The "what to do next" guide: which remediation steps apply, in what order.
//
// Pure. It takes the findings the checks produced and returns a plan. It never
// touches git or the filesystem, which is why it can be tested without running
// a single check — and why pushready can promise it will never fix anything
// behind your back. The commands below are *described*, never executed.
//
// Two shapes make that up:
//
//   a rule    { id, appliesTo(context), build(context) }
//             one remediation step. Rules are listed in RULES in the order the
//             steps must appear, which is the order someone should do them in:
//             rotate what leaked before cleaning up, clean up before force-pushing.
//
//   an action { kind: 'run' | 'manual', text, command? }
//             one line of a step. `text` is exactly what the report prints;
//             `command` is the runnable part on its own, so that --json consumers
//             and (v0.5) `pushready fix` do not have to parse English back into
//             a command. A line that mixes the two — "Untrack it first: git rm
//             --cached x" — carries both.

export const DOCS = {
  removingData: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository',
  filterRepo: 'https://github.com/newren/git-filter-repo#how-do-i-install-it',
  support: 'https://support.github.com/',
};

export const ACTION_KINDS = ['manual', 'run'];

/** Something for the user to understand or decide. */
const say = (text) => ({ kind: 'manual', text });
/** Something for the user to run. `text` may wrap the command in prose. */
const run = (command, text = command) => ({ kind: 'run', text, command });

// Double quotes work the same in bash, cmd and PowerShell, but only for paths
// without these characters. Anything else is handed over as a file list instead.
const HARD_TO_QUOTE = /["$`\\\n]/;
const MAX_PATHS_INLINE = 8;

// Remote-tracking branches say nothing about tags, so for a file that is only on
// a tag, "not on a remote" is a gap in what this clone can see, not a result.
// `then` is what to do if the tag might have been pushed: credentials can be
// rotated, data cannot.
function tagHedge(list, then) {
  const tagOnly = list.filter((i) => i.place === 'tag' && i.exposure === 'not on a remote');
  if (!tagOnly.length) return [];
  return [
    say(`Except that ${tagOnly.map((i) => `${i.path} is only on tag ${i.tags.join(', ')}`).join('; ')}, and this clone keeps no record of which tags were pushed.`),
    say(`If you have ever run "git push --tags" or "git push --follow-tags" here, ${then}.`),
  ];
}

function filterRepoCommand(paths) {
  if (paths.length > MAX_PATHS_INLINE || paths.some((p) => HARD_TO_QUOTE.test(p))) {
    const command = 'git filter-repo --invert-paths --paths-from-file paths.txt';
    return run(command, `${command}   (list one path per line in paths.txt)`);
  }
  return run(`git filter-repo --invert-paths ${paths.map((p) => `--path "${p}"`).join(' ')}`);
}

// Dropping an object's last holder leaves the object on disk until git's garbage
// collection gets to it. Nothing left the machine, so this is a tidy-up rather
// than a leak, and it is only spelled out under --history.
const GC_NOW = 'git reflog expire --expire-unreachable=now --all && git gc --prune=now';
const gcNote = ({ detailed }) => (detailed ? [run(GC_NOW, `The commit itself stays on disk until git collects it. To clear it now: ${GC_NOW}`)] : []);

// --- The rules, in the order their steps appear. -----------------------------

// Rotate first. A credential that was pushed is compromised now, and no amount
// of history rewriting un-leaks it, so this comes before any cleanup.
const rotate = {
  id: 'rotate',
  appliesTo: ({ credentials }) => credentials.length > 0,
  build({ credentials, names, wasPushed }) {
    const pushed = credentials.filter(wasPushed);
    if (pushed.length) {
      return [
        say(`Rotate or revoke these now: ${names(pushed)}.`),
        say('They were pushed, so cleaning history will not un-leak them from clones, forks or caches.'),
      ];
    }
    // Fetching cannot change this answer: a stash is never pushed.
    if (credentials.every((i) => i.place === 'stash')) {
      return [say('None of these have left your machine: a stash is never pushed, and nothing was committed to a branch.')];
    }
    if (credentials.every((i) => i.place === 'unreachable')) {
      return [
        say('None of these are on a branch any more, and no remote-tracking branch has them, so they were probably never pushed.'),
        say('If you force-pushed to undo a mistake, the remote may still hold the old commit — rotate anything you cannot account for.'),
      ];
    }
    return [
      say('None of these were pushed from this clone, so they probably never left your machine.'),
      say('Run "git fetch" if you are not sure, and rotate anything you cannot account for.'),
      ...tagHedge(credentials, 'treat it as pushed and rotate it'),
    ];
  },
};

// Data cannot be rotated, so the step is to work out what was in it and who it
// affects. Separate from `rotate` because the advice has no overlap.
const data = {
  id: 'data',
  appliesTo: (ctx) => ctx.data.length > 0,
  build({ data: items, names, wasPushed }) {
    const pushed = items.filter(wasPushed);
    if (pushed.length) return [say(`Work out what ${names(pushed)} held and who it affects. Leaked data cannot be rotated.`)];
    return [say(`Check what ${names(items)} holds before you push. Leaked data cannot be rotated.`), ...tagHedge(items, 'treat it as pushed')];
  },
};

// The most common misunderstanding: adding a file to .gitignore after the fact.
const gitignoreTooLate = {
  id: 'gitignore-too-late',
  appliesTo: ({ ignored }) => ignored.length > 0,
  build({ ignored, names }) {
    const tracked = ignored.filter((i) => i.present);
    const actions = [
      say(`.gitignore already lists ${names(ignored)}, but that does not undo anything git has already recorded.`),
      say('It only stops a file being added in future: it does not remove anything from history.'),
    ];
    if (tracked.length) {
      const command = `git rm --cached ${tracked.map((i) => `"${i.path}"`).join(' ')}`;
      actions.push(
        say(`It also has no effect on a file git already tracks, which is why ${names(tracked)} is still in the repo.`),
        run(command, `Untrack it first: ${command}`),
      );
    }
    return actions;
  },
};

// A stash is not history. Telling someone to rewrite history for one is the
// wrong tool; the right one is a single drop.
const dropStash = {
  id: 'drop-stash',
  appliesTo: ({ stashed }) => stashed.length > 0,
  build(ctx) {
    const { stashed, names } = ctx;
    // Dropping stash@{0} renumbers the rest, so higher entries have to go first.
    const entries = [...new Set(stashed.flatMap((i) => i.stashes))].sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
    const actions = [
      say(`Drop the stash${entries.length === 1 ? '' : 'es'} holding ${names(stashed)}. ${stashed.length === 1 ? 'It is' : 'They are'} not in any commit on a branch, so there is no history to rewrite:`),
      ...entries.map((e) => run(`git stash drop ${e}`)),
    ];
    if (entries.length > 1) actions.push(say('Drop them in that order: the numbers shift after each one.'));
    actions.push(say('Check first with "git stash show -p <entry>" if you are not sure what else the stash holds.'));
    return [...actions, ...gcNote(ctx)];
  },
};

// Kept alive by a leftover ref, or only by a detached HEAD. Also not history.
const deleteRef = {
  id: 'delete-ref',
  appliesTo: ({ held }) => held.length > 0,
  build(ctx) {
    const { held, names } = ctx;
    const refs = [...new Set(held.flatMap((i) => i.refs))];
    const actions = [say(`${names(held)} ${held.length === 1 ? 'is' : 'are'} not on any branch or tag, so there is no history to rewrite.`)];
    if (refs.length) {
      actions.push(
        say(`${held.length === 1 ? 'It is' : 'They are'} kept alive only by: ${refs.join(', ')}.`),
        say(
          refs.some((r) => r.startsWith('refs/original/'))
            ? 'refs/original/ is the backup git filter-branch leaves behind. It keeps the old commits reachable until you delete it:'
            : 'If that ref is a leftover you no longer need, deleting it is enough:',
        ),
        ...refs.map((r) => run(`git update-ref -d "${r}"`)),
      );
    }
    if (held.some((i) => i.place === 'head')) {
      actions.push(
        say('You are on a detached HEAD, and the commit is only reachable from there.'),
        say('Check out a branch to leave it behind, or "git checkout -b <name>" to keep it — in which case it becomes history and needs the rewrite below.'),
      );
    }
    return [...actions, ...gcNote(ctx)];
  },
};

// Nothing points at the commit any more, so there is nothing to rewrite — but
// the object is still on disk and still recoverable.
const expireUnreachable = {
  id: 'expire-unreachable',
  appliesTo: ({ unreachable }) => unreachable.length > 0,
  build({ unreachable, names, detailed }) {
    const one = unreachable.length === 1;
    const actions = [
      say(`${names(unreachable)} ${one ? 'is in a commit' : 'are in commits'} nothing points at any more — amended away, on a deleted branch, or in a dropped stash.`),
      say(`There is no history to rewrite: no branch, tag or stash holds ${one ? 'it' : 'them'}. But the ${one ? 'commit is' : 'commits are'} still on disk and still recoverable until git collects ${one ? 'it' : 'them'}.`),
      say('Expire the reflog and collect it now:'),
      run('git reflog expire --expire=now --expire-unreachable=now --all && git gc --prune=now'),
    ];
    if (detailed) {
      actions.push(
        say('Until you do, "git fsck --unreachable" and "git reflog" can both still reach the commit.'),
        say('A clone made before you ran this keeps its own copy: cloning does not carry unreachable objects, but a copied folder does.'),
      );
    }
    return actions;
  },
};

// On a branch or a tag, it is history, and only a rewrite removes it.
const rewrite = {
  id: 'rewrite',
  appliesTo: ({ history }) => history.length > 0,
  build({ history, names, detailed }) {
    // A renamed file sits in history under every name it ever had, so a command
    // naming only the risky one looks like it worked and does not. Both the
    // explanation and the command have to cover the whole set.
    const renamed = history.filter((i) => i.aliases?.length);
    const paths = [...new Set(history.flatMap((i) => [i.path, ...(i.aliases ?? [])]))];
    const actions = [say(`Remove ${names(history)} from history yourself — pushready will not do it for you:`)];
    if (renamed.length) {
      actions.push(
        say(`${renamed.map((i) => `${i.path} was also committed as ${i.aliases.join(', ')}`).join('; ')}.`),
        say('Those names hold the same content, so removing only one of them leaves the file in history under the others.'),
      );
    }
    actions.push(filterRepoCommand(paths));
    if (detailed) {
      actions.push(
        say('git filter-repo is not part of git; install it first.'),
        say('Run it on a fresh clone. It refuses to rewrite a repo with other changes unless you pass --force,'),
        say('and it removes the "origin" remote afterwards, so add it back before pushing.'),
      );
    }
    return actions;
  },
};

// Only once there is a rewrite to push, and only if something reached a remote.
const forcePush = {
  id: 'force-push',
  appliesTo: ({ history, all, wasPushed }) => history.length > 0 && all.some(wasPushed),
  build({ detailed }) {
    const actions = [say('Force-push the rewritten history, and ask every collaborator to re-clone.')];
    if (detailed) {
      actions.push(
        say('Old clones and forks still hold the secret; a rewrite on your side does not reach them.'),
        say('On GitHub, cached pull request refs can keep the old commits reachable even after a force-push.'),
        say(`Contact GitHub Support to have them purged: ${DOCS.support}`),
      );
    }
    return actions;
  },
};

/** Every rule, in the order their steps are shown and should be done. */
export const RULES = [rotate, data, gitignoreTooLate, dropStash, deleteRef, expireUnreachable, rewrite, forcePush];

/**
 * What the rules are given: the open findings, sliced the ways they ask about.
 * Returns null when there is nothing to act on.
 */
function guideContext(results, detailed) {
  // Acknowledged findings are ones the user has already looked at and accepted,
  // so they stay on screen but drop out of the list of things to go and do.
  //
  // Grouped by each item's `kind`, not by which check reported it: a credential
  // reported by env-tracked gets the same advice as one from history-credentials,
  // and a new category only has to say what kind it is. Anything that is not
  // data is treated as a credential, the stronger advice, so a kind this guide
  // has no words for yet is never silently dropped (the tests check each kind).
  const all = results.flatMap((r) => r.items ?? []).filter((i) => !i.acknowledged);
  if (!all.length) return null;
  return {
    all,
    detailed,
    credentials: all.filter((i) => i.kind !== 'data'),
    data: all.filter((i) => i.kind === 'data'),
    // Where a file lives decides the tool. Branches and tags are history and need
    // a rewrite. A stash, a leftover ref or a detached HEAD is not history, and
    // "unknown" is treated as history to be safe.
    history: all.filter((i) => !['stash', 'ref', 'head', 'unreachable'].includes(i.place)),
    stashed: all.filter((i) => i.place === 'stash'),
    held: all.filter((i) => i.place === 'ref' || i.place === 'head'),
    unreachable: all.filter((i) => i.place === 'unreachable'),
    ignored: all.filter((i) => i.ignored),
    wasPushed: (i) => i.exposure === 'pushed',
    names: (list) => list.map((i) => i.path).join(', '),
  };
}

/**
 * The guide, built from what the checks found. Returns null when there is
 * nothing to act on.
 *
 *   { steps: [{ id, actions: [{ kind, text, command? }] }], links, detailed }
 *
 * pushready never runs any of this: the steps are for the user to run.
 */
export function exposureGuide(results, { detailed = false } = {}) {
  const context = guideContext(results, detailed);
  if (!context) return null;
  const steps = RULES.filter((rule) => rule.appliesTo(context)).map((rule) => ({ id: rule.id, actions: rule.build(context) }));
  const links = [DOCS.removingData];
  if (detailed) links.push(DOCS.filterRepo);
  return { steps, links, detailed };
}

/** Every line of a guide, in order. The text report prints exactly these. */
export function guideLines(guide) {
  return (guide?.steps ?? []).flatMap((step) => step.actions.map((a) => a.text));
}

/** Every command a guide suggests, in order, with no prose around them. */
export function guideCommands(guide) {
  return (guide?.steps ?? []).flatMap((step) => step.actions.filter((a) => a.kind === 'run').map((a) => a.command));
}
