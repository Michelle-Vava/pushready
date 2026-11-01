// Shared fixtures for the test suites. One throwaway git repo per test, built in
// the system temp folder and removed again by the caller, so nothing here
// touches the repository you are working in.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guideLines } from '../src/index.js';

export const MIT = 'MIT License\n\nPermission is hereby granted, free of charge, to any person...';
export const README = '# Demo\n\nWhat it does.\n\n## Install\n\nnpm install\n\n## Use\n\nnpm start\n';
// Four lines, so a renamed copy still looks like the same content to git's
// rename detection.
export const BLOB = 'line one\nline two\nline three\nline four\n';

export const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

/** Run the CLI. Colour off so assertions match plain text. */
export function cliRun(...args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
}

/** Run the CLI from inside `cwd`, for the no-path-argument case. */
export function cliRunIn(cwd, ...args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
}

export function run(dir, ...args) {
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd: dir, stdio: 'ignore' });
}

/**
 * Remove a temp repo. `maxRetries` is for Windows, where a git process that has
 * only just exited can still hold a handle inside .git and make rmSync throw
 * EBUSY. Every test cleans up through this.
 */
export function cleanUp(...dirs) {
  for (const dir of dirs) {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

export function commitAll(dir, message) {
  run(dir, 'add', '-A', '-f');
  run(dir, 'commit', '-q', '--allow-empty', '-m', message);
}

/** A repo whose files are committed, unless `commit: false` leaves them staged. */
// Every fixture repo is on this branch. Named explicitly because git's default
// depends on the machine's init.defaultBranch — unset means "master" with a
// hint, and CI runners do not all agree — so without it a test that mentions a
// branch by name passes or fails depending on whose machine it runs on.
export const BRANCH = 'main';

// Characters Windows will not put in a file name, plus a trailing dot or space,
// which it silently strips, and its reserved device names. A fixture using one
// would pass here and fail there, so it fails here instead — on 1 Nov 2026 a
// `say "hi".pem` did exactly that.
const ILLEGAL_ON_WINDOWS = /[<>:"|?*\u0000-\u001f]|[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

/** Write a fixture file, refusing a name that only some platforms allow. */
export function writeFixture(dir, path, content) {
  for (const segment of path.split('/')) {
    if (ILLEGAL_ON_WINDOWS.test(segment)) throw new Error(`fixture name "${path}" cannot exist on Windows; pick another`);
  }
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), content);
}

/** A repo whose files are committed, unless `commit: false` leaves them staged. */
export function repo(files, { git = true, commit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pushready-'));
  for (const [path, content] of Object.entries(files)) writeFixture(dir, path, content);
  if (git) {
    run(dir, 'init', '-q', '-b', BRANCH);
    if (commit) commitAll(dir, 'init');
  }
  return dir;
}

export function status(results, id) {
  return results.find((r) => r.id === id).status;
}

export function items(results, id) {
  return results.find((r) => r.id === id).items ?? [];
}

// A bare repo standing in for a server, so "pushed" can be tested offline.
export function pushTo(dir, branch = BRANCH) {
  const remote = mkdtempSync(join(tmpdir(), 'pushready-remote-'));
  execFileSync('git', ['init', '-q', '--bare', remote], { stdio: 'ignore' });
  run(dir, 'remote', 'add', 'origin', remote);
  run(dir, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  run(dir, 'fetch', '-q', 'origin');
  return remote;
}

/** Every line of a guide as one string, for matching against. */
export const guideText = (guide) => guideLines(guide).join('\n');
