// The command line itself: flags, the path argument, what is printed and which
// exit code comes back. checks.test.js asserts what the checks *find*; this file
// asserts what someone at a terminal actually gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOB, MIT, README, cliRun, cliRunIn, commitAll, pushTo, repo, run } from './helpers.js';

const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
const clean = () => repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\nnode_modules\n' });

test('--help and -h print the usage and exit 0', (t) => {
  for (const flag of ['--help', '-h']) {
    const { stdout, status } = cliRun(flag);
    assert.equal(status, 0, flag);
    assert.match(stdout, /Usage: pushready \[path\] \[options\]/, flag);
    // The help is the only place the exit-code contract is written down for users.
    for (const line of ['  0   ', '  1   ', '  2   ', '  64  ']) assert.ok(stdout.includes(line), `${flag} documents exit ${line.trim()}`);
    assert.match(stdout, /--history/, flag);
  }
});

test('--version and -v print the package version and exit 0', (t) => {
  for (const flag of ['--version', '-v']) {
    const { stdout, status } = cliRun(flag);
    assert.equal(status, 0, flag);
    assert.equal(stdout.trim(), version, flag);
  }
});

test('help and version work without a repository, and do not check anything', (t) => {
  // Run from a folder that is not a git repo at all: neither flag may care.
  const dir = repo({ 'notes.txt': 'x' }, { git: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const flag of ['--help', '--version']) {
    const { stdout, status } = cliRunIn(dir, flag);
    assert.equal(status, 0, flag);
    assert.doesNotMatch(stdout, /Checking/, flag);
  }
});

test('with no path argument, the current folder is checked', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout, status } = cliRunIn(dir);
  assert.equal(status, 0);
  // Resolved to an absolute path, not printed as "." — but macOS symlinks its
  // temp folder and Windows uses backslashes, so compare the last segment
  // rather than the whole path.
  assert.match(stdout, /\nChecking \S/);
  assert.ok(stdout.includes(basename(dir)), stdout.split('\n')[1]);
});

test('a path argument is checked instead of the current folder', (t) => {
  const target = clean();
  const elsewhere = repo({ 'README.md': README }, { git: false });
  t.after(() => {
    rmSync(target, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });
  const { stdout, status } = cliRunIn(elsewhere, target);
  assert.equal(status, 0, stdout);
  assert.ok(stdout.includes(basename(target)));
});

test('the path may come before or after the flags', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = cliRun(dir, '--history');
  const after = cliRun('--history', dir);
  assert.equal(before.status, 0);
  assert.deepEqual(before.stdout, after.stdout);
});

test('a relative path is resolved against the current folder', (t) => {
  const parent = repo({ 'README.md': README }, { git: false });
  const dir = clean();
  t.after(() => {
    rmSync(parent, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });
  const { status, stdout } = cliRunIn(dir, '.');
  assert.equal(status, 0, stdout);
  assert.ok(stdout.includes(basename(dir)), 'resolved against the current folder');
});

test('an unknown option is rejected by name, and the known ones still work', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const flag of ['--hsitory', '--jsno', '--stirct', '-x']) {
    const { stderr, stdout, status } = cliRun(dir, flag);
    assert.equal(status, 64, flag);
    assert.match(stderr, new RegExp(`unknown option: ${flag.replace(/[-]/g, '\\-')}`), flag);
    assert.match(stderr, /--help/, flag);
    // Nothing is checked when the command line was wrong.
    assert.equal(stdout, '', flag);
  }
});

test('every option listed in the help is accepted, and every accepted one is listed', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Only the options block under "Usage:", not the git commands quoted in the
  // prose further down.
  const help = cliRun('--help').stdout;
  const block = help.slice(help.indexOf('Usage:'), help.indexOf('Risky files found'));
  const documented = new Set([...block.matchAll(/^ {2,}(?:(-\w), )?(--[a-z-]+)/gm)].flatMap((m) => [m[1], m[2]]).filter(Boolean));
  assert.deepEqual([...documented].sort(), ['--help', '--history', '--json', '--only', '--quiet', '--skip', '--strict', '--version', '-h', '-v']);
  // Guards against the help and the parser drifting apart, in either direction.
  for (const flag of documented) {
    // The two that take a value get one, so that only the flag itself is under test.
    const args = ['--only', '--skip'].includes(flag) ? [flag, 'readme'] : [flag];
    assert.notEqual(cliRun(dir, ...args).status, 64, `${flag} is in --help but rejected`);
  }
  assert.equal(cliRun(dir, '--not-an-option').status, 64, 'an undocumented option is rejected');
});

