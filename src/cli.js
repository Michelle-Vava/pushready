#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACK_FILE, exposureGuide, runChecks } from './checks.js';

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

const detailed = args.includes('--history');
const dir = resolve(args.find((a) => !a.startsWith('-')) ?? '.');
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`pushready: not a folder: ${dir}`);
  process.exit(64);
}

// One short line per risky file: where it is, whether it's still there, how exposed it is.
function itemLine({ path, present, branch, branches, exposure, acknowledged }) {
  const extra = branches.length > 1 ? ` +${branches.length - 1}` : '';
  const where = branch ? `on ${branch}${extra}` : 'on no branch';
  const ack = acknowledged ? ', acknowledged' : '';
  return `${path} — ${present ? 'still in the repo' : 'deleted'}, ${where}, ${exposure}${ack}`;
}

const EXPOSURE_DETAIL = {
  pushed: 'on a remote-tracking branch, so treat it as already public',
  'local only': 'this repo has no remote, so it has never been pushed from here',
  'not on a remote': 'a remote exists but does not have this commit (only as fresh as your last fetch)',
};

// --history shows each file as a labelled block instead of one dense line.
function detailBlock(item) {
  const rows = [
    ['status', item.present ? 'still in the repo' : 'deleted, but still in history'],
    ['exposure', `${item.exposure} — ${EXPOSURE_DETAIL[item.exposure]}`],
    ['added in', item.commit ? item.commit.slice(0, 10) : 'unknown'],
    ['branches', item.branches.length ? item.branches.join(', ') : 'none'],
    ['remotes', item.remotes.length ? item.remotes.join(', ') : 'none'],
    [
      'gitignore',
      item.ignored
        ? item.present
          ? 'listed — but .gitignore does not untrack a file git already has'
          : 'listed — but .gitignore does not remove it from history'
        : 'not listed',
    ],
  ];
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
const summary = [`${count('pass')} passed`, `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`, `${failed} failed`];
if (acknowledged) summary.push(`${acknowledged} acknowledged`);
if (unknown) summary.push(`${unknown} could not be checked`);
console.log(`\n  ${summary.join(', ')}\n`);

// A secret that was pushed is a different situation from one that never left the
// machine, so CI can tell them apart without parsing the output.
const pushed = results.some((r) => r.status === 'fail' && (r.items ?? []).some((i) => i.exposure === 'pushed' && !i.acknowledged));
process.exit(failed ? (pushed ? 2 : 1) : 0);
