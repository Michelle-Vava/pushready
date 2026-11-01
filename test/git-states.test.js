// Repositories in states git allows but a tool rarely expects: a detached HEAD,
// an orphan branch, a half-finished merge or rebase, a linked worktree, a bare
// repo, packed refs. Each one changes the answer to "what holds this commit?",
// which is the question every history finding depends on.
//
// The point of most of these is not that pushready does something clever. It is
// that it does not silently do something wrong — a secret stays found, and
// where it lives stays truthful.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exposureGuide, runChecks } from '../src/index.js';
import { BLOB, MIT, README, cleanUp, cliRun, commitAll, guideText, items, pushTo, repo, run, status } from './helpers.js';

const project = (extra = {}) => repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', ...extra });
const adviceFor = (results) => guideText(exposureGuide(results));

// --- Detached HEAD. The commit is reachable, but from nothing that survives
// checking out anything else, so the advice must not be "rewrite history".

test('a secret committed on a detached HEAD is held by HEAD alone', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '--detach');
  writeFileSync(join(dir, 'loose.pem'), BLOB);
  commitAll(dir, 'key on a detached HEAD');
  const results = runChecks(dir);
  const [found] = items(results, 'history-keys');
  assert.equal(found.place, 'head');
  assert.deepEqual(found.branches, []);
  // Not history: checking out a branch is the fix, not git filter-repo.
  assert.match(adviceFor(results), /detached HEAD/);
  assert.doesNotMatch(adviceFor(results), /filter-repo/);
  assert.match(cliRun(dir).stdout, /loose\.pem — on a detached HEAD, not on any branch/);
});

test('a detached HEAD on a commit a branch also holds is reported as that branch', (t) => {
  const dir = project({ 'key.pem': BLOB });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '--detach');
  const [found] = items(runChecks(dir), 'history-keys');
  // A branch holds it, so detaching changes nothing about where it lives.
  assert.equal(found.place, 'branch');
  assert.equal(found.branches.length, 1);
});

test('a detached HEAD at a tag is reported as the tag, not as a loose HEAD', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '-b', 'release');
  writeFileSync(join(dir, 'rel.pem'), BLOB);
  commitAll(dir, 'release key');
  run(dir, 'tag', 'v1.0');
  run(dir, 'checkout', '-q', '-');
  run(dir, 'branch', '-q', '-D', 'release');
  run(dir, 'checkout', '-q', '--detach', 'v1.0');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.place, 'tag', 'a tag outranks HEAD: it survives checking out something else');
  assert.deepEqual(found.tags, ['v1.0']);
});

test('leaving a detached HEAD turns its commit into an unreachable one', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '--detach');
  writeFileSync(join(dir, 'abandoned.pem'), BLOB);
  commitAll(dir, 'key then walk away');
  run(dir, 'checkout', '-q', '-');
  const results = runChecks(dir);
  const [found] = items(results, 'history-keys');
  assert.equal(found.place, 'unreachable', 'still on disk, still findable, held by nothing');
  assert.match(adviceFor(results), /reflog expire/);
});

// --- Other shapes of "which ref holds this".

test('a secret on an orphan branch names that branch', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // An orphan branch shares no history with main at all.
  run(dir, 'checkout', '-q', '--orphan', 'gh-pages');
  writeFileSync(join(dir, 'deploy.pem'), BLOB);
  commitAll(dir, 'orphan root commit');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.place, 'branch');
  assert.deepEqual(found.branches, ['gh-pages']);
});

test('an annotated tag holds a commit just as a lightweight one does', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '-b', 'release');
  writeFileSync(join(dir, 'signed.pem'), BLOB);
  commitAll(dir, 'key');
  run(dir, 'tag', '-a', 'v2.0', '-m', 'release two');
  run(dir, 'checkout', '-q', '-');
  run(dir, 'branch', '-q', '-D', 'release');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.place, 'tag');
  assert.deepEqual(found.tags, ['v2.0']);
});

test('packing the refs does not hide anything', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '-b', 'feature');
  writeFileSync(join(dir, 'packed.pem'), BLOB);
  commitAll(dir, 'key');
  run(dir, 'checkout', '-q', '-');
  // After this the refs live in .git/packed-refs rather than as loose files.
  run(dir, 'pack-refs', '--all');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.deepEqual(found.branches, ['feature']);
});

test('a remote that exists but has never been fetched is not treated as pushed', (t) => {
  const dir = project({ 'unsent.pem': BLOB });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A remote is configured, but there are no remote-tracking refs at all.
  run(dir, 'remote', 'add', 'origin', 'https://example.invalid/repo.git');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.exposure, 'not on a remote');
  // The honest hedge, because this clone cannot know what the remote has.
  assert.match(adviceFor(runChecks(dir)), /Run "git fetch" if you are not sure/);
  assert.equal(cliRun(dir).status, 1, 'not exit 2: nothing is known to have been pushed');
});

