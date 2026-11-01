// The v0.3.2 and v0.3.3 flags, and the exit-code contract they live under. Each
// question the roadmap left open about the code has a test here with its answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CHECKS, FINDING_KEYS, ITEM_KEYS, runChecks, selectChecks, verdict } from '../src/index.js';
import { BLOB, CLI, MIT, README, cleanUp, cliRun, guideText, pushTo, repo } from './helpers.js';

const clean = () => repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\nnode_modules\n' });
// One of each: a blocker (no LICENSE), a warning (short README), a key in history.
const messy = () => repo({ 'README.md': '# x\n', '.gitignore': '.env\n', 'deploy.pem': BLOB });
const summaryOf = (stdout) => stdout.match(/\n {2}(\d+ passed.*)\n/)[1];
const json = (...args) => {
  const r = cliRun(...args);
  return { ...r, body: JSON.parse(r.stdout) };
};

// ---- --only / --skip ---------------------------------------------------------

test('--only runs just the named checks, in registration order, and says what was left out', (t) => {
  const dir = messy();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout, status } = cliRun(dir, '--only', 'license,readme');
  assert.equal(status, 1, 'the missing LICENSE still fails');
  const lines = stdout.split('\n').filter((l) => /^ {2}[✔✖!?-] /.test(l));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /README/, 'registration order, not the order given');
  assert.match(lines[1], /LICENSE/);
  assert.match(summaryOf(stdout), /8 not run/);
  assert.doesNotMatch(stdout, /What to do next/, 'the history checks did not run, so there is no guide');
});

test('--skip leaves out the named checks and nothing else', (t) => {
  const dir = messy();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout } = cliRun(dir, '--skip', 'license', '--skip', 'readme');
  assert.doesNotMatch(stdout, /README|LICENSE/);
  assert.match(stdout, /private key file/);
  assert.match(summaryOf(stdout), /2 not run/);
});

test('--only and --skip accept commas, repeats and =, and refuse an unknown id by name', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const args of [['--only', 'readme,license'], ['--only=readme,license'], ['--only', 'readme', '--only', 'license']]) {
    assert.match(summaryOf(cliRun(dir, ...args).stdout), /8 not run/, args.join(' '));
  }
  const { status, stderr, stdout } = cliRun(dir, '--skip', 'licence');
  assert.equal(status, 64);
  assert.equal(stdout, '', 'nothing is checked when the command was wrong');
  assert.match(stderr, /unknown check: licence/);
  assert.match(stderr, /The checks are: readme, license, gitignore/, 'the valid ids are listed');
});

test('selectChecks is what the flags use, and keeps registration order', () => {
  assert.deepEqual(selectChecks().map((c) => c.id), CHECKS.map((c) => c.id));
  assert.deepEqual(selectChecks({ only: ['history-data', 'readme'] }).map((c) => c.id), ['readme', 'history-data']);
  assert.deepEqual(selectChecks({ skip: ['readme'] }).length, CHECKS.length - 1);
  assert.throws(() => selectChecks({ only: ['nope'] }), /unknown check: nope/);
});

test('skipping the check that would report a path hands it to the next check that saw it', (t) => {
  // The reason the policy pass runs over results rather than inside a check.
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': 'node_modules\n', '.env': 'SECRET=1' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const normal = cliRun(dir);
  assert.match(normal.stdout, /Secret file\(s\) committed: \.env/);
  assert.match(normal.stdout, /No other credential files in git history/);
  const skipped = cliRun(dir, '--skip', 'env-tracked');
  assert.doesNotMatch(skipped.stdout, /Secret file\(s\) committed/);
  assert.match(skipped.stdout, /1 credential file in git history/, 'the .env moved, it did not vanish');
  assert.match(skipped.stdout, /\.env — still in the repo/);
  assert.equal(skipped.status, 1);
});

test('--only readme spawns no git process', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A check that only reads files must not pay for git, and the v0.3.2 done-when
  // says so. GIT_TRACE would log any git process that started.
  const trace = join(dir, 'trace.log');
  spawnSync(process.execPath, [CLI, dir, '--only', 'readme'], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', GIT_TRACE: trace },
  });
  assert.equal(existsSync(trace), false, 'no git process ran, so nothing was traced');
});

// ---- The exit-code contract ----------------------------------------------------

