// Projects that are not JavaScript. The checks are language-agnostic by design
// — they match file names, not code — but two of them are not: the .gitignore
// check only asks about node_modules in a Node project, and the committed
// dependencies check only knows node_modules. These tests say what a Python,
// .NET, Java, Go, Ruby or Terraform user actually gets today, including where
// that is less than a Node user gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { runChecks } from '../src/index.js';
import { BLOB, MIT, README, cliRun, items, repo, status } from './helpers.js';

const base = { 'README.md': README, LICENSE: MIT };
const paths = (results, id) => items(results, id).map((i) => i.path);

test('a Python project is not asked to ignore node_modules', (t) => {
  const dir = repo({ ...base, '.gitignore': 'venv/\n__pycache__/\n*.pyc\n.env\n', 'requirements.txt': 'requests==2.31.0\n', 'app.py': 'print(1)\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(status(results, 'gitignore'), 'pass');
  assert.equal(cliRun(dir).status, 0);
});

test('a Node project is asked to ignore node_modules, and a Python one is not', (t) => {
  const node = repo({ ...base, '.gitignore': '.env\n', 'package.json': '{}' });
  const python = repo({ ...base, '.gitignore': '.env\n', 'requirements.txt': 'flask\n' });
  t.after(() => {
    rmSync(node, { recursive: true, force: true });
    rmSync(python, { recursive: true, force: true });
  });
  assert.equal(status(runChecks(node), 'gitignore'), 'warn');
  assert.match(runChecks(node).find((r) => r.id === 'gitignore').message, /node_modules/);
  assert.equal(status(runChecks(python), 'gitignore'), 'pass');
});

test('every project is asked to ignore .env, whatever the language', (t) => {
  for (const [name, files] of Object.entries({
    python: { 'requirements.txt': 'flask\n' },
    dotnet: { 'App.csproj': '<Project />\n' },
    java: { 'pom.xml': '<project />\n' },
    go: { 'go.mod': 'module demo\n' },
    ruby: { Gemfile: "source 'https://rubygems.org'\n" },
  })) {
    const dir = repo({ ...base, '.gitignore': 'build/\n', ...files });
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const gitignore = runChecks(dir).find((r) => r.id === 'gitignore');
    assert.equal(gitignore.status, 'warn', name);
    assert.match(gitignore.message, /\.env/, name);
  }
});

test('a committed .env is found in any language', (t) => {
  for (const [name, files] of Object.entries({
    python: { 'app.py': 'x\n', '.env': 'SECRET=1' },
    ruby: { Gemfile: 'x\n', '.env': 'SECRET=1' },
    dotnet: { 'App.csproj': '<Project />\n', '.env': 'SECRET=1' },
  })) {
    const dir = repo({ ...base, ...files });
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    assert.equal(status(runChecks(dir), 'env-tracked'), 'fail', name);
  }
});

test('credential names from other ecosystems are matched, in the right category', (t) => {
  const dir = repo({
    ...base,
    '.gitignore': '.env\n',
    // .NET / Windows signing and Java keystores.
    'certs/signing.pfx': BLOB,
    'certs/app.p12': 'x',
    'config/release.jks': 'x',
    'config/debug.keystore': 'x',
    // Rails holds its credentials key here; the name says nothing, the extension does.
    'config/master.key': 'x',
    // Infrastructure.
    'infra/terraform.tfstate': '{}',
    'deploy/kubeconfig': 'x',
    '.netrc': 'x',
    // Python / Django databases.
    'db.sqlite3': 'x',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.deepEqual(paths(results, 'history-keys'), ['certs/app.p12', 'certs/signing.pfx', 'config/debug.keystore', 'config/master.key', 'config/release.jks']);
  assert.deepEqual(paths(results, 'history-credentials'), ['.netrc', 'deploy/kubeconfig', 'infra/terraform.tfstate']);
  assert.deepEqual(paths(results, 'history-data'), ['db.sqlite3']);
  assert.equal(cliRun(dir).status, 1);
});

// A committed dependency tree is the same mistake in every ecosystem, and until
// 1 Nov 2026 only node_modules was recognised — so a Python project that
// committed its virtualenv passed clean.

test('a committed dependency tree is reported in every ecosystem, not just Node', (t) => {
  const trees = {
    npm: { 'package.json': '{}', 'node_modules/left-pad/index.js': '' },
    python: { 'requirements.txt': 'flask\n', 'venv/pyvenv.cfg': 'home = /usr\n', 'venv/lib/python3.12/site-packages/flask/__init__.py': '' },
    composer: { 'composer.json': '{}', 'vendor/autoload.php': '<?php\n', 'vendor/monolog/src/Log.php': '<?php\n' },
    bundler: { Gemfile: 'source "x"\n', 'vendor/bundle/ruby/3.0/gems/rake/lib/rake.rb': '' },
    dotnet: { 'App.csproj': '<Project />\n', 'obj/project.assets.json': '{}', 'bin/Debug/net8.0/App.dll': 'x' },
  };
  for (const [ecosystem, files] of Object.entries(trees)) {
    const dir = repo({ ...base, '.gitignore': '.env\n', ...files });
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const found = runChecks(dir).find((r) => r.id === 'dependencies-tracked');
    assert.equal(found.status, 'fail', `${ecosystem}: ${found.message}`);
    assert.equal(cliRun(dir).status, 1, ecosystem);
  }
});

test('the report names the folder to untrack, not the files inside it', (t) => {
  const dir = repo({
    ...base,
    '.gitignore': '.env\n',
    'requirements.txt': 'flask\n',
    'venv/pyvenv.cfg': 'home = /usr\n',
    'venv/lib/python3.12/site-packages/flask/__init__.py': '',
    'venv/lib/python3.12/site-packages/flask/app.py': '',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const found = runChecks(dir).find((r) => r.id === 'dependencies-tracked');
  assert.match(found.message, /venv \(3 files\) is committed — an installed Python environment/);
  assert.match(found.fix, /git rm -r --cached venv/);
  assert.match(found.fix, /Files inside are not checked one by one/);
});

test('two committed trees are both named, with one command to remove them', (t) => {
  const dir = repo({ ...base, '.gitignore': '.env\n', 'package.json': '{}', 'node_modules/a/i.js': '', 'venv/pyvenv.cfg': 'x\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const found = runChecks(dir).find((r) => r.id === 'dependencies-tracked');
  assert.match(found.message, /node_modules \(1 file\), venv \(1 file\) are committed/);
  assert.match(found.fix, /git rm -r --cached node_modules venv/);
});

test('a folder is only a dependency tree when there is proof, not because of its name', (t) => {
  // Each of these has a name that looks like build output or vendoring but is
  // the project's own source. Flagging them would be worse than missing one.
  const dir = repo({
    ...base,
    '.gitignore': '.env\n',
    'go.mod': 'module demo\n',
    'vendor/github.com/pkg/errors/errors.go': 'package errors\n',
    'bin/deploy.sh': '#!/bin/sh\n',
    'lib/site.js': 'x\n',
    'obj/notes.txt': 'x\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status(runChecks(dir), 'dependencies-tracked'), 'pass');
  assert.equal(cliRun(dir).status, 0);
});

test('a committed dependency tree can be acknowledged by its folder', (t) => {
  const dir = repo({
    ...base,
    '.gitignore': '.env\n',
    'vendor/autoload.php': '<?php\n',
    '.pushready.json': '{ "acknowledge": [ { "path": "vendor", "reason": "shipped on purpose" } ] }',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const found = runChecks(dir).find((r) => r.id === 'dependencies-tracked');
  assert.equal(found.status, 'acknowledged');
  assert.match(found.message, /shipped on purpose/);
  assert.equal(cliRun(dir).status, 0);
});

// A CA bundle is a list of *public* root certificates, and every Python
// environment ships one as certifi/cacert.pem. Matching "*.pem" used to tell
// people to rotate a key and rewrite history over a file anyone can download.
test('a CA bundle inside a committed venv is not reported as a private key', (t) => {
  const dir = repo({
    ...base,
    '.gitignore': '.env\n',
    'requirements.txt': 'requests\n',
    'venv/pyvenv.cfg': 'home = /usr\n',
    'venv/lib/python3.12/site-packages/certifi/cacert.pem': '-----BEGIN CERTIFICATE-----\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.deepEqual(paths(results, 'history-keys'), [], 'no private key finding');
  // The real finding is the committed environment, and untracking it removes
  // the bundle too.
  assert.equal(status(results, 'dependencies-tracked'), 'fail');
  assert.doesNotMatch(cliRun(dir).stdout, /git filter-repo/, 'no history rewrite over a public certificate');
});

test('a CA bundle is not flagged even outside a dependency tree', (t) => {
  const dir = repo({ ...base, '.gitignore': '.env\n', 'certs/cacert.pem': 'x', 'certs/ca-bundle.crt': 'x', 'jre/lib/security/cacerts': 'x' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(paths(runChecks(dir), 'history-keys'), []);
  assert.equal(cliRun(dir).status, 0);
});

test('a real key next to a CA bundle is still found', (t) => {
  const dir = repo({ ...base, '.gitignore': '.env\n', 'certs/cacert.pem': 'x', 'certs/server.key': BLOB });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(paths(runChecks(dir), 'history-keys'), ['certs/server.key']);
});

test('a public certificate on its own is not flagged, whatever the project', (t) => {
  const dir = repo({ ...base, '.gitignore': '.env\n', 'go.mod': 'module demo\n', 'certs/server.crt': 'x', 'certs/server.cer': 'x', 'certs/request.csr': 'x', 'keys/deploy.pub': 'x' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(cliRun(dir).status, 0);
});

test('the README and LICENSE checks do not assume a JavaScript project', (t) => {
  const dir = repo({ 'README.rst': README, COPYING: MIT, 'setup.py': 'x\n', '.gitignore': '.env\n' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(status(results, 'readme'), 'pass', 'README.rst counts');
  assert.equal(status(results, 'license'), 'pass', 'COPYING counts');
});
