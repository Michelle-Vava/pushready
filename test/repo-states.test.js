// States a repository can be in that are not "a few commits on main": no
// commits at all, several branches, a branch only a remote has. These are the
// shapes where a check can quietly report the wrong thing, because the question
// it asks of git has an empty or surprising answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runChecks } from '../src/index.js';
import { BLOB, MIT, README, cliRun, commitAll, items, pushTo, repo, run, status } from './helpers.js';

// --- No commits yet. git answers "no such ref" to most questions here, and the
// first run of pushready on a new project is exactly this state.

test('a repository with no commits at all is checked, not crashed on', (t) => {
  const dir = repo({}, { git: true, commit: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  // Nothing committed means nothing in history, and that is a pass, not an error.
  for (const id of ['env-tracked', 'dependencies-tracked', 'history-keys', 'history-credentials', 'history-data']) {
    assert.equal(status(results, id), 'pass', id);
  }
  assert.equal(status(results, 'history-scope'), 'pass');
  assert.equal(status(results, 'readme'), 'fail');
  assert.equal(cliRun(dir).status, 1);
});

test('a staged secret before the first commit says staged, not committed', (t) => {
  const dir = repo({ 'README.md': README, '.env': 'SECRET=1', 'deploy.pem': BLOB }, { commit: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'add', '-A');
  const results = runChecks(dir);
  const env = results.find((r) => r.id === 'env-tracked');
  assert.equal(env.status, 'fail');
  // The distinction that matters: nothing is in a commit, so there is nothing to
  // rotate and no history to rewrite — "git rm --cached" really is the whole fix.
  assert.match(env.message, /staged, not yet committed/);
  assert.match(env.fix, /never been in a commit/);
  // The .pem is staged too, but no commit has added it, so history is clean.
  assert.equal(status(results, 'history-keys'), 'pass');
  assert.equal(cliRun(dir).status, 1);
});

test('an empty folder that is a git repo reports no false findings', (t) => {
  const dir = repo({}, { git: true, commit: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout } = cliRun(dir);
  assert.doesNotMatch(stdout, /What to do next/);
  assert.doesNotMatch(stdout, /could not be checked/);
});

// --- Branches. "Which branch holds this?" drives both the wording and whether
// the file counts as history at all.

test('a secret on a second branch names that branch, not the one checked out', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '-b', 'feature/deploy');
  writeFileSync(join(dir, 'certs.pem'), BLOB);
  commitAll(dir, 'add cert');
  run(dir, 'checkout', '-q', '-');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.place, 'branch');
  assert.deepEqual(found.branches, ['feature/deploy']);
  assert.equal(found.present, false, 'not in the working tree of the branch we are on');
  // Not "deleted": it is on another branch, and was never in this checkout.
  assert.equal(found.onCurrentBranch, false);
  assert.match(cliRun(dir).stdout, /certs\.pem — not in your checkout, on feature\/deploy, local only/);
});

test('a secret on several branches says so, and counts the rest', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'shared.pem'), BLOB);
  commitAll(dir, 'add key');
  for (const name of ['release', 'hotfix']) run(dir, 'branch', name);
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.branches.length, 3, found.branches.join(', '));
  // One branch is named and the others are counted, so the line stays short.
  assert.match(cliRun(dir).stdout, /shared\.pem — still in the repo, on \S+ \+2, local only/);
});

test('a secret only on a branch someone else pushed is found and called pushed', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' });
  const theirs = mkdtempSync(join(tmpdir(), 'pushready-theirs-'));
  let remote;
  t.after(() => {
    for (const d of [dir, theirs, remote]) rmSync(d, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  // A collaborator pushes a key on their own branch; we only fetch it.
  run(theirs, 'clone', '-q', pathToFileURL(remote).href, 'clone');
  const clone = join(theirs, 'clone');
  run(clone, 'checkout', '-q', '-b', 'their-feature');
  writeFileSync(join(clone, 'their.pem'), BLOB);
  commitAll(clone, 'their key');
  run(clone, 'push', '-q', 'origin', 'their-feature');
  run(dir, 'fetch', '-q', 'origin');

  const results = runChecks(dir);
  const [found] = items(results, 'history-keys');
  assert.equal(found.exposure, 'pushed', 'it is on a remote, so it counts as out');
  assert.deepEqual(found.branches, [], 'no local branch holds it');
  assert.deepEqual(found.remotes, ['origin/their-feature']);
  assert.equal(cliRun(dir).status, 2);
  // Not "deleted": the file is alive on their branch, it was never in this
  // working tree to delete.
  assert.equal(found.onCurrentBranch, false);
  assert.match(cliRun(dir).stdout, /their\.pem — not in your checkout, on origin\/their-feature, pushed/);
});

test('a branch deleted after the fact still has its secret found', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '-b', 'spike');
  writeFileSync(join(dir, 'spike.pem'), BLOB);
  commitAll(dir, 'spike');
  run(dir, 'checkout', '-q', '-');
  run(dir, 'branch', '-q', '-D', 'spike');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.place, 'unreachable');
  assert.match(cliRun(dir).stdout, /nothing points at any more/);
});

test('the default branch name does not matter', (t) => {
  for (const name of ['main', 'master', 'trunk']) {
    const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' }, { git: false });
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    run(dir, 'init', '-q', '-b', name);
    writeFileSync(join(dir, 'key.pem'), BLOB);
    commitAll(dir, 'init');
    const [found] = items(runChecks(dir), 'history-keys');
    assert.deepEqual(found.branches, [name], name);
  }
});