// --- Half-finished operations. The index and HEAD are in an unusual state and
// a careless "git" call can fail outright.

test('a conflicted merge in progress does not stop the checks', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'f.txt': 'base\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '-b', 'other');
  writeFileSync(join(dir, 'f.txt'), 'theirs\n');
  writeFileSync(join(dir, 'merge.pem'), BLOB);
  commitAll(dir, 'their side');
  run(dir, 'checkout', '-q', '-');
  writeFileSync(join(dir, 'f.txt'), 'ours\n');
  commitAll(dir, 'our side');
  try {
    run(dir, 'merge', 'other', '-m', 'merge');
  } catch {
    // Expected: the merge stops with a conflict, which is the state under test.
  }
  const results = runChecks(dir);
  assert.equal(status(results, 'history-keys'), 'fail');
  assert.deepEqual(items(results, 'history-keys').map((i) => i.path), ['merge.pem']);
  assert.equal(cliRun(dir).status, 1);
});

test('a rebase in progress does not stop the checks', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'f.txt': 'base\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '-b', 'topic');
  writeFileSync(join(dir, 'f.txt'), 'topic\n');
  writeFileSync(join(dir, 'rebase.pem'), BLOB);
  commitAll(dir, 'topic work');
  run(dir, 'checkout', '-q', '-');
  writeFileSync(join(dir, 'f.txt'), 'main\n');
  commitAll(dir, 'main work');
  run(dir, 'checkout', '-q', 'topic');
  try {
    run(dir, 'rebase', 'main');
  } catch {
    // Expected: the rebase stops on the conflict and leaves .git/rebase-merge.
  }
  const results = runChecks(dir);
  assert.equal(status(results, 'history-keys'), 'fail');
  assert.ok(items(results, 'history-keys').some((i) => i.path === 'rebase.pem'));
});

// --- Where the repository itself is unusual.

test('a linked worktree is checked like any other folder', (t) => {
  const main = project({ 'shared.pem': BLOB });
  const where = mkdtempSync(join(tmpdir(), 'pushready-wt-'));
  const linked = join(where, 'wt');
  t.after(() => {
    rmSync(where, { recursive: true, force: true });
    rmSync(main, { recursive: true, force: true });
  });
  // In a linked worktree, .git is a file pointing elsewhere, not a folder.
  run(main, 'worktree', 'add', '-q', linked, '-b', 'second');
  const results = runChecks(linked);
  assert.equal(status(results, 'history-keys'), 'fail');
  assert.deepEqual(items(results, 'history-keys').map((i) => i.path), ['shared.pem']);
});

// A bare repository has no working tree, so "No README found" is not a finding
// about the project, it is a statement about the wrong folder. Until 1 Nov 2026
// pushready said exactly that, and exited 1.
test('a bare repository is refused by name, not reported as a project', (t) => {
  const where = mkdtempSync(join(tmpdir(), 'pushready-nowt-'));
  const bare = join(where, 'repo.git');
  t.after(() => cleanUp(where));
  execFileSync('git', ['init', '-q', '--bare', bare], { stdio: 'ignore' });
  const { stdout, stderr, status: code } = cliRun(bare);
  assert.equal(code, 64, 'used wrongly, rather than a green run that checked nothing');
  assert.equal(stdout, '', 'no report about a folder that is not a project');
  assert.match(stderr, /is a bare repository/);
  assert.match(stderr, /Run pushready on a clone of it instead/);
});

test('the library skips every check on a bare repository, with the reason', (t) => {
  const where = mkdtempSync(join(tmpdir(), 'pushready-nowt2-'));
  const bare = join(where, 'repo.git');
  t.after(() => cleanUp(where));
  execFileSync('git', ['init', '-q', '--bare', bare], { stdio: 'ignore' });
  const results = runChecks(bare);
  // Not a crash and not a false finding: every check says why it did not run.
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.equal(r.status, 'skip', r.id);
    assert.match(r.message, /bare repository/);
  }
});

test('a normal repository is not mistaken for a bare one', (t) => {
  const dir = project({ 'k.pem': BLOB });
  t.after(() => cleanUp(dir));
  assert.equal(cliRun(dir).status, 1);
  assert.doesNotMatch(cliRun(dir).stdout, /bare/i);
});

