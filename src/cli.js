#!/usr/bin/env node
// The command line: parse arguments, run the checks, render the report, exit.
// No checking logic lives here. Two renderers sit over the same results — text
// (indentation and colour) and --json (the finding shape from finding.js) —
// and verdict.js decides the exit code for both, so they cannot disagree.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { ACK_FILE, CHECKS, exposureGuide, isBareRepo, repositoryRoot, runChecks, selectChecks, verdict } from './index.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `pushready ${version}
Check a repository for common mistakes before you push it or make it public.

Usage: pushready [path] [options]

  path              folder to check (default: current folder). A folder inside
                    a repository means the whole repository
      --history     show commit hashes and every branch for each risky file
      --json        print the findings as JSON instead of a report
      --quiet       print only what failed, warned or could not be checked
      --strict      a warning, or a check that could not run, fails the run
      --only <ids>  run only these checks (comma-separated, or repeat the flag)
      --skip <ids>  run every check except these
  -h, --help        show this help
  -v, --version     show the version

Checks, by id:
${CHECKS.map((c) => `  ${c.id.padEnd(22)} ${c.title}`).join('\n')}

Risky files found in git history are reported with how exposed they are:

  local only        this clone has no remote, so nothing has been pushed from it
  not on a remote   a remote exists but does not have the commit. Remote-tracking
                    refs are only as fresh as your last "git fetch"
  pushed            the commit is on a remote-tracking branch. Treat the credential
                    as compromised and rotate it before anything else

Matching is on file names only. pushready never opens a file that could hold a
secret, so a finding means "this name is normally used for X" and is a prompt to
go and look, not proof of a leak.

Where a file lives decides the advice. On a branch or tag it is history, and the
guide gives a "git filter-repo" command. Only in a stash, a leftover ref such as
filter-branch's refs/original, or a detached HEAD, it is not history: the guide
says what is holding it and how to drop that instead. Every stash is checked,
not just the newest one.

Commits nothing points at any more are searched too — amended away, on a deleted
branch, or in a dropped stash. The object survives until git collects it, so the
file is still there; the fix is "git reflog expire" plus "git gc", not a rewrite.
Anything that cannot be checked (a shallow or single-branch clone, a submodule)
is reported as "could not be checked" rather than passed.

Adding a file to .gitignore does not undo anything git already recorded: it does
not untrack a file, and it does not remove one from history. pushready says so
when it finds a risky file that .gitignore already lists.

pushready only advises. It never edits files, deletes anything or rewrites git
history: the commands it prints are for you to run.

Acknowledging a finding
  Put a .pushready.json in the repo to accept findings you have already looked at.
  They stay in the output, marked "acknowledged", and stop failing the run:

    { "acknowledge": [ { "path": "test/fixtures/dummy.pem", "reason": "test key" } ] }

  This applies to every check: a tracked fixture .env by its path, a vendored
  node_modules by the path "node_modules". An optional "version": 1 names the
  format; a newer version is applied where understood, with a warning.

