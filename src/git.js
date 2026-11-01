// The only module that spawns git. Everything else asks a question in terms of
// paths and hashes and gets an answer back; nothing else needs to know how git
// is invoked, which flags keep odd paths intact, or how failures are swallowed.
import { execFileSync } from 'node:child_process';

// execFileSync buffers a command's whole output in memory and throws ENOBUFS
// past this. 64 MB is far more than any repository has produced in testing
// (604 files over 42 commits produce 11 KB), but "far more" is not "always", so
// the overflow is turned into a reported limit rather than a stack trace.
// The environment variable exists so that path can be tested without building
// a repository big enough to reach 64 MB.
const MAX_BUFFER = Number(process.env.PUSHREADY_MAX_BUFFER) || 64 * 1024 * 1024;

/** Thrown when a git command produced more output than pushready can hold. */
export class GitOutputTooLarge extends Error {
  constructor(args) {
    super(`git ${args[0]} produced more output than pushready can read at once`);
    this.name = 'GitOutputTooLarge';
  }
}

export function git(dir, args) {
  // quotePath=false stops git escaping non-ASCII paths (".env" under "café/" came
  // back as "caf\303\251/.env" and was missed). Commands that can see odd paths
  // also use -z, which covers paths containing newlines.
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: MAX_BUFFER,
    });
  } catch (error) {
    if (error.code === 'ENOBUFS') throw new GitOutputTooLarge(args);
    throw error;
  }
}


export function isGitRepo(dir) {
  try {
    return git(dir, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

// Newline-separated git output as trimmed, non-empty lines.
export const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean);

export function listTracked(dir) {
  return git(dir, ['ls-files', '-z']).split('\0').filter(Boolean);
}

// Paths in the last commit. Empty on an unborn branch, where HEAD has no tree yet.
export function listCommitted(dir) {
  try {
    return new Set(git(dir, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']).split('\0').filter(Boolean));
  } catch {
    return new Set();
  }
}

// Which of these paths the current .gitignore would ignore. Works on paths that no
// longer exist on disk, which is the point: it is how we spot someone who added a
// secret to .gitignore and assumed that dealt with the copy already in git.
export function ignoredPaths(dir, paths) {
  if (!paths.length) return new Set();
  const args = ['-c', 'core.quotePath=false', 'check-ignore', '-z', '--stdin', '--no-index'];
  const options = { cwd: dir, input: `${paths.join('\0')}\0`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 };
  try {
    return new Set(execFileSync('git', args, options).split('\0').filter(Boolean));
  } catch (error) {
    // check-ignore exits 1 when nothing matched, which is not a failure.
    return new Set((error.stdout ?? '').split('\0').filter(Boolean));
  }
}