test('--skip of a failing check lowers the exit code, because the check did not run', (t) => {
  const dir = repo({ 'README.md': README, '.gitignore': '.env\n' }); // no LICENSE: exit 1
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(cliRun(dir).status, 1);
  assert.equal(cliRun(dir, '--skip', 'license').status, 0);
  assert.equal(cliRun(dir, '--only', 'readme').status, 0);
});

test('a check that could not run never fails the run without --strict', (t) => {
  // A broken .pushready.json is a warning; a shallow clone is "unknown". Neither
  // is a finding, and the contract says neither sets the code on its own.
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', '.pushready.json': '{ not json' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout, status } = cliRun(dir);
  assert.equal(status, 0);
  assert.match(stdout, /1 warning/);
  assert.match(stdout, /Ready to make public: yes/);
});

test('--strict turns a warning into exit 1, and says so in the verdict', (t) => {
  const dir = repo({ 'README.md': '# x\n', LICENSE: MIT, '.gitignore': '.env\n' }); // short README warns
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(cliRun(dir).status, 0);
  const strict = cliRun(dir, '--strict');
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /Ready to make public: no \(1 warning, --strict\)/);
});

test('--strict turns "could not be checked" into exit 1 too', (t) => {
  const origin = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'a.txt': 'x' });
  const where = mkdtempSync(join(tmpdir(), 'pushready-shallow-'));
  t.after(() => cleanUp(origin, where));
  // --depth is ignored when cloning a local path, so a file:// URL is required.
  // pathToFileURL, not string concatenation: a Windows path is not a URL.
  spawnSync('git', ['clone', '-q', '--depth', '1', pathToFileURL(origin).href, 'clone'], { cwd: where, stdio: 'ignore' });
  const clone = join(where, 'clone');
  assert.equal(cliRun(clone).status, 0, 'a shallow clone is exit 0 by default');
  assert.match(cliRun(clone).stdout, /yes, as far as could be checked/);
  const strict = cliRun(clone, '--strict');
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /could not be checked, --strict/);
});

test('--strict never lowers a 2 to a 1, and never changes a 0 with nothing to warn about', (t) => {
  const pushed = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'id_rsa': BLOB });
  const spotless = clean();
  let remote;
  t.after(() => {
    for (const d of [pushed, spotless, remote]) rmSync(d, { recursive: true, force: true });
  });
  remote = pushTo(pushed);
  assert.equal(cliRun(pushed, '--strict').status, 2);
  assert.equal(cliRun(spotless, '--strict').status, 0);
});

test('--json never changes the exit code', (t) => {
  const dirs = { 0: clean(), 1: messy() };
  dirs[2] = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'id_rsa': BLOB });
  let remote;
  t.after(() => {
    for (const d of [...Object.values(dirs), remote]) rmSync(d, { recursive: true, force: true });
  });
  remote = pushTo(dirs[2]);
  for (const [expected, dir] of Object.entries(dirs)) {
    assert.equal(cliRun(dir).status, Number(expected), `text ${expected}`);
    const { status, body } = json(dir, '--json');
    assert.equal(status, Number(expected), `json ${expected}`);
    assert.equal(body.exit, Number(expected), 'and the code is in the document too');
  }
});

test('the verdict agrees with the exit code by construction', () => {
  const fake = (statuses, pushed = false) =>
    statuses.map((status, i) => ({ id: `c${i}`, status, items: pushed && status === 'fail' ? [{ exposure: 'pushed', acknowledged: false }] : [] }));
  assert.deepEqual([verdict(fake(['pass', 'pass'])).exit, verdict(fake(['pass', 'pass'])).ready], [0, true]);
  assert.equal(verdict(fake(['pass', 'fail'])).exit, 1);
  assert.equal(verdict(fake(['pass', 'fail'], true)).exit, 2);
  assert.match(verdict(fake(['pass', 'fail'], true)).line, /rotate first/);
  assert.equal(verdict(fake(['warn'])).exit, 0);
  assert.equal(verdict(fake(['warn']), { strict: true }).exit, 1);
  assert.equal(verdict(fake(['unknown']), { strict: true }).exit, 1);
  assert.equal(verdict(fake(['acknowledged'])).exit, 0);
  assert.match(verdict(fake(['acknowledged'])).line, /yes \(1 acknowledged\)/);
  assert.equal(verdict(fake(['skip', 'skip'])).exit, 0);
});

// ---- --json --------------------------------------------------------------------