Exit codes
  0   nothing to fix, or everything found was acknowledged
  1   problems found, but nothing has been pushed from this clone
  2   problems found, and at least one was already pushed — rotate first
  64  pushready was used wrongly (the path is not a folder or is a bare
      repository, an unknown option or check id, or an option missing its value)

  --strict makes a warning or a "could not be checked" exit 1. --skip and --only
  leave checks unrun, so those cannot affect the code; the finding a skipped check
  would have made is handed to the next check that saw the same path, so skipping
  "env-tracked" does not hide a committed .env. --json never changes the code.`;

// ---- Arguments -------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}
if (args.includes('-v') || args.includes('--version')) {
  console.log(version);
  process.exit(0);
}

function usageError(message) {
  console.error(`pushready: ${message}\nRun "pushready --help" for the options.`);
  process.exit(64);
}

const FLAGS = new Set(['--history', '--json', '--quiet', '--strict']);
const WITH_VALUE = new Set(['--only', '--skip']);
const options = { history: false, json: false, quiet: false, strict: false, only: [], skip: [] };
const paths = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!arg.startsWith('-')) {
    paths.push(arg);
    continue;
  }
  // --only=a,b and --only a,b are both accepted; either may be repeated.
  const [name, inline] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
  if (FLAGS.has(name) && inline === undefined) {
    options[name.slice(2)] = true;
  } else if (WITH_VALUE.has(name)) {
    const value = inline ?? args[++i];
    if (value === undefined || value.startsWith('-')) usageError(`${name} needs a value: ${name} <check-id>[,<check-id>...]`);
    options[name.slice(2)].push(...value.split(',').map((v) => v.trim()).filter(Boolean));
  } else {
    // A typo like --hsitory used to run silently without detail. Anything that
    // is not a known option is refused by name.
    usageError(`unknown option: ${arg}`);
  }
}
if (paths.length > 1) usageError(`one path at a time: got ${paths.join(' and ')}`);

const requested = resolve(paths[0] ?? '.');
if (!existsSync(requested) || !statSync(requested).isDirectory()) usageError(`not a folder: ${requested}`);
// A folder inside a repository means the repository. Say so, because the header
// will name a different folder from the one on the command line.
const dir = repositoryRoot(requested) ?? requested;
// A bare repository has no working tree, so every check either cannot run or
// would answer about a folder that is not a project. Refusing is clearer than
// nine identical "skipped" lines, and stops CI reading a green run as a check.
if (isBareRepo(dir)) {
  usageError(`${dir} is a bare repository, which has no working tree. Run pushready on a clone of it instead.`);
}
const note = dir === requested ? null : `${relative(dir, requested)} is inside this repository, so the whole repository is checked`;

let checks;
try {
  checks = selectChecks(options);
} catch (error) {
  usageError(error.message);
}
const notRun = CHECKS.filter((c) => !checks.includes(c)).map((c) => c.id);

// ---- Text rendering --------------------------------------------------------

const color = process.stdout.isTTY && !process.env.NO_COLOR && !options.json;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const ICON = {
  pass: paint(32, '✔'),
  warn: paint(33, '!'),
  fail: paint(31, '✖'),
  unknown: paint(33, '?'),
  acknowledged: paint(36, '✔'),
  skip: paint(90, '-'),
};

// One short line per risky file: where it is, whether it's still there, how exposed it is.
function itemLine({ path, present, onCurrentBranch, branch, branches, tags, stashes, refs, place, exposure, acknowledged }) {
  const ack = acknowledged ? ', acknowledged' : '';
  // Not history: say what is holding it instead of "deleted, on no branch", which
  // reads as if a rewrite were needed.
  if (place === 'stash') return `${path} — in ${stashes.join(' and ')}, never committed to a branch, ${exposure}${ack}`;
  if (place === 'ref') return `${path} — kept only by ${refs.join(', ')}, not on any branch, ${exposure}${ack}`;
  if (place === 'head') return `${path} — on a detached HEAD, not on any branch, ${exposure}${ack}`;
  if (place === 'unreachable') return `${path} — in a commit nothing points at any more, still recoverable, ${exposure}${ack}`;
  const extra = branches.length > 1 ? ` +${branches.length - 1}` : '';
  const where = branch ? `on ${branch}${extra}` : place === 'tag' ? `only on tag ${tags.join(', ')}` : 'on no branch';
  // "deleted" is only true of a file that was on this branch and was removed.
  // One that lives on another branch, or only on a tag or a remote, was never
  // in this working tree to delete, and calling it deleted reads as done with.
  const state = present ? 'still in the repo' : onCurrentBranch ? 'deleted' : 'not in your checkout';
  return `${path} — ${state}, ${where}, ${exposure}${ack}`;
}

const EXPOSURE_DETAIL = {
  pushed: 'on a remote-tracking branch, so treat it as already public',
  'local only': 'this repo has no remote, or the file is only in a stash (which is never pushed), so it has not left here',
  'not on a remote': 'a remote exists but does not have this commit (only as fresh as your last fetch)',
};

// --history shows each file as a labelled block instead of one dense line.
function detailBlock(item) {
  const rows = [
    [
      'status',
      item.present
        ? 'still in the repo'
        : item.place === 'stash'
          ? 'stashed, never committed to a branch'
          : item.place === 'unreachable'
            ? 'in an unreachable commit — amended away, on a deleted branch, or a dropped stash'
            : item.onCurrentBranch
              ? 'deleted, but still in history'
              : 'not in your checkout — it is in history on another branch, tag or remote',
    ],
    ['exposure', `${item.exposure} — ${EXPOSURE_DETAIL[item.exposure]}`],
    ['added in', item.commit ? item.commit.slice(0, 10) : 'unknown'],
    ['branches', item.branches.length ? item.branches.join(', ') : 'none'],
    ['remotes', item.remotes.length ? item.remotes.join(', ') : 'none'],
    // Tags are history too, and the one kind of ref whose push state this clone
    // cannot see. Stashes and other refs are what keep a commit alive when no
    // branch does, and are shown only when that is the case.
    ...(item.tags.length ? [['tags', `${item.tags.join(', ')}${item.place === 'tag' ? ' — nothing else holds it; this clone cannot tell whether tags were pushed' : ''}`]] : []),
    ...(item.stashes.length ? [['stash', `${item.stashes.join(', ')} — never committed to a branch, so there is no history to rewrite`]] : []),
    ...(item.refs.length ? [['kept by', `${item.refs.join(', ')} — not a branch or tag; deleting the ref is enough`]] : []),
    ...(item.place === 'head' ? [['head', 'detached — only reachable from HEAD until you check out or create a branch']] : []),
    ...(item.place === 'unreachable' ? [['reachable from', 'nothing — the object survives until git collects it, so there is no history to rewrite']] : []),
    [
      'gitignore',
      item.ignored
        ? item.present
          ? 'listed — but .gitignore does not untrack a file git already has'
          : 'listed — but .gitignore does not remove it from history'
        : 'not listed',
    ],
  ];
  // Only shown when there are any, because "also committed as: none" would read
  // like a reassurance rather than the absence of a complication.
  if (item.aliases.length) rows.push(['also committed as', `${item.aliases.join(', ')} — the same content, so cleanup has to name all of them`]);
  if (item.acknowledged) rows.push(['acknowledged', item.reason || `listed in ${ACK_FILE}`]);
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`);
}

