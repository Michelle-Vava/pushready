import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHECKS, exposureGuide, fence, isEnvFile, runChecks, snapshot } from '../src/index.js';

const MIT = 'MIT License\n\nPermission is hereby granted, free of charge, to any person...';
const README = '# Demo\n\nWhat it does.\n\n## Install\n\nnpm install\n\n## Use\n\nnpm start\n';

function repo(files, { git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pushready-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  if (git) {
    run(dir, 'init', '-q');
    commitAll(dir, 'init');
  }
  return dir;
}

function run(dir, ...args) {
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd: dir, stdio: 'ignore' });
}

function commitAll(dir, message) {
  run(dir, 'add', '-A', '-f');
  run(dir, 'commit', '-q', '--allow-empty', '-m', message);
}

function status(results, id) {
  return results.find((r) => r.id === id).status;
}

function items(results, id) {
  return results.find((r) => r.id === id).items ?? [];
}

// A bare repo standing in for a server, so "pushed" can be tested offline.
function pushTo(dir, branch = 'main') {
  const remote = mkdtempSync(join(tmpdir(), 'pushready-remote-'));
  execFileSync('git', ['init', '-q', '--bare', remote], { stdio: 'ignore' });
  run(dir, 'remote', 'add', 'origin', remote);
  run(dir, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  run(dir, 'fetch', '-q', 'origin');
  return remote;
}

test('isEnvFile matches secret files but not templates', () => {
  for (const p of ['.env', '.env.local', 'api/.env.production']) assert.ok(isEnvFile(p), p);
  for (const p of ['.env.example', '.env.sample', 'env.js', '.envrc.md', 'src/.env.template']) assert.ok(!isEnvFile(p), p);
});

test('clean repo passes everything', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': 'node_modules\n.env\n', 'package.json': '{}', '.env.example': 'KEY=' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.deepEqual(results.filter((r) => r.status !== 'pass'), []);
});

