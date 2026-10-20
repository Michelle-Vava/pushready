import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEnvFile, runChecks } from '../src/checks.js';

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
  assert.equal(status(results, 'env-history'), 'fail');
  assert.ok(!JSON.stringify(results).includes('hunter2'));
});

test('git checks are skipped outside a git repository', (t) => {
  const dir = repo({ 'README.md': README }, { git: false });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  for (const id of ['env-tracked', 'node-modules-tracked', 'env-history']) assert.equal(status(results, id), 'skip', id);
});
