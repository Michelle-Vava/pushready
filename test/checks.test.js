import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exposureGuide, isEnvFile, runChecks } from '../src/checks.js';

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