test('a path that is not a folder exits 64 and says so', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const bad of [join(dir, 'README.md'), join(dir, 'no-such-folder')]) {
    const { stderr, status } = cliRun(bad);
    assert.equal(status, 64, bad);
    assert.match(stderr, /not a folder/, bad);
  }
});

test('a second path argument is rejected, not silently ignored', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { status, stdout, stderr } = cliRun(dir, join(dir, 'not', 'here'));
  assert.equal(status, 64);
  assert.equal(stdout, '');
  assert.match(stderr, /one path at a time/);
});

test('--history adds the detail block and the install notes, and plain output stays short', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'deploy.pem': BLOB });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const plain = cliRun(dir).stdout;
  const detailed = cliRun(dir, '--history').stdout;
  assert.match(plain, /deploy\.pem — still in the repo, on/);
  assert.doesNotMatch(plain, /exposure {2}/);
  assert.match(plain, /Run again with --history for the full guide\./);
  for (const label of ['status', 'exposure', 'added in', 'branches', 'remotes', 'gitignore']) {
    assert.match(detailed, new RegExp(`${label} +`), label);
  }
  assert.match(detailed, /git filter-repo is not part of git/);
  assert.doesNotMatch(detailed, /Run again with --history/);
});

test('NO_COLOR is honoured, and the icons stay distinguishable without it', (t) => {
  const dir = repo({ 'README.md': README });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout } = cliRun(dir);
  assert.doesNotMatch(stdout, /\x1b\[/, 'no escape codes with NO_COLOR set');
  assert.match(stdout, /✔ README\.md found/);
  assert.match(stdout, /✖ No LICENSE file/);
});

test('the summary accounts for every line above it', (t) => {
  // One of each status in a single run: pass, warn, fail, acknowledged, unknown.
  const dir = repo({
    'README.md': '# x\n',
    LICENSE: MIT,
    '.gitignore': '.env\nnode_modules\n',
    'fixtures/dummy.pem': BLOB,
    '.pushready.json': '{ "acknowledge": ["fixtures/dummy.pem"] }',
    'data.sqlite3': 'x',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout } = cliRun(dir);
  const summary = stdout.match(/\n {2}(\d+ passed.*)\n/)[1];
  const counted = [...summary.matchAll(/(\d+) (passed|warnings?|failed|acknowledged|could not be checked|skipped)/g)]
    .reduce((n, m) => n + Number(m[1]), 0);
  const lines = stdout.split('\n').filter((l) => /^ {2}[✔✖!?-] /.test(l)).length;
  assert.equal(counted, lines, `summary "${summary}" against ${lines} check lines`);
});

test('exit codes: 0 clean, 1 local problem, 2 something was pushed, 64 bad usage', (t) => {
  const ok = clean();
  const local = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'id_rsa': BLOB });
  const pushed = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'id_rsa': BLOB });
  let remote;
  t.after(() => {
    for (const d of [ok, local, pushed, remote]) rmSync(d, { recursive: true, force: true });
  });
  remote = pushTo(pushed);
  assert.equal(cliRun(ok).status, 0);
  assert.equal(cliRun(local).status, 1);
  assert.equal(cliRun(pushed).status, 2);
  assert.equal(cliRun(join(ok, 'no-such-folder')).status, 64);
});

test('an acknowledged pushed secret exits 0, because nothing is left to do', (t) => {
  const dir = repo({
    'README.md': README,
    LICENSE: MIT,
    '.gitignore': '.env\n',
    'fixtures/dummy.pem': BLOB,
    '.pushready.json': '{ "acknowledge": [ { "path": "fixtures/dummy.pem", "reason": "public test vector" } ] }',
  });
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  const { stdout, status } = cliRun(dir);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /acknowledged/);
  assert.doesNotMatch(stdout, /What to do next/);
});

