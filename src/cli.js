#!/usr/bin/env node
// The command line: parse arguments, run the checks, print the report, choose the
// exit code. No checking logic lives here — the CLI decides indentation and colour,
// and index.js decides everything else. --json (v0.3.3) will be a second renderer
// beside the text one below, over the same results.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACK_FILE, exposureGuide, runChecks } from './index.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `pushready ${version}
Check a repository for common mistakes before you push it or make it public.

Usage: pushready [path] [options]

  path            folder to check (default: current folder)
      --history   show commit hashes and every branch for each risky file
  -h, --help      show this help
  -v, --version   show the version

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

Exit codes
  0   nothing to fix, or everything found was acknowledged
  1   problems found, but nothing has been pushed from this clone
  2   problems found, and at least one was already pushed — rotate first
  64  pushready was used wrongly (for example, the path is not a folder)`;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const ICON = {
  pass: paint(32, '✔'),
  warn: paint(33, '!'),
  fail: paint(31, '✖'),
  unknown: paint(33, '?'),
  acknowledged: paint(36, '✔'),
  skip: paint(90, '-'),
};

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}
if (args.includes('-v') || args.includes('--version')) {
  console.log(version);
  process.exit(0);
}

// TODO(v0.3.1): unknown flags are ignored, so `pushready . --hsitory` runs silently
// without detail and `--json` runs silently without JSON. Reject anything that is
// not a known flag with exit 64, and say which flag.
const detailed = args.includes('--history');
const dir = resolve(args.find((a) => !a.startsWith('-')) ?? '.');
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`pushready: not a folder: ${dir}`);
  process.exit(64);
}

// One short line per risky file: where it is, whether it's still there, how exposed it is.
function itemLine({ path, present, branch, branches, tags, stashes, refs, place, exposure, acknowledged }) {
  const ack = acknowledged ? ', acknowledged' : '';
  // Not history: say what is holding it instead of "deleted, on no branch", which
  // reads as if a rewrite were needed.
  if (place === 'stash') return `${path} — in ${stashes.join(' and ')}, never committed to a branch, ${exposure}${ack}`;
  if (place === 'ref') return `${path} — kept only by ${refs.join(', ')}, not on any branch, ${exposure}${ack}`;
  if (place === 'head') return `${path} — on a detached HEAD, not on any branch, ${exposure}${ack}`;
  if (place === 'unreachable') return `${path} — in a commit nothing points at any more, still recoverable, ${exposure}${ack}`;
  const extra = branches.length > 1 ? ` +${branches.length - 1}` : '';
  const where = branch ? `on ${branch}${extra}` : place === 'tag' ? `only on tag ${tags.join(', ')}` : 'on no branch';
  return `${path} — ${present ? 'still in the repo' : 'deleted'}, ${where}, ${exposure}${ack}`;
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
            : 'deleted, but still in history',
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

const results = runChecks(dir);
console.log(`\nChecking ${dir}\n`);
for (const r of results) {
  console.log(`  ${ICON[r.status]} ${r.message}`);
  for (const item of r.items ?? []) {
    if (detailed) {
      console.log(`      ${item.path}`);
      for (const line of detailBlock(item)) console.log(paint(90, `          ${line}`));
    } else {
      console.log(`      ${itemLine(item)}`);
    }
  }
  if (r.fix && r.status !== 'pass') console.log(paint(90, `      → ${r.fix}`));
}

const guide = exposureGuide(results, { detailed });
if (guide) {
  console.log(`\n  ${paint(1, 'What to do next')}`);
  guide.steps.forEach(([first, ...rest], i) => {
    console.log(`    ${i + 1}. ${first}`);
    for (const line of rest) console.log(paint(90, `       ${line}`));
  });
  for (const link of guide.links) console.log(paint(90, `    Docs: ${link}`));
  if (!detailed) console.log(paint(90, '    Run again with --history for the full guide.'));
}

const count = (s) => results.filter((r) => r.status === s).length;
const failed = count('fail');
const warnings = count('warn');
const unknown = count('unknown');
const acknowledged = count('acknowledged');
// "unknown" means a check could not run, not that it found a problem, so it does
// not set the exit code. It is still printed so it can't be mistaken for a pass.
// TODO(v0.3.1): `skip` is not counted. A folder that is not a git repository shows
// six "- Not a git repository" lines and then "0 passed, 1 warning, 2 failed".
const summary = [`${count('pass')} passed`, `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`, `${failed} failed`];
if (acknowledged) summary.push(`${acknowledged} acknowledged`);
if (unknown) summary.push(`${unknown} could not be checked`);
console.log(`\n  ${summary.join(', ')}\n`);

// A secret that was pushed is a different situation from one that never left the
// machine, so CI can tell them apart without parsing the output.
// TODO(v0.3.2): this is the whole exit-code contract today: 0 / 1 / 2 / 64. Write
// down and test what --strict, --only, --skip and --json do to it before adding
// any of them (see the v0.3.2 section of ROADMAP.md for the open questions).
const pushed = results.some((r) => r.status === 'fail' && (r.items ?? []).some((i) => i.exposure === 'pushed' && !i.acknowledged));
process.exit(failed ? (pushed ? 2 : 1) : 0);