test('a repository inside a folder with a space in its name is checked', (t) => {
  const where = mkdtempSync(join(tmpdir(), 'pushready-space-'));
  const dir = join(where, 'my project');
  t.after(() => rmSync(where, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', dir], { stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), README);
  writeFileSync(join(dir, 'odd.pem'), BLOB);
  commitAll(dir, 'init');
  const results = runChecks(dir);
  assert.deepEqual(items(results, 'history-keys').map((i) => i.path), ['odd.pem']);
  assert.equal(cliRun(dir).status, 1);
});

test('a pushed secret stays pushed after the local branch is deleted', (t) => {
  const dir = project();
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  run(dir, 'checkout', '-q', '-b', 'leak');
  writeFileSync(join(dir, 'gone.pem'), BLOB);
  commitAll(dir, 'leak');
  run(dir, 'push', '-q', 'origin', 'leak');
  run(dir, 'fetch', '-q', 'origin');
  run(dir, 'checkout', '-q', '-');
  run(dir, 'branch', '-q', '-D', 'leak');
  const results = runChecks(dir);
  const [found] = items(results, 'history-keys');
  // The local branch is gone but the remote-tracking one is not, so this is
  // still the serious case: it is out there.
  assert.equal(found.exposure, 'pushed');
  assert.deepEqual(found.remotes, ['origin/leak']);
  assert.equal(cliRun(dir).status, 2);
  assert.match(adviceFor(results), /Rotate or revoke these now/);
});

// --- Two bugs reported on 31 Oct 2026, each reproduced before it was fixed.

test('a secret first introduced inside a merge commit is found', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'f.txt': 'base\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '-b', 'side');
  writeFileSync(join(dir, 'f.txt'), 'side\n');
  commitAll(dir, 'side');
  run(dir, 'checkout', '-q', '-');
  writeFileSync(join(dir, 'f.txt'), 'main\n');
  commitAll(dir, 'main');
  try {
    run(dir, 'merge', 'side', '-m', 'merge');
  } catch {
    // The conflict is the point: resolving it is when people add files by hand.
  }
  writeFileSync(join(dir, 'f.txt'), 'resolved\n');
  // The key exists in no commit on either side. It is born in the merge itself.
  writeFileSync(join(dir, 'merge-only.pem'), BLOB);
  commitAll(dir, 'merge side, and a key nobody meant to add');
  const results = runChecks(dir);
  assert.equal(status(results, 'history-keys'), 'fail');
  const [found] = items(results, 'history-keys');
  assert.equal(found.path, 'merge-only.pem');
  assert.equal(found.place, 'branch');
  assert.ok(found.commit, 'the merge commit is named as where it was added');
  assert.equal(found.present, true);
});

test('a file renamed into a risky name inside a merge commit is still followed', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'notes.txt': BLOB });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '-b', 'side');
  writeFileSync(join(dir, 'other.txt'), 'x\n');
  commitAll(dir, 'side');
  run(dir, 'checkout', '-q', '-');
  writeFileSync(join(dir, 'another.txt'), 'y\n');
  commitAll(dir, 'main');
  run(dir, 'merge', '-q', '--no-commit', '--no-ff', 'side');
  run(dir, 'mv', 'notes.txt', 'deploy.pem');
  commitAll(dir, 'merge, renaming on the way');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.path, 'deploy.pem');
  assert.deepEqual(found.aliases, ['notes.txt'], 'the old name is still the same content in history');
});

test('running on a subfolder checks the whole repository, and says so', (t) => {
  const dir = repo({
    'README.md': README,
    LICENSE: MIT,
    '.gitignore': '.env\n',
    'src/app.js': 'x\n',
    'src/.env': 'SECRET=1',
    'src/deploy.pem': BLOB,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fromRoot = runChecks(dir);
  const fromSub = runChecks(join(dir, 'src'));
  // Identical findings, with repository-relative paths, whichever folder was named.
  assert.deepEqual(fromSub, fromRoot);
  assert.equal(status(fromSub, 'readme'), 'pass', 'the README at the root is seen');
  assert.deepEqual(items(fromSub, 'env-tracked').map((i) => i.path), ['src/.env']);
  assert.deepEqual(items(fromSub, 'history-credentials'), [], 'reported once, not again under a second spelling');
  const [pem] = items(fromSub, 'history-keys');
  assert.equal(pem.present, true, 'not "deleted": it is right there');
  assert.equal(pem.place, 'branch', 'not "on no branch"');
  const { stdout } = cliRun(join(dir, 'src'));
  assert.match(stdout, /src is inside this repository, so the whole repository is checked/);
  assert.ok(stdout.includes(`Checking ${dir}`), 'the root is the folder named in the header');
});

test('a subfolder that is not inside any repository is still just a folder', (t) => {
  const dir = repo({ 'README.md': README, 'sub/notes.txt': 'x\n' }, { git: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout, status: code } = cliRun(join(dir, 'sub'));
  assert.equal(code, 1);
  assert.match(stdout, /No README found/);
  assert.doesNotMatch(stdout, /inside this repository/);
});