test('a folder that is not a git repository reports what it could not check', (t) => {
  const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' }, { git: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { stdout, status } = cliRun(dir);
  assert.equal(status, 0, stdout);
  assert.equal((stdout.match(/- Not a git repository/g) ?? []).length, 6);
  assert.match(stdout, /6 skipped/);
  assert.doesNotMatch(stdout, /What to do next/);
});

// --- The three flags a user or a CI script reaches for first. --help and
// --version are a contract: scripts parse them. --json does not exist yet, and
// the tests say so out loud, because silently printing text to something
// expecting JSON is the worst way to find out.

test('--help documents every check, status icon and exit code the tool can produce', () => {
  const { stdout } = cliRun('--help');
  // What the run can print, and what each exit code means, are the two things
  // someone reads the help for.
  for (const topic of ['acknowledg', 'git history', '.gitignore', 'stash', 'local only', 'not on a remote', 'pushed']) {
    assert.match(stdout, new RegExp(topic, 'i'), topic);
  }
  for (const [code, meaning] of [['0', /nothing to fix/], ['1', /nothing has been pushed/], ['2', /already pushed/], ['64', /used wrongly/]]) {
    assert.match(stdout, new RegExp(`\\n {2}${code} +.*`), `exit ${code} listed`);
    assert.match(stdout, meaning, `exit ${code} explained`);
  }
  // The promise the whole tool rests on belongs in the help, not only the README.
  // The help is hard-wrapped, so match the prose with its line breaks flattened.
  const prose = stdout.replace(/\s+/g, ' ');
  assert.match(prose, /never opens a file that could hold a secret/i);
  assert.match(prose, /It never edits files, deletes anything or rewrites git history/i);
});

test('--help wins over everything else on the command line', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Including over a bad path and an unknown option: asking for help always works.
  for (const args of [['--help'], ['--help', dir], [dir, '--help'], ['--help', join(dir, 'no-such-folder')], ['--help', '--bogus']]) {
    const { stdout, status } = cliRun(...args);
    assert.equal(status, 0, args.join(' '));
    assert.match(stdout, /Usage: pushready/, args.join(' '));
    assert.doesNotMatch(stdout, /Checking/, args.join(' '));
  }
});

test('--version prints the version alone, so a script can read it', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const args of [['--version'], ['-v'], ['--version', dir], ['--version', join(dir, 'no-such-folder')]]) {
    const { stdout, stderr, status } = cliRun(...args);
    assert.equal(status, 0, args.join(' '));
    // One line, nothing else: no banner, no "pushready" prefix, no trailing text.
    assert.match(stdout, /^\d+\.\d+\.\d+\n$/, `${args.join(' ')} printed ${JSON.stringify(stdout)}`);
    assert.equal(stderr, '', args.join(' '));
  }
});

test('--version agrees with package.json, and --help prints the same version', () => {
  const printed = cliRun('--version').stdout.trim();
  assert.equal(printed, version);
  assert.match(cliRun('--help').stdout, new RegExp(`^pushready ${version.replace(/\./g, '\\.')}`));
});

test('the flags that do not exist yet are all refused the same way', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Every flag named in the roadmap for a later release. When one lands, its
  // line here fails, which is the reminder to document and test it properly.
  for (const flag of ['--fix', '--no-color', '--install-hook']) {
    const { status, stderr } = cliRun(dir, flag);
    assert.equal(status, 64, flag);
    assert.match(stderr, new RegExp(`unknown option: ${flag}`), flag);
  }
});

test('a flag that takes no value refuses one, and one that needs a value insists on it', (t) => {
  const dir = clean();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(cliRun(dir, '--history=yes').status, 64);
  for (const args of [[dir, '--only'], [dir, '--only', '--history']]) {
    const { status, stderr } = cliRun(...args);
    assert.equal(status, 64, args.join(' '));
    assert.match(stderr, /needs a value/, args.join(' '));
  }
  // "--skip <path>" reads the path as the value, and refuses it as a check id by
  // name, which still leaves the user knowing exactly what went wrong.
  const eaten = cliRun('--skip', dir);
  assert.equal(eaten.status, 64);
  assert.match(eaten.stderr, /unknown check/);
});
