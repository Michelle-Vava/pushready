// What pushready costs, asserted in the one way that stays stable on a shared
// CI runner: the number of git processes a run starts. Wall-clock time is
// deliberately not asserted anywhere — a loaded runner makes that flaky — and
// process count is both deterministic and what the cost is mostly made of.
//
// These pin the two findings behind ROADMAP's "Large repositories" section:
// cost does not grow with the size of the repository, but it does grow by a
// fixed amount per risky path, because each one is located separately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOB, CLI, MIT, README, cliRun, commitAll, repo } from './helpers.js';

// Count git processes by reading git's own trace output, which every git
// honours on every platform. A shim on PATH would not work on Windows.
function countGit(dir, ...args) {
  const trace = join(dir, 'pushready-trace.log');
  spawnSync(process.execPath, [CLI, dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', GIT_TRACE: trace },
  });
  return readFileSync(trace, 'utf8').split('\n').filter((line) => line.includes('built-in: git ')).length;
}

function traceOf(dir, ...args) {
  const trace = join(dir, 'pushready-trace.log');
  spawnSync(process.execPath, [CLI, dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', GIT_TRACE: trace },
  });
  return readFileSync(trace, 'utf8');
}

function riskyRepo(count, { files = 0, commits = 0 } = {}) {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' });
  for (let c = 0; c < commits; c++) {
    mkdirSync(join(dir, `src/m${c}`), { recursive: true });
    for (let f = 0; f < files; f++) writeFileSync(join(dir, `src/m${c}/f${f}.js`), `export const v = ${c};\n`);
    commitAll(dir, `change ${c}`);
  }
  for (let i = 0; i < count; i++) writeFileSync(join(dir, `key${i}.pem`), BLOB + i);
  if (count) commitAll(dir, 'add keys');
  return dir;
}

test('a bigger repository does not cost more git processes than a small one', (t) => {
  const small = riskyRepo(1, { files: 1, commits: 1 });
  const big = riskyRepo(1, { files: 40, commits: 15 });
  t.after(() => {
    rmSync(small, { recursive: true, force: true });
    rmSync(big, { recursive: true, force: true });
  });
  // 600 files against 1: the history walk is one process either way, because
  // pushready reads every name out of a single "git log" rather than asking
  // per file. This is the property that makes it usable on a big repository.
  assert.equal(countGit(big), countGit(small), 'process count is independent of repo size');
});

test('each additional risky path costs a fixed, small number of processes', (t) => {
  const one = riskyRepo(1);
  const five = riskyRepo(5);
  t.after(() => {
    rmSync(one, { recursive: true, force: true });
    rmSync(five, { recursive: true, force: true });
  });
  const perPath = (countGit(five) - countGit(one)) / 4;
  // Two today: "which refs contain this commit" and "is it an ancestor of a
  // remote tip". If this climbs, locating a path got more expensive, and a repo
  // with many findings pays for it on every single one.
  assert.ok(perPath <= 2, `${perPath} git processes per risky path`);
});

test('a repo with nothing risky in it never pays for rename detection', (t) => {
  const clean = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' });
  t.after(() => rmSync(clean, { recursive: true, force: true }));
  // The rename walk is the expensive one. It exists only to explain a finding,
  // so a clean repo must never run it.
  assert.doesNotMatch(traceOf(clean), /diff-filter=R/);
});

test('a large file costs no more to check than a small one, because it is never opened', (t) => {
  const small = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'data.bin': 'x' });
  const large = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'data.bin': 'x'.repeat(8 * 1024 * 1024) });
  t.after(() => {
    rmSync(small, { recursive: true, force: true });
    rmSync(large, { recursive: true, force: true });
  });
  assert.equal(countGit(large), countGit(small));
});

// Recorded, not fixed: there is no size check at all yet (ROADMAP v0.6). An 8 MB
// file committed into a repo is a clean run today. The test exists so that
// adding the check is a visible change to a stated behaviour.
test('a committed file far too big for GitHub is not reported today', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'video.mp4': 'x'.repeat(8 * 1024 * 1024) });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout, status } = cliRun(dir);
  assert.equal(status, 0);
  assert.doesNotMatch(stdout, /large|size|MB/i);
});

// --- When a repository is too big to read in one gulp.
//
// execFileSync buffers a command's whole output in memory. Past the limit it
// throws ENOBUFS, and until 1 Nov 2026 that escaped as a Node stack trace with
// nothing said about which repository or why. PUSHREADY_MAX_BUFFER exists so
// this path can be tested without building a 64 MB repository.

function withTinyBuffer(dir, bytes, ...args) {
  return spawnSync(process.execPath, [CLI, dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', PUSHREADY_MAX_BUFFER: String(bytes) },
  });
}

test('output too large to read is reported as a limit, not a crash', (t) => {
  const dir = riskyRepo(1, { files: 30, commits: 6 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout, stderr, status } = withTinyBuffer(dir, 256);
  // Not a stack trace, and not a silent pass.
  assert.doesNotMatch(stderr, /ENOBUFS|at Object\.|node:internal/);
  assert.match(stdout, /Only part of the git history can be checked/);
  assert.match(stdout, /too (many tracked files|much history) for pushready to read at once|too many tracked files/);
  assert.match(stdout, /could not be checked/);
  assert.notEqual(status, null, 'the process exited rather than dying on a signal');
});

test('a run that hit the limit never claims the history was clean', (t) => {
  const dir = riskyRepo(1, { files: 30, commits: 6 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout } = withTinyBuffer(dir, 256);
  // The dangerous outcome would be "No private key files in git history" from a
  // walk that never happened.
  assert.doesNotMatch(stdout, /No private key files in git history/);
  assert.match(stdout, /private key files found, but the history is incomplete/);
});

test('the limit is reported in --json too, and --strict makes it fail', (t) => {
  const dir = riskyRepo(1, { files: 30, commits: 6 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout } = withTinyBuffer(dir, 256, '--json');
  const body = JSON.parse(stdout);
  const scope = body.findings.find((f) => f.id === 'history-scope');
  assert.equal(scope.status, 'unknown');
  assert.match(scope.message, /too (many|much)/);
  assert.equal(body.exit, 0, 'could-not-check does not fail a run on its own');
  assert.equal(withTinyBuffer(dir, 256, '--strict').status, 1, 'but --strict says otherwise');
});

test('the normal buffer is nowhere near reached by an ordinary repository', (t) => {
  const dir = riskyRepo(1, { files: 40, commits: 15 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // 600 files over 15 commits: the real run reports a complete history.
  assert.match(cliRun(dir).stdout, /Full git history available/);
});