// ---- Run -------------------------------------------------------------------

const results = runChecks(dir, { checks });
const outcome = verdict(results, { strict: options.strict });
const detailed = options.history;

if (options.json) {
  // Everything the text report could show, regardless of --history or --quiet:
  // a machine consumer wants the whole picture, and chooses what to show itself.
  const report = {
    version,
    dir,
    findings: results,
    guide: exposureGuide(results, { detailed: true }),
    verdict: outcome,
    notRun,
    exit: outcome.exit,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(outcome.exit);
}

console.log(`\nChecking ${dir}`);
if (note) console.log(paint(90, `  ${note}`));
console.log('');
// --quiet keeps what needs attention. Passes, skips and acknowledged findings
// are still counted in the summary, so nothing is hidden, only folded away.
const shown = options.quiet ? results.filter((r) => ['fail', 'warn', 'unknown'].includes(r.status)) : results;
for (const r of shown) {
  console.log(`  ${ICON[r.status]} ${r.message}`);
  for (const item of r.items) {
    if (detailed) {
      console.log(`      ${item.path}`);
      for (const line of detailBlock(item)) console.log(paint(90, `          ${line}`));
    } else {
      console.log(`      ${itemLine(item)}`);
    }
  }
  if (r.fix && r.status !== 'pass') console.log(paint(90, `      → ${r.fix}`));
}
if (options.quiet && !shown.length) console.log(paint(90, '  Nothing needs attention.'));

const guide = exposureGuide(results, { detailed });
if (guide) {
  console.log(`\n  ${paint(1, 'What to do next')}`);
  // One step per rule; the first action is the headline, the rest are detail.
  guide.steps.forEach(({ actions: [first, ...rest] }, i) => {
    console.log(`    ${i + 1}. ${first.text}`);
    for (const action of rest) console.log(paint(90, `       ${action.text}`));
  });
  for (const link of guide.links) console.log(paint(90, `    Docs: ${link}`));
  if (!detailed) console.log(paint(90, '    Run again with --history for the full guide.'));
}

// The summary accounts for every finding above it, shown or folded; "unknown"
// and "skip" are listed so that a check that could not run is never mistaken
// for one that passed. "not run" is what --only / --skip left out.
const { blockers, warnings, unknown, acknowledged, skipped } = outcome;
const summary = [`${results.filter((r) => r.status === 'pass').length} passed`, `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`, `${blockers} failed`];
if (acknowledged) summary.push(`${acknowledged} acknowledged`);
if (unknown) summary.push(`${unknown} could not be checked`);
if (skipped) summary.push(`${skipped} skipped`);
if (notRun.length) summary.push(`${notRun.length} not run`);
console.log(`\n  ${paint(1, outcome.line)}`);
console.log(`  ${summary.join(', ')}\n`);

process.exit(outcome.exit);
