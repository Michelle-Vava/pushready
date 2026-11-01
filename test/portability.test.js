// pushready claims Linux, macOS and Windows, and Node 18 through 24. Almost all
// development happens on one of those, so these tests guard the assumptions
// that only break somewhere else — and they run everywhere, which is the point.
//
// Two kinds of test here:
//   - behaviour that must hold on any platform (paths with spaces, odd temp
//     folders, output that does not depend on the separator);
//   - a scan of our own source for the patterns that caused the breakages
//     listed in PROGRESS.md, so the same mistake fails here rather than in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks } from '../src/index.js';
import { BLOB, MIT, README, cleanUp, cliRun, commitAll, items, repo, status, writeFixture } from './helpers.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const TEST = fileURLToPath(new URL('./', import.meta.url));
const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
const sourcesIn = (dir) => readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => [join(dir, f), readFileSync(join(dir, f), 'utf8')]);
const allSources = () => [...sourcesIn(SRC), ...sourcesIn(TEST), ...sourcesIn(SCRIPTS)];

// --- Behaviour that has to hold wherever it runs -------------------------------

test('a repository under a path with spaces and non-ASCII characters is checked', (t) => {
  // Windows users have "C:\Users\Ana María\My Documents"; macOS normalises
  // accents differently again. Both go through the same code as a plain path.
  const where = mkdtempSync(join(tmpdir(), 'pushready-odd-'));
  const dir = join(where, 'mi proyecto café');
  t.after(() => cleanUp(where));
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), README);
  writeFileSync(join(dir, 'LICENSE'), MIT);
  writeFileSync(join(dir, '.gitignore'), '.env\n');
  writeFileSync(join(dir, 'clé.pem'), BLOB);
  commitAll(dir, 'init');
  const results = runChecks(dir);
  assert.deepEqual(items(results, 'history-keys').map((i) => i.path), ['clé.pem']);
  const { stdout, status: code } = cliRun(dir);
  assert.equal(code, 1);
  assert.ok(stdout.includes(basename(dir)), 'the folder name survives into the report');
  assert.match(stdout, /clé\.pem/);
});

test('findings use forward slashes whatever the platform separator is', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'deploy/keys/id_rsa': BLOB });
  t.after(() => cleanUp(dir));
  const [found] = items(runChecks(dir), 'history-keys');
  // git always reports paths with "/", and so must we: a finding is quoted back
  // into git commands in the guide, where a backslash would be wrong.
  assert.equal(found.path, 'deploy/keys/id_rsa');
  assert.ok(!found.path.includes('\\'), found.path);
  assert.match(cliRun(dir).stdout, /deploy\/keys\/id_rsa/);
});

test('a .gitignore with Windows line endings is read the same as one without', (t) => {
  const lf = repo({ 'README.md': README, LICENSE: MIT, 'package.json': '{}', '.gitignore': 'node_modules\n.env\n' });
  const crlf = repo({ 'README.md': README, LICENSE: MIT, 'package.json': '{}', '.gitignore': 'node_modules\r\n.env\r\n' });
  t.after(() => cleanUp(lf, crlf));
  assert.equal(status(runChecks(lf), 'gitignore'), 'pass');
  assert.equal(status(runChecks(crlf), 'gitignore'), 'pass', 'a CRLF rule still counts as a rule');
});

test('a README with Windows line endings is counted by lines, not bytes', (t) => {
  const short = repo({ 'README.md': '# x\r\n' });
  const full = repo({ 'README.md': README.replace(/\n/g, '\r\n') });
  t.after(() => cleanUp(short, full));
  assert.equal(status(runChecks(short), 'readme'), 'warn');
  assert.equal(status(runChecks(full), 'readme'), 'pass');
});

test('the report never contains a raw temp path token that only one platform produces', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' });
  t.after(() => cleanUp(dir));
  const { stdout } = cliRun(dir);
  // The only absolute path in the output is the folder being checked.
  const absolutes = stdout.match(/(^|\s)(\/[^\s]+|[A-Za-z]:\\[^\s]+)/g) ?? [];
  for (const found of absolutes.map((a) => a.trim())) {
    assert.ok(dir.startsWith(found) || found.startsWith(dir) || found.startsWith('https://'), `unexpected absolute path in output: ${found}`);
  }
});

// --- Our own source, scanned for the mistakes that have already bitten -----------

