import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

// .env, .env.local, .env.production ... but not .env.example / .env.sample / .env.template
const ENV_FILE = /^\.env(\..+)?$/;
const ENV_TEMPLATE = /\.(example|sample|template|dist)$/;

export function isEnvFile(path) {
  const name = basename(path);
  return ENV_FILE.test(name) && !ENV_TEMPLATE.test(name);
}

export function isNodeModules(path) {
  return path.split('/').includes('node_modules');
}

function git(dir, args) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function isGitRepo(dir) {
  try {
    return git(dir, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

function findFile(dir, pattern) {
  return readdirSync(dir).find((name) => pattern.test(name));
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function result(id, status, message, fix) {
  return { id, status, message, fix };
}

function checkReadme(dir) {
  const file = findFile(dir, /^readme(\.(md|markdown|txt|rst))?$/i);
  if (!file) {
    return result('readme', 'fail', 'No README found', 'Add a README.md that says what the project does and how to run it.');
  }
  const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter((l) => l.trim());
  if (lines.length < 5) {
    return result('readme', 'warn', `${file} is very short (${plural(lines.length, 'line')})`, 'Explain what the project does, how to install it and how to use it.');
  }
  return result('readme', 'pass', `${file} found`);
}

function checkLicense(dir) {
  const file = findFile(dir, /^(licen[sc]e|copying)(\.(md|txt))?$/i);
  if (!file) {
    return result('license', 'fail', 'No LICENSE file', 'Without a license nobody may legally reuse your code. See https://choosealicense.com');
  }
  const text = readFileSync(join(dir, file), 'utf8');
  const known = [
    ['MIT', /MIT License|Permission is hereby granted, free of charge/i],
    ['Apache-2.0', /Apache License,?\s+Version 2\.0/i],
    ['GPL', /GNU GENERAL PUBLIC LICENSE/i],
    ['ISC', /ISC License/i],
    ['BSD', /Redistribution and use in source and binary forms/i],
  ].find(([, re]) => re.test(text));
  if (!known) {
    return result('license', 'warn', `${file} found, but the license type is not recognised`, 'Check it is a standard license from https://choosealicense.com');
  }
  return result('license', 'pass', `${file} found (${known[0]})`);
}

function checkGitignore(dir) {
  const path = join(dir, '.gitignore');
  if (!existsSync(path)) {
    return result('gitignore', 'fail', 'No .gitignore', 'Add a .gitignore so build output, dependencies and .env files are not committed.');
  }
  const text = readFileSync(path, 'utf8');
  const missing = [];
  if (existsSync(join(dir, 'package.json')) && !/node_modules/.test(text)) missing.push('node_modules');
  if (!/\.env/.test(text)) missing.push('.env');
  if (missing.length) {
    return result('gitignore', 'warn', `.gitignore does not ignore ${missing.join(' or ')}`, `Add ${missing.map((m) => `"${m}"`).join(' and ')} to .gitignore.`);
  }
  return result('gitignore', 'pass', '.gitignore found');
}

function listTracked(dir) {
  return git(dir, ['ls-files', '-z']).split('\0').filter(Boolean);
}

// Every path ever added in any commit on any branch.
function listEverAdded(dir) {
  const out = git(dir, ['log', '--all', '--diff-filter=A', '--name-only', '--pretty=format:']);
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
}

function checkTrackedEnv(tracked) {
  const env = tracked.filter(isEnvFile);
  if (env.length) {
    return result('env-tracked', 'fail', `Secret file(s) committed: ${env.join(', ')}`,
      'Run "git rm --cached <file>", add it to .gitignore, and rotate any keys it held. Commit a .env.example instead.');
  }
  return result('env-tracked', 'pass', 'No .env files committed');
}

function checkTrackedNodeModules(tracked) {
  const count = tracked.filter(isNodeModules).length;
  if (count) {
    return result('node-modules-tracked', 'fail', `node_modules is committed (${plural(count, 'file')})`,
      'Run "git rm -r --cached node_modules" and add node_modules to .gitignore.');
  }
  return result('node-modules-tracked', 'pass', 'node_modules not committed');
}

function checkHistory(tracked, everAdded) {
  const current = new Set(tracked);
  const env = [...everAdded].filter((p) => isEnvFile(p) && !current.has(p));
  if (env.length) {
    return result('env-history', 'fail', `Deleted, but still in git history: ${env.join(', ')}`,
      'Anyone can read old commits. Rotate the keys, then remove the file from history (e.g. git filter-repo) before making the repo public.');
  }
  return result('env-history', 'pass', 'No .env files in git history');
}

export function runChecks(dir) {
  const results = [checkReadme(dir), checkLicense(dir), checkGitignore(dir)];
  const gitIds = ['env-tracked', 'node-modules-tracked', 'env-history'];
  if (!isGitRepo(dir)) {
    for (const id of gitIds) results.push(result(id, 'skip', 'Not a git repository'));
    return results;
  }
  const tracked = listTracked(dir);
  results.push(checkTrackedEnv(tracked), checkTrackedNodeModules(tracked), checkHistory(tracked, listEverAdded(dir)));
  return results;
}
