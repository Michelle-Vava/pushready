import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHECKS, KINDS, RISKY_CATEGORIES, SEVERITIES, exposureGuide, fence, guideLines, isEnvFile, runChecks, snapshot } from '../src/index.js';
import { historyLimits, repoContext } from '../src/history.js';
import { BLOB, CLI, MIT, README, cliRun, commitAll, guideText, items, pushTo, repo, run, status } from './helpers.js';

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
  assert.equal(status(results, 'dependencies-tracked'), 'fail');
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
  // Not falsely clean: the history check says what it deferred.
  assert.match(results.find((r) => r.id === 'history-credentials').message, /^No other credential files/);
  assert.deepEqual(items(results, 'env-tracked').map((i) => i.path), ['.env']);
  assert.deepEqual(items(results, 'history-credentials'), []);
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
  const text = guideText(exposureGuide(results));
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
  const text = guideText(exposureGuide(results));
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
  const [first] = exposureGuide(results).steps;
  assert.equal(first.id, 'rotate', 'rotating comes before any cleanup');
  assert.match(first.actions[0].text, /^Rotate or revoke these now: deploy\.pem/);
});

test('two risky names for the same file are listed once each', (t) => {
  const dir = repo({ 'a.pem': BLOB, 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'mv', 'a.pem', 'b.pem');
  commitAll(dir, 'rename');
  const results = runChecks(dir);
  assert.deepEqual(items(results, 'history-keys').map((i) => i.path), ['a.pem', 'b.pem']);
  const command = guideLines(exposureGuide(results)).find((l) => l.includes('filter-repo'));
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
  const text = guideLines({ steps }).join('\n');
  assert.equal(steps[0].id, 'rotate');
  assert.match(steps[0].actions[0].text, /^Rotate or revoke these now: credentials\.json/);
  assert.match(text, /will not un-leak them/);
  assert.match(text, /git filter-repo --invert-paths --path "credentials\.json"/);
  assert.equal(steps.at(-1).id, 'force-push', 'and force-pushing comes last');
  assert.match(steps.at(-1).actions[0].text, /Force-push/);
  assert.ok(links.length);
});

test('an unpushed secret is not told to rotate or force-push', (t) => {
  const dir = repo({ 'deploy/id_rsa': 'x', 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, 'rm', '-q', 'deploy/id_rsa');
  commitAll(dir, 'remove key');
  const { steps } = exposureGuide(runChecks(dir));
  const text = guideLines({ steps }).join('\n');
  assert.match(steps[0].actions[0].text, /never left your machine/);
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
  assert.ok(guideLines(full).length > guideLines(short).length);
  assert.match(guideText(full), /fresh clone/);
  assert.match(guideText(full), /support\.github\.com/);
  assert.doesNotMatch(guideText(short), /support\.github\.com/);
});

test('paths that are hard to quote fall back to a file list', (t) => {
  const dir = repo({ 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A literal $ in the name would be expanded by a shell inside double quotes.
  writeFileSync(join(dir, 'we$rd.pem'), 'x');
  commitAll(dir, 'add key');
  const { steps } = exposureGuide(runChecks(dir));
  const text = guideLines({ steps }).join('\n');
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
  assert.match(guideText(exposureGuide(results)), /--path "b\.pem"/);
  assert.doesNotMatch(guideText(exposureGuide(results)), /--path "a\.pem"/);
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
  const text = guideText(exposureGuide(results));
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
  for (const id of ['env-tracked', 'dependencies-tracked', 'history-keys', 'history-credentials', 'history-data']) assert.equal(status(results, id), 'skip', id);
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
  const text = guideText(exposureGuide(results));
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
  const text = guideText(exposureGuide(results));
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
  const text = guideText(exposureGuide(results));
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
  assert.match(guideText(exposureGuide(runChecks(dir))), /detached HEAD/);
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
  const text = guideText(exposureGuide(results));
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
  // The checks that only read files, named by what they read rather than by id,
  // so adding one to the list is a deliberate act.
  const FILE_FIELDS = ['files', 'has', 'readFile'];
  const fileOnly = CHECKS.filter((c) => c.reads.every((field) => FILE_FIELDS.includes(field)));
  assert.equal(fileOnly.map((c) => c.id).join(','), 'readme,license,gitignore');

  const snap = snapshot(dir);
  // Building the snapshot is free, and so is deciding whether these apply and
  // running them — including appliesTo, which asks whether the repo is bare.
  for (const check of fileOnly) {
    assert.equal(check.appliesTo(snap), true, check.id);
    check.run(fence(snap, check.reads));
  }

  // End to end: --only on those three spawns no git process at all. GIT_TRACE
  // would create the file the moment one started.
  const trace = join(dir, 'trace.log');
  spawnSync(process.execPath, [CLI, dir, '--only', fileOnly.map((c) => c.id).join(',')], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', GIT_TRACE: trace },
  });
  assert.equal(existsSync(trace), false, 'a git process ran for a file-only check');
});

// --- v0.3.1: the six small gaps found reviewing v0.3.0. Each test was seen
// failing against v0.3.0 before its fix landed.

test('check ids are unique', () => {
  const ids = CHECKS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(', '));
});

test('the summary counts skipped checks outside a git repository', (t) => {
  const dir = repo({ 'README.md': README }, { git: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout, status: code } = cliRun(dir);
  assert.equal(code, 1);
  assert.match(stdout, /6 skipped/);
});

test('an unknown flag is rejected and named, with exit 64', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const flag of ['--hsitory', '--jsno', '-x']) {
    const { stderr, status: code } = cliRun(dir, flag);
    assert.equal(code, 64, flag);
    assert.match(stderr, new RegExp(`unknown option.*${flag}`), flag);
  }
  // The known ones still work, in either order.
  assert.equal(cliRun(dir, '--history').status, 0);
  assert.equal(cliRun('--history', dir).status, 0);
});

test('an acknowledged finding outside history is not described as in history', (t) => {
  const dir = repo({ 'README.md': README, '.pushready.json': '{ "acknowledge": ["only.pem"] }' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'only.pem'), BLOB);
  run(dir, 'add', 'only.pem');
  run(dir, 'stash', '-q');
  const results = runChecks(dir);
  const keys = results.find((r) => r.id === 'history-keys');
  assert.equal(keys.status, 'acknowledged');
  assert.equal(keys.items[0].place, 'stash');
  assert.doesNotMatch(keys.message, /in git history/);
  assert.match(keys.message, /outside its history, acknowledged/);
});

test('a data file only on a tag gets the same tag hedge as a credential', (t) => {
  const dir = repo({ 'README.md': README });
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  run(dir, 'checkout', '-q', '-b', 'release');
  writeFileSync(join(dir, 'users.db'), BLOB);
  commitAll(dir, 'add db');
  run(dir, 'tag', 'v1.0');
  run(dir, 'checkout', '-q', 'main');
  run(dir, 'branch', '-q', '-D', 'release');
  const results = runChecks(dir);
  const [found] = items(results, 'history-data');
  assert.equal(found.place, 'tag');
  const text = guideText(exposureGuide(results));
  assert.match(text, /users\.db is only on tag v1\.0/);
  assert.match(text, /push --tags/);
});

test('only a real .gitignore rule satisfies the .gitignore check', (t) => {
  const check = (gitignore) => {
    const dir = repo({ '.gitignore': gitignore, 'package.json': '{}' }, { git: false });
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return runChecks(dir).find((r) => r.id === 'gitignore');
  };
  // A comment is not a rule.
  const comment = check('# remember to add .env and node_modules later\n');
  assert.equal(comment.status, 'warn');
  assert.match(comment.message, /node_modules or \.env/);
  // Neither is a negation, nor a rule for a different file.
  assert.equal(check('!.env\n!node_modules\n').status, 'warn');
  assert.equal(check('.env.local\nnode_modules.bak\n').status, 'warn');
  // The ways people actually write these rules all count.
  for (const rules of ['.env\nnode_modules\n', '/.env\nnode_modules/\n', '.env*\n**/node_modules/\n', '*.env\n/node_modules\n', '  .env  \n\tnode_modules\n']) {
    assert.equal(check(rules).status, 'pass', JSON.stringify(rules));
  }
});

test('git fsck runs once per run, not once per question', (t) => {
  const dir = busyRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // GIT_TRACE makes every git process log the command it ran, on every platform.
  const trace = join(dir, 'pushready-trace.log');
  const { status: code } = spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8', env: { ...process.env, GIT_TRACE: trace } });
  assert.equal(code, 1);
  const fscks = readFileSync(trace, 'utf8').split('\n').filter((l) => /built-in: git.*fsck/.test(l));
  assert.equal(fscks.length, 1, fscks.join('\n'));
});

test('a failed fsck is still reported as a limit on what was checked', (t) => {
  const dir = repo({ 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const context = repoContext(dir);
  assert.equal(context.fsckFailed, false);
  assert.deepEqual(historyLimits(dir, context), []);
  const limited = historyLimits(dir, { ...context, fsckFailed: true });
  assert.equal(limited.length, 1);
  assert.match(limited[0].reason, /unreachable commits could not be listed/);
  assert.equal(limited[0].fix, 'git fsck --unreachable');
});

// --- v0.3.1, second half: category metadata and the policy pass. The first of
// these is the case found on 31 Oct: a pushed .env that is still tracked was
// reported with less than the same .env after "git rm --cached".

test('a pushed .env that is still tracked gets the pushed exposure, the guide and exit 2', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': 'node_modules\n', '.env': 'SECRET=1' });
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  const results = runChecks(dir);
  // Reported once, by env-tracked, but with everything the history checks know about it.
  assert.equal(status(results, 'env-tracked'), 'fail');
  const [found] = items(results, 'env-tracked');
  assert.equal(found?.exposure, 'pushed');
  // Not "No credential files in git history": it is in history, and was pushed.
  assert.doesNotMatch(results.find((r) => r.id === 'history-credentials').message, /^No credential files/);
  const text = guideText(exposureGuide(results));
  assert.match(text, /Rotate or revoke these now: \.env/);
  assert.match(text, /--path "\.env"/);
  assert.equal(cliRun(dir).status, 2);
});

test('every risky category has a kind, and the guide gives advice for every kind', () => {
  for (const category of RISKY_CATEGORIES) {
    assert.ok(KINDS.includes(category.kind), `${category.id} has kind ${category.kind}`);
    // A finding of this category, on its own, must reach the guide: the guide groups
    // by kind rather than by id, so a new category cannot be silently left out.
    const item = { path: `x/${category.id}`, kind: category.kind, place: 'branch', exposure: 'local only', branches: ['main'], tags: [], stashes: [], refs: [], ignored: false, acknowledged: false, present: true, aliases: [] };
    const guide = exposureGuide([{ id: category.id, status: 'fail', message: '', items: [item] }]);
    assert.match(guideText(guide), new RegExp(`x/${category.id}`), category.id);
  }
});

test('every check has a severity, and results carry it apart from the status', (t) => {
  for (const check of CHECKS) assert.ok(SEVERITIES.includes(check.severity), `${check.id} has severity ${check.severity}`);
  const dir = repo({
    'README.md': README,
    LICENSE: MIT,
    '.gitignore': '.env\n',
    'fixtures/dummy.pem': BLOB,
    '.pushready.json': '{ "acknowledge": ["fixtures/dummy.pem"] }',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  for (const r of results) assert.ok(SEVERITIES.includes(r.severity), `${r.id} result has severity ${r.severity}`);
  const by = (id) => results.find((r) => r.id === id);
  // The two axes: how bad the check is when it fires, and what happened this run.
  assert.deepEqual([by('history-credentials').severity, by('history-credentials').status], ['blocker', 'pass']);
  assert.deepEqual([by('history-keys').severity, by('history-keys').status], ['blocker', 'acknowledged']);
  assert.deepEqual([by('history-data').severity, by('history-data').status], ['warning', 'pass']);
  // Skipped checks carry it too.
  const plain = repo({ 'README.md': README }, { git: false });
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  const skipped = runChecks(plain).find((r) => r.id === 'env-tracked');
  assert.deepEqual([skipped.severity, skipped.status], ['blocker', 'skip']);
});

test('a tracked fixture .env can be acknowledged, and stops failing the run', (t) => {
  const dir = repo({
    'README.md': README,
    LICENSE: MIT,
    '.gitignore': '.env\n',
    'test/fixtures/.env': 'FAKE=1',
    '.pushready.json': '{ "acknowledge": [ { "path": "test/fixtures/.env", "reason": "fixture, no real values" } ] }',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  const env = results.find((r) => r.id === 'env-tracked');
  assert.equal(env.status, 'acknowledged');
  assert.match(env.message, /acknowledged$/);
  assert.equal(env.items[0].reason, 'fixture, no real values');
  assert.equal(status(results, 'history-credentials'), 'pass');
  assert.equal(exposureGuide(results), null);
  assert.equal(cliRun(dir).status, 0);
});

test('one acknowledged .env does not excuse a second one', (t) => {
  const dir = repo({
    'README.md': README,
    'test/fixtures/.env': 'FAKE=1',
    '.env': 'REAL=1',
    '.pushready.json': '{ "acknowledge": ["test/fixtures/.env"] }',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(status(results, 'env-tracked'), 'fail');
  assert.deepEqual(items(results, 'env-tracked').map((i) => [i.path, i.acknowledged]), [['.env', false], ['test/fixtures/.env', true]]);
  assert.match(guideText(exposureGuide(results)), /--path "\.env"/);
});

test('a deliberately committed node_modules can be acknowledged', (t) => {
  const dir = repo({
    'README.md': README,
    'node_modules/vendored/index.js': '',
    '.pushready.json': '{ "acknowledge": [ { "path": "node_modules", "reason": "vendored on purpose" } ] }',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  const nm = results.find((r) => r.id === 'dependencies-tracked');
  assert.equal(nm.status, 'acknowledged');
  assert.match(nm.message, /vendored on purpose/);
});

test('the policy pass is what dedupes, so a check that is not run leaves its finding to the next one', (t) => {
  const dir = repo({ '.env': 'SECRET=1', 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Run everything except env-tracked, the way --skip env-tracked will in v0.3.2.
  const results = runChecks(dir, { checks: CHECKS.filter((c) => c.id !== 'env-tracked') });
  assert.equal(results.find((r) => r.id === 'env-tracked'), undefined);
  assert.equal(status(results, 'history-credentials'), 'fail');
  assert.deepEqual(items(results, 'history-credentials').map((i) => i.path), ['.env']);
});

// --- The cleanup command has to stay runnable. Past about eight paths an
// inline command is unreadable and risks the shell's argument limits, so the
// guide switches to a file list instead.

test('up to eight paths are named inline in the cleanup command', (t) => {
  const files = { 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' };
  for (let i = 0; i < 8; i++) files[`keys/key${i}.pem`] = BLOB + i;
  const dir = repo(files);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const text = guideText(exposureGuide(runChecks(dir)));
  assert.match(text, /git filter-repo --invert-paths --path "keys\/key0\.pem"/);
  assert.equal((text.match(/--path "/g) ?? []).length, 8);
  assert.doesNotMatch(text, /paths\.txt/);
});

test('more than eight paths fall back to a file list, naming every path once', (t) => {
  const files = { 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' };
  for (let i = 0; i < 12; i++) files[`keys/key${i}.pem`] = BLOB + i;
  const dir = repo(files);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(items(results, 'history-keys').length, 12);
  const text = guideText(exposureGuide(results));
  // The command becomes a file list, and says what to put in the file.
  assert.match(text, /git filter-repo --invert-paths --paths-from-file paths\.txt/);
  assert.match(text, /list one path per line in paths\.txt/);
  assert.doesNotMatch(text, /--path "/);
  // The paths themselves are still on screen, so the file can be written.
  for (let i = 0; i < 12; i++) assert.match(text, new RegExp(`keys/key${i}\\.pem`), `key${i}`);
});

test('the fallback counts every name a renamed file had, not just the findings', (t) => {
  const files = { 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' };
  // Seven findings, under the inline limit on their own.
  for (let i = 0; i < 7; i++) files[`keys/key${i}.pem`] = BLOB + i;
  const dir = repo(files);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Two renames push the path count past eight even though the findings do not.
  for (const i of [0, 1]) {
    run(dir, 'mv', `keys/key${i}.pem`, `keys/renamed${i}.pem`);
    commitAll(dir, `rename ${i}`);
  }
  const text = guideText(exposureGuide(runChecks(dir)));
  assert.match(text, /paths-from-file paths\.txt/, 'nine distinct paths, so the file list');
  assert.match(text, /was also committed as/);
});

test('a path the shell would mangle forces the file list whatever the count', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A backtick, not a double quote: both would break the inline command, but
  // Windows does not allow a quote in a file name at all, and this test has to
  // build its fixture there too.
  writeFileSync(join(dir, 'back`tick.pem'), BLOB);
  commitAll(dir, 'add an awkward name');
  const text = guideText(exposureGuide(runChecks(dir)));
  assert.match(text, /paths-from-file paths\.txt/);
});

// --- v0.3.2: the finding shape, held in one place.

test('every result has exactly the documented finding keys, whatever its status', (t) => {
  const { FINDING_KEYS, ITEM_KEYS, STATUSES } = await_import();
  const repos = [
    repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'k.pem': BLOB, '.pushready.json': '{ "acknowledge": ["k.pem"] }' }),
    repo({ 'README.md': '# x\n' }, { git: false }),
  ];
  t.after(() => repos.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const seen = new Set();
  for (const dir of repos) {
    for (const f of runChecks(dir)) {
      assert.deepEqual(Object.keys(f), FINDING_KEYS, `${f.id} (${f.status})`);
      assert.ok(STATUSES.includes(f.status), f.status);
      assert.ok(f.fix === null || typeof f.fix === 'string');
      for (const i of f.items) assert.deepEqual(Object.keys(i), ITEM_KEYS, `${f.id} item`);
      seen.add(f.status);
    }
  }
  // pass, fail, acknowledged and skip all went through the same shape.
  for (const s of ['pass', 'fail', 'acknowledged', 'skip']) assert.ok(seen.has(s), `saw a ${s}`);
});

import { FINDING_KEYS as _FK, ITEM_KEYS as _IK, STATUSES as _ST } from '../src/index.js';
function await_import() { return { FINDING_KEYS: _FK, ITEM_KEYS: _IK, STATUSES: _ST }; }

test('every check has a title, and titles are what --help and --only show', () => {
  for (const check of CHECKS) {
    assert.equal(typeof check.title, 'string', check.id);
    assert.ok(check.title.length > 2, check.id);
  }
  const help = cliRun('--help').stdout;
  for (const check of CHECKS) assert.ok(help.includes(`${check.id.padEnd(22)} ${check.title}`), `${check.id} listed in --help`);
});