test('no source file builds a path by concatenating a separator', () => {
  // "`${dir}/thing`" is a Linux habit that produces a mixed-separator path on
  // Windows. join() is the portable form, and the only one used here.
  const offenders = [];
  for (const [file, text] of allSources()) {
    if (basename(file) === 'portability.test.js') continue;
    for (const [n, line] of text.split('\n').entries()) {
      if (/`\$\{[A-Za-z_.()]+\}\//.test(line) && !line.includes('http') && !line.includes('<repo>')) {
        offenders.push(`${basename(file)}:${n + 1}  ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('no source file turns a path into a URL by hand', () => {
  // `file://${path}` is wrong on Windows, where a path starts with a drive
  // letter. pathToFileURL is the portable form.
  const offenders = [];
  for (const [file, text] of allSources()) {
    if (basename(file) === 'portability.test.js') continue;
    for (const [n, line] of text.split('\n').entries()) {
      if (/['"`]file:\/\/\$\{/.test(line)) offenders.push(`${basename(file)}:${n + 1}  ${line.trim()}`);
      if (/new URL\([^)]*\)\.pathname/.test(line)) offenders.push(`${basename(file)}:${n + 1}  .pathname (use fileURLToPath)`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no test hardcodes a platform temp folder or splits a path on a slash', () => {
  const offenders = [];
  for (const [file, text] of [...sourcesIn(TEST), ...sourcesIn(SCRIPTS)]) {
    if (basename(file) === 'portability.test.js') continue;
    for (const [n, line] of text.split('\n').entries()) {
      if (/['"`]\/tmp\//.test(line)) offenders.push(`${basename(file)}:${n + 1}  hardcoded /tmp`);
      if (/\.split\('\/'\)\.pop\(\)/.test(line)) offenders.push(`${basename(file)}:${n + 1}  split('/') on a path (use basename)`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no test asserts on a message that Node words differently between versions', () => {
  // JSON.parse's wording changed in Node 20, and that text was once recorded in
  // a scenario, so the whole suite passed on 18 and failed on 20.
  const offenders = [];
  for (const [file, text] of sourcesIn(TEST)) {
    if (basename(file) === 'portability.test.js') continue;
    for (const [n, line] of text.split('\n').entries()) {
      // Asserting such a message is *absent* is fine, and is how we check that
      // pushready words its own errors rather than passing Node's through.
      if (/Unexpected token|in JSON at position|Cannot read properties/.test(line) && !line.trim().startsWith('//') && !line.includes('doesNotMatch')) {
        offenders.push(`${basename(file)}:${n + 1}  ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('no recorded scenario output contains a machine-specific path or message', () => {
  const golden = join(dirname(TEST.replace(/[\\/]$/, '')), 'test', 'golden');
  const offenders = [];
  for (const file of readdirSync(golden)) {
    const text = readFileSync(join(golden, file), 'utf8');
    for (const [n, line] of text.split('\n').entries()) {
      for (const [pattern, why] of [
        [/\/tmp\//, 'a Linux temp path'],
        [/\/var\/folders\//, 'a macOS temp path'],
        [/[A-Za-z]:\\\\/, 'a Windows path'],
        [/\/home\/|\/Users\//, 'a home folder'],
        [/in JSON at position|Unexpected token/, 'a Node-version-specific JSON error'],
      ]) {
        if (pattern.test(line)) offenders.push(`${file}:${n + 1} has ${why}: ${line.trim().slice(0, 70)}`);
      }
    }
    assert.ok(!text.includes('\r\n'), `${file} has CRLF line endings`);
  }
  assert.deepEqual(offenders, []);
});

test('the CI matrix covers every platform and Node version package.json claims', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/test.yml', import.meta.url)), 'utf8');
  const { engines } = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  for (const os of ['ubuntu-latest', 'windows-latest', 'macos-latest']) assert.ok(workflow.includes(os), os);
  const [, lowest] = engines.node.match(/>=\s*(\d+)/);
  const tested = (workflow.match(/node: \[([^\]]+)\]/)?.[1] ?? '').split(',').map((v) => Number(v.trim()));
  // Claiming support for a version nothing runs on is how a release breaks for
  // somebody else; the oldest supported version has to be in the matrix.
  assert.ok(tested.includes(Number(lowest)), `engines says >=${lowest}, matrix tests ${tested.join(', ')}`);
  assert.ok(Math.max(...tested) >= 22, 'a current Node is tested too');
});

test('sep is not assumed to be a slash anywhere a path is compared', (t) => {
  // A canary: if this ever runs on Windows, sep is "\" and the tests above that
  // compare basenames and joined paths are the ones that would catch a mistake.
  const dir = repo({ 'README.md': README, 'a/b/c.pem': BLOB });
  t.after(() => cleanUp(dir));
  const [found] = items(runChecks(dir), 'history-keys');
  assert.equal(found.path.split('/').length, 3, 'git paths are slash-separated regardless of sep');
  assert.ok(join('a', 'b').includes(sep));
});

test('a fixture name Windows cannot create is refused on every platform', (t) => {
  const dir = repo({ 'README.md': README }, { git: false });
  t.after(() => cleanUp(dir));
  for (const bad of ['say "hi".pem', 'a:b.pem', 'what?.pem', 'trailing.', 'trailing ', 'CON.pem', 'dir/NUL']) {
    assert.throws(() => writeFixture(dir, bad, 'x'), /cannot exist on Windows/, bad);
  }
  // Names that only look suspicious are fine: backtick, dollar, accents, spaces inside.
  for (const ok of ['back`tick.pem', 'we$rd.pem', 'clé.pem', 'my project/key.pem']) {
    assert.doesNotThrow(() => writeFixture(dir, ok, 'x'), ok);
  }
});

test('no test writes a fixture by hand with a name Windows cannot create', () => {
  // Tests that call writeFileSync directly bypass the guard in helpers.repo(),
  // so their literal names are scanned here instead.
  const offenders = [];
  for (const [file, text] of [...sourcesIn(TEST), ...sourcesIn(SCRIPTS)]) {
    if (basename(file) === 'portability.test.js') continue;
    for (const [n, line] of text.split('\n').entries()) {
      for (const m of line.matchAll(/(?:writeFileSync|r\.write)\((?:join\(\w+, )?'([^']+)'/g)) {
        const name = m[1];
        if (/[<>:"|?*]/.test(name) || /[. ]$/.test(name)) offenders.push(`${basename(file)}:${n + 1}  ${name}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