test('--json prints one JSON document with the documented top-level keys, and nothing else', (t) => {
  const dir = messy();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout, stderr, body } = json(dir, '--json');
  assert.equal(stderr, '');
  assert.deepEqual(Object.keys(body), ['version', 'dir', 'findings', 'guide', 'verdict', 'notRun', 'exit']);
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
  assert.equal(body.dir, dir);
  // Every check but the acknowledgements diagnostic, which only speaks up when
  // .pushready.json is wrong, and leaves no placeholder otherwise.
  assert.deepEqual(body.findings.map((f) => f.id), CHECKS.map((c) => c.id).filter((id) => id !== 'acknowledgements'));
  assert.ok(Array.isArray(body.guide.steps) && body.guide.steps.length > 0);
  assert.deepEqual(body.notRun, []);
  assert.equal(body.verdict.ready, false);
  assert.equal(body.exit, 1);
  // No colour codes, no report text: the whole of stdout parses.
  assert.doesNotMatch(stdout, /\x1b\[|Checking /);
});

test('every finding in --json has exactly the documented keys, and so does every item', (t) => {
  const dir = messy();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { body } = json(dir, '--json');
  for (const f of body.findings) {
    assert.deepEqual(Object.keys(f), FINDING_KEYS, f.id);
    assert.equal(typeof f.title, 'string');
    assert.ok(f.fix === null || typeof f.fix === 'string', `${f.id} fix`);
    for (const item of f.items) assert.deepEqual(Object.keys(item), ITEM_KEYS, `${f.id} item ${item.path}`);
  }
  const key = body.findings.find((f) => f.id === 'history-keys');
  assert.equal(key.items[0].path, 'deploy.pem');
  assert.match(key.items[0].commit, /^[0-9a-f]{40}$/, 'the full hash, not the short one');
});

test('--json is byte-stable across two runs on the same repository', (t) => {
  const dir = messy();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(cliRun(dir, '--json').stdout, cliRun(dir, '--json').stdout);
});

test('--json carries the full guide whatever --history says, and --quiet does not thin it', (t) => {
  const dir = messy();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const plain = json(dir, '--json').body;
  const both = json(dir, '--json', '--history', '--quiet').body;
  assert.deepEqual(plain, both);
  assert.match(guideText(plain.guide), /git filter-repo is not part of git/, 'the --history detail is always in the JSON');
  assert.ok(plain.findings.some((f) => f.status === 'pass'), 'passes are not dropped by --quiet in JSON');
});

test('--json with --only lists what was not run', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { body } = json(dir, '--json', '--only', 'readme');
  assert.deepEqual(body.findings.map((f) => f.id), ['readme']);
  assert.equal(body.notRun.length, CHECKS.length - 1);
  assert.equal(body.guide, null);
});

// ---- --quiet -------------------------------------------------------------------

test('--quiet shows only failures, warnings and could-not-check, but counts everything', (t) => {
  const dir = messy();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const full = cliRun(dir).stdout;
  const quiet = cliRun(dir, '--quiet').stdout;
  assert.doesNotMatch(quiet, /✔/, 'no pass lines');
  assert.match(quiet, /✖ No LICENSE file/);
  assert.match(quiet, /! README\.md is very short/);
  assert.match(quiet, /What to do next/, 'the guide stays');
  // The summary is the same: quiet folds lines away, it does not uncount them.
  assert.equal(summaryOf(quiet), summaryOf(full));
});

test('--quiet on a clean repository says that nothing needs attention', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout, status } = cliRun(dir, '--quiet');
  assert.equal(status, 0);
  assert.match(stdout, /Nothing needs attention\./);
  assert.match(stdout, /Ready to make public: yes/);
});

// ---- The verdict line --------------------------------------------------------------

test('the verdict line is printed before the summary and names what blocks', (t) => {
  const pushed = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'id_rsa': BLOB });
  const ok = clean();
  let remote;
  t.after(() => {
    for (const d of [pushed, ok, remote]) rmSync(d, { recursive: true, force: true });
  });
  remote = pushTo(pushed);
  const bad = cliRun(pushed).stdout;
  assert.match(bad, /\n {2}Ready to make public: no \(1 blocker\) — something was pushed, rotate first\n {2}\d+ passed/);
  assert.match(cliRun(ok).stdout, /\n {2}Ready to make public: yes\n/);
});