test('missing README, LICENSE and .gitignore fail', (t) => {
  const dir = repo({ 'index.js': '' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  for (const id of ['readme', 'license', 'gitignore']) assert.equal(status(results, id), 'fail', id);
});

test('short README and unknown license warn', (t) => {
  const dir = repo({ 'README.md': '# Hi', LICENSE: 'All rights reserved', '.gitignore': '.env\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(status(results, 'readme'), 'warn');
  assert.equal(status(results, 'license'), 'warn');
});

test('gitignore without node_modules warns in a Node project', (t) => {
  const dir = repo({ '.gitignore': '.env\n', 'package.json': '{}' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status(runChecks(dir), 'gitignore'), 'warn');
});

test('committed .env and node_modules fail', (t) => {
  const dir = repo({ '.env': 'SECRET=1', 'node_modules/x/index.js': '' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(status(results, 'env-tracked'), 'fail');
  assert.equal(status(results, 'node-modules-tracked'), 'fail');
});

test('.env deleted but still in history fails, without printing its contents', (t) => {
  const dir = repo({ '.env': 'SECRET=hunter2' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'rm', '-q', '.env');
  commitAll(dir, 'remove env');
  const results = runChecks(dir);
  assert.equal(status(results, 'env-tracked'), 'pass');
  assert.equal(status(results, 'history-credentials'), 'fail');
  assert.ok(!JSON.stringify(results).includes('hunter2'));
});

test('each risky category is reported by its own check', (t) => {
  const dir = repo({
    'deploy.pem': 'x',
    'service-account-prod.json': 'x',
    'dev.sqlite3': 'x',
    'README.md': README,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'rm', '-q', 'deploy.pem', 'service-account-prod.json', 'dev.sqlite3');
  commitAll(dir, 'remove risky files');
  const results = runChecks(dir);
  assert.equal(status(results, 'history-keys'), 'fail');
  assert.equal(status(results, 'history-credentials'), 'fail');
  // A leaked database cannot be rotated, so it asks for judgement rather than failing.
  assert.equal(status(results, 'history-data'), 'warn');
  assert.deepEqual(items(results, 'history-keys').map((i) => i.path), ['deploy.pem']);
  assert.deepEqual(items(results, 'history-data').map((i) => i.path), ['dev.sqlite3']);
});

test('public and conventional lookalikes are not flagged', (t) => {
  const dir = repo({
    'id_rsa.pub': 'x',
    'server.crt': 'x',
    'Thumbs.db': 'x',
    '.env.example': 'KEY=',
    'package-lock.json': '{}',
    'README.md': README,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  for (const id of ['history-keys', 'history-credentials', 'history-data']) {
    assert.equal(status(results, id), 'pass', id);
  }
});

test('a risky file still in the repo is reported, and says so', (t) => {
  const dir = repo({ 'certs/private.key': 'x', 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(status(results, 'history-keys'), 'fail');
  const [found] = items(results, 'history-keys');
  assert.equal(found.path, 'certs/private.key');
  assert.equal(found.present, true);
});

test('a tracked .env is reported once, by env-tracked only', (t) => {
  const dir = repo({ '.env': 'SECRET=1', 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(status(results, 'env-tracked'), 'fail');
  assert.equal(status(results, 'history-credentials'), 'pass');
});

test('a secret committed but never pushed is reported as local only', (t) => {
  const dir = repo({ 'deploy/id_rsa': 'x', 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'rm', '-q', 'deploy/id_rsa');
  commitAll(dir, 'remove key');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.path, 'deploy/id_rsa');
  assert.equal(found.present, false);
  assert.equal(found.exposure, 'local only');
});

test('a secret pushed then deleted is reported as pushed', (t) => {
  const dir = repo({ 'credentials.json': 'x', 'README.md': README });
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  run(dir, 'rm', '-q', 'credentials.json');
  commitAll(dir, 'remove credentials');
  const [found] = items(runChecks(dir), 'history-credentials');
  assert.equal(found.exposure, 'pushed');
  assert.ok(found.remotes.includes('origin/main'), found.remotes.join(','));
});

test('a secret on one unpushed branch names that branch', (t) => {
  const dir = repo({ 'README.md': README });
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  run(dir, 'checkout', '-q', '-b', 'feature/deploy');
  writeFileSync(join(dir, 'server.key'), 'x');
  commitAll(dir, 'add key');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.branch, 'feature/deploy');
  assert.deepEqual(found.branches, ['feature/deploy']);
  // The branch exists only locally, so this is a weaker claim than "local only".
  assert.equal(found.exposure, 'not on a remote');
});

test('a .env under a non-ASCII path is still found in history', (t) => {
  const dir = repo({ 'café/.env': 'SECRET=1' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'rm', '-q', 'café/.env');
  commitAll(dir, 'remove env');
  const results = runChecks(dir);
  assert.equal(status(results, 'history-credentials'), 'fail');
  assert.deepEqual(items(results, 'history-credentials').map((i) => i.path), ['café/.env']);
});

test('a file renamed into a risky name is still found in history', (t) => {
  const dir = repo({ 'notes.txt': 'x', 'old.pem': 'x', 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'mv', 'notes.txt', 'deploy.pem');
  commitAll(dir, 'rename notes');
  run(dir, 'mv', 'old.pem', 'archive.txt');
  commitAll(dir, 'rename old');
  const found = items(runChecks(dir), 'history-keys');
  // Both names count: the risky one a harmless file was renamed to, and the risky
  // one that was renamed away from. Either is enough to put the blob in history.
  assert.deepEqual(found.map((i) => i.path), ['deploy.pem', 'old.pem']);
  assert.equal(found.find((i) => i.path === 'deploy.pem').present, true);
  assert.equal(found.find((i) => i.path === 'old.pem').present, false);
  // The commit the risky name first appears in has to be found too, or the
  // branch and exposure columns come back empty.
  assert.ok(found.every((i) => i.commit), found.map((i) => `${i.path}=${i.commit}`).join(' '));
  assert.ok(found.every((i) => i.branch), found.map((i) => `${i.path}=${i.branch}`).join(' '));
});

// Enough lines that git's rename detection has something to match on.
const BLOB = 'line one\nline two\nline three\nline four\n';

test('the cleanup command covers every name a renamed file had', (t) => {
  const dir = repo({ 'deploy/id_rsa': BLOB, 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Renaming a key does not remove it: the old name is still in history, and now
  // the same content sits under a second name as well.
  run(dir, 'mv', 'deploy/id_rsa', 'deploy/key.backup');
  commitAll(dir, 'rename the deploy key');
  const results = runChecks(dir);
  const [found] = items(results, 'history-keys');
  assert.deepEqual(found.aliases, ['deploy/key.backup']);
  const text = exposureGuide(results).steps.flat().join('\n');
  // Removing only the risky name would leave the content behind under the other.
  assert.match(text, /--path "deploy\/id_rsa"/);
  assert.match(text, /--path "deploy\/key\.backup"/);
  assert.match(text, /also committed as/i);
});

test('a chain of renames is followed to every name in it', (t) => {
  const dir = repo({ 'notes.txt': BLOB, 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'mv', 'notes.txt', 'deploy.pem');
  commitAll(dir, 'rename to pem');
  mkdirSync(join(dir, 'archive'));
  run(dir, 'mv', 'deploy.pem', 'archive/old.txt');
  commitAll(dir, 'archive it');
  const results = runChecks(dir);
  const [found] = items(results, 'history-keys');
  // Only the middle name is risky, but all three hold the same content.
  assert.equal(found.path, 'deploy.pem');
  assert.deepEqual(found.aliases, ['archive/old.txt', 'notes.txt']);
  const text = exposureGuide(results).steps.flat().join('\n');
  for (const p of ['deploy\\.pem', 'archive/old\\.txt', 'notes\\.txt']) assert.match(text, new RegExp(`--path "${p}"`));
});

test('a secret pushed under an earlier name is still reported as pushed', (t) => {
  const dir = repo({ 'notes.txt': BLOB, 'README.md': README });
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  // The rename itself never leaves the machine, but the content already did.
  run(dir, 'mv', 'notes.txt', 'deploy.pem');
  commitAll(dir, 'rename to pem');
  const results = runChecks(dir);
  const [found] = items(results, 'history-keys');
  assert.equal(found.exposure, 'pushed');
  assert.match(exposureGuide(results).steps[0][0], /^Rotate or revoke these now: deploy\.pem/);
});

test('two risky names for the same file are listed once each', (t) => {
  const dir = repo({ 'a.pem': BLOB, 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'mv', 'a.pem', 'b.pem');
  commitAll(dir, 'rename');
  const results = runChecks(dir);
  assert.deepEqual(items(results, 'history-keys').map((i) => i.path), ['a.pem', 'b.pem']);
  const command = exposureGuide(results).steps.flat().find((l) => l.includes('filter-repo'));
  assert.equal(command.match(/--path /g).length, 2, command);
});

test('history is reported as unknown in a shallow clone, not passed', (t) => {
  const origin = repo({ 'README.md': README, '.env': 'SECRET=1' });
  const dir = mkdtempSync(join(tmpdir(), 'pushready-shallow-'));
  t.after(() => {
    rmSync(origin, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });
  // Add a second commit so --depth 1 genuinely leaves the .env commit out of reach.
  run(origin, 'rm', '-q', '.env');
  commitAll(origin, 'remove env');
  // --depth is ignored when cloning a local path, so a file:// URL is required.
  run(dir, 'clone', '-q', '--depth', '1', pathToFileURL(origin).href, 'clone');
  const clone = join(dir, 'clone');
  const results = runChecks(clone);
  assert.equal(status(results, 'history-credentials'), 'unknown');
  // The checks that read the working tree are still trustworthy here.
  assert.equal(status(results, 'env-tracked'), 'pass');
});

test('a clean repo gets no exposure guide', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': 'node_modules\n.env\n', 'package.json': '{}' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(exposureGuide(runChecks(dir)), null);
});

test('a pushed secret is told to rotate first, then force-push', (t) => {
  const dir = repo({ 'credentials.json': 'x', 'README.md': README });
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  run(dir, 'rm', '-q', 'credentials.json');
  commitAll(dir, 'remove credentials');
  const { steps, links } = exposureGuide(runChecks(dir));
  const text = steps.flat().join('\n');
  assert.match(steps[0][0], /^Rotate or revoke these now: credentials\.json/);
  assert.match(text, /will not un-leak them/);
  assert.match(text, /git filter-repo --invert-paths --path "credentials\.json"/);
  assert.match(steps.at(-1)[0], /Force-push/);
  assert.ok(links.length);
});

test('an unpushed secret is not told to rotate or force-push', (t) => {
  const dir = repo({ 'deploy/id_rsa': 'x', 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'rm', '-q', 'deploy/id_rsa');
  commitAll(dir, 'remove key');
  const { steps } = exposureGuide(runChecks(dir));
  const text = steps.flat().join('\n');
  assert.match(steps[0][0], /never left your machine/);
  assert.doesNotMatch(text, /Force-push/);
  assert.match(text, /--path "deploy\/id_rsa"/);
});

test('--history adds install and support detail, plain output stays short', (t) => {
  const dir = repo({ 'credentials.json': 'x', 'README.md': README });
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  const results = runChecks(dir);
  const short = exposureGuide(results);
  const full = exposureGuide(results, { detailed: true });
  assert.ok(full.steps.flat().length > short.steps.flat().length);
  assert.match(full.steps.flat().join('\n'), /fresh clone/);
  assert.match(full.steps.flat().join('\n'), /support\.github\.com/);
  assert.doesNotMatch(short.steps.flat().join('\n'), /support\.github\.com/);
});

test('paths that are hard to quote fall back to a file list', (t) => {
  const dir = repo({ 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A literal $ in the name would be expanded by a shell inside double quotes.
  writeFileSync(join(dir, 'we$rd.pem'), 'x');
  commitAll(dir, 'add key');
  const { steps } = exposureGuide(runChecks(dir));
  const text = steps.flat().join('\n');
  assert.match(text, /--paths-from-file/);
  assert.doesNotMatch(text, /--path "we\$rd\.pem"/);
});

test('an acknowledged finding stays visible but stops failing the run', (t) => {
  const dir = repo({
    'test/fixtures/dummy.pem': 'x',
    '.pushready.json': '{ "acknowledge": [ { "path": "test/fixtures/dummy.pem", "reason": "test key" } ] }',
    'README.md': README,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(status(results, 'history-keys'), 'acknowledged');
  const [found] = items(results, 'history-keys');
  assert.equal(found.acknowledged, true);
  assert.equal(found.reason, 'test key');
  // Accepted findings drop out of the list of things to go and do.
  assert.equal(exposureGuide(results), null);
});

test('one acknowledged finding does not excuse another', (t) => {
  const dir = repo({
    'a.pem': 'x',
    'b.pem': 'x',
    '.pushready.json': '{ "acknowledge": ["a.pem"] }',
    'README.md': README,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(status(results, 'history-keys'), 'fail');
  assert.match(exposureGuide(results).steps.flat().join('\n'), /--path "b\.pem"/);
  assert.doesNotMatch(exposureGuide(results).steps.flat().join('\n'), /--path "a\.pem"/);
});

test('a broken .pushready.json warns instead of being ignored', (t) => {
  const dir = repo({ '.pushready.json': '{ not json', 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status(runChecks(dir), 'acknowledgements'), 'warn');
});

test('a risky file that .gitignore lists is flagged as ignored, and explained', (t) => {
  const dir = repo({ '.gitignore': '*.pem\nnode_modules\n.env\n', 'deploy.pem': 'x', 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  const [found] = items(results, 'history-keys');
  assert.equal(found.ignored, true);
  const text = exposureGuide(results).steps.flat().join('\n');
  assert.match(text, /does not undo anything git has already recorded/);
  // It is still tracked, so the untrack command has to be part of the advice.
  assert.match(text, /git rm --cached "deploy\.pem"/);
});

test('a single-branch clone reports that the history is incomplete', (t) => {
  const origin = repo({ 'README.md': README, 'old.pem': 'x' });
  const dir = mkdtempSync(join(tmpdir(), 'pushready-single-'));
  t.after(() => {
    rmSync(origin, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });
  run(origin, 'branch', '-M', 'main');
  run(dir, 'clone', '-q', '--single-branch', '--branch', 'main', pathToFileURL(origin).href, 'clone');
  const results = runChecks(join(dir, 'clone'));
  assert.equal(status(results, 'history-scope'), 'unknown');
  assert.match(results.find((r) => r.id === 'history-scope').message, /only one branch was cloned/);
});

test('the exit code separates a pushed secret from a local one', (t) => {
  const local = repo({ 'id_rsa': 'x', 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' });
  const pushedRepo = repo({ 'id_rsa': 'x', 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' });
  let remote;
  t.after(() => {
    rmSync(local, { recursive: true, force: true });
    rmSync(pushedRepo, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(pushedRepo);
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const exitCode = (d) => spawnSync(process.execPath, [cli, d], { encoding: 'utf8' }).status;
  assert.equal(exitCode(local), 1);
  assert.equal(exitCode(pushedRepo), 2);
  assert.equal(exitCode(join(local, 'no-such-folder')), 64);
});

test('git checks are skipped outside a git repository', (t) => {
  const dir = repo({ 'README.md': README }, { git: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  for (const id of ['env-tracked', 'node-modules-tracked', 'history-keys', 'history-credentials', 'history-data']) assert.equal(status(results, id), 'skip', id);
});

// --- Where a commit lives decides the advice. A branch is history; a stash, a
// leftover ref or a detached HEAD is not, and "rewrite history" is the wrong tool.

test('a secret only in a stash is told to drop the stash, not rewrite history', (t) => {
  const dir = repo({ 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'first.pem'), BLOB);
  run(dir, 'add', 'first.pem');
  run(dir, 'stash', '-q');
  // A second stash on top, so first.pem is only in stash@{1}, which is not a ref
  // at all: "git log --all" cannot see it.
  writeFileSync(join(dir, 'second.pem'), BLOB.replace(/line/g, 'other'));
  run(dir, 'stash', '-q', '-u');
  const results = runChecks(dir);
  assert.equal(status(results, 'history-keys'), 'fail');
  const found = items(results, 'history-keys');
  assert.deepEqual(found.map((i) => [i.path, i.place, i.stashes]), [
    ['first.pem', 'stash', ['stash@{1}']],
    ['second.pem', 'stash', ['stash@{0}']],
  ]);
  // A stash cannot be pushed, so this is the strong claim even with a remote.
  for (const i of found) assert.equal(i.exposure, 'local only');
  const text = exposureGuide(results).steps.flat().join('\n');
  assert.doesNotMatch(text, /filter-repo/);
  assert.doesNotMatch(text, /git fetch/);
  // Numbers shift after each drop, so the higher one has to go first.
  assert.ok(text.indexOf('git stash drop stash@{1}') < text.indexOf('git stash drop stash@{0}'), text);
});

test('a secret on a branch and also in a stash is history, and gets history advice', (t) => {
  const dir = repo({ 'deploy.pem': BLOB, 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'deploy.pem'), `${BLOB}more\n`);
  run(dir, 'stash', '-q');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.place, 'branch');
  assert.deepEqual(found.stashes, []);
});

test('a secret only on a tag says so, and hedges about whether tags were pushed', (t) => {
  const dir = repo({ 'README.md': README });
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  run(dir, 'checkout', '-q', '-b', 'release');
  writeFileSync(join(dir, 'rel.pem'), BLOB);
  commitAll(dir, 'add key');
  run(dir, 'tag', 'v1.0');
  run(dir, 'checkout', '-q', 'main');
  run(dir, 'branch', '-q', '-D', 'release');
  const results = runChecks(dir);
  const [found] = items(results, 'history-keys');
  assert.equal(found.place, 'tag');
  assert.deepEqual(found.tags, ['v1.0']);
  assert.deepEqual(found.branches, []);
  const text = exposureGuide(results).steps.flat().join('\n');
  // Still history, so still a rewrite — but the reassurance has to be withdrawn.
  assert.match(text, /--path "rel\.pem"/);
  assert.match(text, /v1\.0/);
  assert.match(text, /push --tags/);
});

test('a secret kept only by a filter-branch backup ref is told to delete the ref', (t) => {
  const dir = repo({ 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'old.pem'), BLOB);
  commitAll(dir, 'add key');
  // What git filter-branch leaves behind: the pre-rewrite branch, parked under
  // refs/original/, still pointing at the commit that has the key.
  run(dir, 'update-ref', 'refs/original/refs/heads/main', 'HEAD');
  run(dir, 'reset', '-q', '--hard', 'HEAD~1');
  const results = runChecks(dir);
  const [found] = items(results, 'history-keys');
  assert.equal(found.place, 'ref');
  assert.deepEqual(found.refs, ['refs/original/refs/heads/main']);
  const text = exposureGuide(results).steps.flat().join('\n');
  assert.doesNotMatch(text, /filter-repo/);
  assert.match(text, /git update-ref -d "refs\/original\/refs\/heads\/main"/);
});

test('a secret committed on a detached HEAD is located, not reported as nowhere', (t) => {
  const dir = repo({ 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '--detach');
  writeFileSync(join(dir, 'dh.pem'), BLOB);
  commitAll(dir, 'detached key');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.place, 'head');
  assert.match(exposureGuide(runChecks(dir)).steps.flat().join('\n'), /detached HEAD/);
});

test('a staged .env that was never committed is not called committed', (t) => {
  const dir = repo({ 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '.env'), 'KEY=1');
  run(dir, 'add', '.env');
  const results = runChecks(dir);
  const env = results.find((r) => r.id === 'env-tracked');
  assert.equal(env.status, 'fail');
  assert.match(env.message, /staged, not yet committed/);
  assert.doesNotMatch(env.message, /^Secret file\(s\) committed/);
  // Nothing is in any commit, so there is nothing to rotate and nothing to rewrite.
  assert.doesNotMatch(env.fix, /rotate/);
  assert.equal(status(results, 'history-credentials'), 'pass');
});

// --- Case, new patterns, and commits that no ref points at any more.

test('a .ENV in capitals is found, and templates stay excluded whatever their case', () => {
  for (const p of ['.ENV', '.Env.Local', 'api/.ENV.PRODUCTION']) assert.ok(isEnvFile(p), p);
  for (const p of ['.ENV.EXAMPLE', '.Env.Sample', 'ENV.js']) assert.ok(!isEnvFile(p), p);
});

test('an uppercase .ENV is reported by the tracked and history checks alike', (t) => {
  const dir = repo({ '.ENV': 'SECRET=1', 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status(runChecks(dir), 'env-tracked'), 'fail');
  run(dir, 'rm', '-q', '.ENV');
  commitAll(dir, 'remove env');
  assert.equal(status(runChecks(dir), 'history-credentials'), 'fail');
});

test('the agreed extra names are matched, in the right category', (t) => {
  const dir = repo({
    'kubeconfig': 'x',
    '.pgpass': 'x',
    'terraform.tfstate': 'x',
    'terraform.tfstate.backup': 'x',
    'keystore.jks': 'x',
    'release.keystore': 'x',
    'server.ppk': 'x',
    'README.md': README,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  const paths = (id) => items(results, id).map((i) => i.path).sort();
  assert.deepEqual(paths('history-keys'), ['keystore.jks', 'release.keystore', 'server.ppk']);
  assert.deepEqual(paths('history-credentials'), ['.pgpass', 'kubeconfig', 'terraform.tfstate', 'terraform.tfstate.backup']);
});

test('names that merely look similar are still not flagged', (t) => {
  const dir = repo({
    'kubeconfig.example': 'x',
    'main.tf': 'x',
    'keystore.md': 'x',
    'docs/terraform.tfstate.md': 'x',
    'README.md': README,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  for (const id of ['history-keys', 'history-credentials', 'history-data']) assert.equal(status(results, id), 'pass', id);
});

test('a secret amended out of a commit is still found, and is not history', (t) => {
  const dir = repo({ 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'amended.pem'), BLOB);
  writeFileSync(join(dir, 'other.txt'), 'keeps the commit non-empty\n');
  commitAll(dir, 'oops, committed a key');
  run(dir, 'rm', '-q', 'amended.pem');
  run(dir, 'commit', '-q', '--amend', '-m', 'clean commit');
  const results = runChecks(dir);
  assert.equal(status(results, 'history-keys'), 'fail');
  const [found] = items(results, 'history-keys');
  assert.equal(found.path, 'amended.pem');
  assert.equal(found.place, 'unreachable');
  const text = exposureGuide(results).steps.flat().join('\n');
  // No ref points at it, so there is nothing for filter-repo to rewrite.
  assert.doesNotMatch(text, /filter-repo/);
  assert.match(text, /reflog expire/);
  assert.match(text, /gc --prune=now/);
});

test('a secret on a deleted branch is still found', (t) => {
  const dir = repo({ 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'checkout', '-q', '-b', 'gone');
  writeFileSync(join(dir, 'gone.pem'), BLOB);
  commitAll(dir, 'key on a branch');
  run(dir, 'checkout', '-q', '-');
  run(dir, 'branch', '-q', '-D', 'gone');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.path, 'gone.pem');
  assert.equal(found.place, 'unreachable');
});

test('a secret in a dropped stash is still found', (t) => {
  const dir = repo({ 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'dropped.pem'), BLOB);
  run(dir, 'add', 'dropped.pem');
  run(dir, 'stash');
  run(dir, 'stash', 'drop');
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.path, 'dropped.pem');
  assert.equal(found.place, 'unreachable');
});

test('a submodule is reported as something the checks cannot see into', (t) => {
  const dir = repo({ 'README.md': README, '.gitmodules': '[submodule "vendor"]\n\tpath = vendor\n\turl = ../x\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A gitlink, written directly, rather than a real "git submodule add" (which
  // needs a second repo and a file:// protocol override). What matters to the
  // check is the 160000 mode, not what the commit it names is.
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  run(dir, 'update-index', '--add', '--cacheinfo', `160000,${sha},vendor`);
  // Commit the index as it stands: "git add -A" would stage the gitlink's own
  // deletion, because there is no vendor/ directory on disk.
  run(dir, 'commit', '-q', '-m', 'add submodule');
  const results = runChecks(dir);
  assert.equal(status(results, 'history-scope'), 'unknown');
  assert.match(results.find((r) => r.id === 'history-scope').message, /submodule/i);
});

// --- The snapshot: what checks may read, and what they only read once.

// A repo that makes every check do real work, so the fence sees the branches
// that matter rather than just the early returns.
function busyRepo() {
  const dir = repo({
    'README.md': README,
    LICENSE: MIT,
    '.gitignore': '*.pem\nnode_modules\n.env\n',
    'package.json': '{}',
    '.pushready.json': '{ "acknowledge": ["fixtures/dummy.key"] }',
    'fixtures/dummy.key': BLOB,
    'deploy.pem': BLOB,
    'credentials.json': 'x',
    'dev.sqlite3': 'x',
    'node_modules/left-pad/index.js': '',
    '.env': 'SECRET=1',
  });
  run(dir, 'rm', '-q', 'credentials.json');
  commitAll(dir, 'remove credentials');
  return dir;
}

test('every check declares the snapshot fields it reads', (t) => {
  const dir = busyRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const snap = snapshot(dir);
  for (const check of CHECKS) {
    // Throws on any field the check did not list in `reads`.
    assert.doesNotThrow(() => check.run(fence(snap, check.reads)), `${check.id} read an undeclared snapshot field`);
  }
});

test('the fence catches a check that reads something it did not declare', () => {
  const sneaky = { id: 'sneaky', reads: ['tracked'], run: (s) => s.committed() };
  assert.throws(() => sneaky.run(fence(snapshot('.'), sneaky.reads)), /undeclared snapshot read: committed/);
});

test('the snapshot refuses to open a file that could hold a secret', (t) => {
  const dir = repo({ 'README.md': README, '.env': 'SECRET=hunter2', 'deploy.pem': BLOB, 'package.json': '{}' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const snap = snapshot(dir);
  for (const allowed of ['README.md', '.gitignore', 'package.json', '.pushready.json', 'LICENSE']) {
    // Allowed by name: whether the file exists is a separate question.
    assert.doesNotThrow(() => { try { snap.readFile(allowed); } catch (e) { if (e.code !== 'ENOENT') throw e; } }, allowed);
  }
  for (const refused of ['.env', 'deploy.pem', 'dev.sqlite3', 'src/index.js', '.env.local']) {
    assert.throws(() => snap.readFile(refused), /only opens README/, refused);
  }
});

test('the snapshot shares one history walk across the three category checks', (t) => {
  const dir = busyRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const snap = snapshot(dir);
  let walks = 0;
  const counted = new Proxy(snap, {
    get: (target, key) => (key === 'risky' ? () => { walks++; return target.risky(); } : target[key]),
  });
  for (const check of CHECKS.filter((c) => c.id.startsWith('history-') && c.id !== 'history-scope')) check.run(counted);
  // Three checks ask; the underlying walk happens once and is remembered.
  assert.equal(walks, 3);
  assert.equal(snap.risky(), snap.risky());
});

test('a snapshot does no git work until a check asks for some', (t) => {
  const dir = busyRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const snap = snapshot(dir);
  // Building it is free, and so is running the checks that only read files.
  for (const check of CHECKS.filter((c) => !c.needsGit)) check.run(fence(snap, check.reads));
  assert.equal(CHECKS.filter((c) => !c.needsGit).map((c) => c.id).join(','), 'readme,license,gitignore');
});
