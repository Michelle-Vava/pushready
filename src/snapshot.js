// A lazy, read-only view of one repository, shared by every check.
//
// Two jobs. First, *share*: three history checks all want the list of risky
// paths, and they get one git walk between them rather than three. Second,
// *limit*: a check is handed this object and nothing else, so what a check can
// look at is decided here, in one file, instead of in each check.
//
// Nothing runs until something asks for it. `pushready --only readme` never
// reaches a field that spawns git, so it spawns none.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GitOutputTooLarge, ignoredPaths, isGitRepo, listCommitted, listTracked } from './git.js';
import { describePath, historyLimits, listEverAdded, namesFor, renameGraph, repoContext } from './history.js';
import { readAcknowledgements } from './acknowledge.js';
import { categoryOf } from './patterns.js';

// Run fn at most once, on first use, and remember what it gave back.
const once = (fn) => {
  let value;
  let done = false;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value;
  };
};

// The same, keyed: one result per distinct argument.
const memo = (fn) => {
  const cache = new Map();
  return (key) => {
    if (!cache.has(key)) cache.set(key, fn(key));
    return cache.get(key);
  };
};

// The only files a check is allowed to open, enforced rather than promised.
// Everything else — .env files, keys, databases, source code — is reported from
// its name alone, so there is no reason for any check to read it. Keep this list
// and the "What it reads" section of the README in step.
const OPENABLE = [
  /^readme(\.(md|markdown|txt|rst))?$/i,
  /^(licen[sc]e|copying)(\.(md|txt))?$/i,
  /^\.gitignore$/,
  /^package\.json$/,
  /^\.pushready\.json$/,
];

/**
 * The root of the repository that contains `dir`, or null when no folder from
 * `dir` upwards holds a `.git`. Pure filesystem, no git process: file-only
 * checks must stay free of git, and this runs before any of them.
 *
 * Why it exists: every git question pushready asks returns paths relative to
 * the repository root, but "git ls-files" run in a subfolder returns paths
 * relative to *that folder*. Pointing pushready at src/ used to report src/.env
 * twice — once as ".env" (tracked) and once as "src/.env, deleted, on no branch"
 * (history) — and to miss the README, LICENSE and .gitignore at the root. A
 * linked worktree has a `.git` *file*, which counts just the same.
 */
export function repositoryRoot(dir) {
  let current = dir;
  for (;;) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * A repository with no working tree: the folder *is* the git directory. Checked
 * the way git itself recognises one — HEAD, objects/ and refs/ side by side,
 * with no .git — because it has to be free. The checks that only read files ask
 * this before deciding whether they apply, and must not spawn git to find out.
 */
export function isBareRepo(dir) {
  return !existsSync(join(dir, '.git')) && ['HEAD', 'objects', 'refs'].every((entry) => existsSync(join(dir, entry)));
}

/**
 * Build a snapshot of `dir`. Every field is a function; calling it is what does
 * the work, and calling it twice costs nothing. A folder inside a repository
 * snapshots the repository: see repositoryRoot.
 */
export function snapshot(requested) {
  const dir = repositoryRoot(requested) ?? requested;
  const files = once(() => readdirSync(dir));
  // Reasons a git question could not be answered, discovered while answering
  // it. historyLimits() reports the ones that can be known up front; this is
  // for the one that can only be found by trying.
  const limitations = [];
  const orLimit = (reason, fix, fallback) => (fn) => {
    try {
      return fn();
    } catch (error) {
      if (!(error instanceof GitOutputTooLarge)) throw error;
      if (!limitations.some((l) => l.reason === reason)) limitations.push({ reason, fix });
      return fallback;
    }
  };
  const trackedOrLimit = orLimit('this repository has too many tracked files for pushready to list at once', 'run pushready on a smaller checkout, or raise PUSHREADY_MAX_BUFFER', []);
  const historyOrLimit = orLimit('this repository has too much history for pushready to read at once, so older commits were not checked', 'run pushready on a shallower clone, or raise PUSHREADY_MAX_BUFFER', new Set());
  const tracked = once(() => trackedOrLimit(() => listTracked(dir)));
  const trackedSet = once(() => new Set(tracked()));
  const context = once(() => repoContext(dir));
  const everAdded = once(() => historyOrLimit(() => listEverAdded(dir, context().tips)));
  // Every risky path ever added, sorted. A tracked .env is in here too: which
  // check reports it is a policy question (see policy.js), not a property of the
  // repository.
  const risky = once(() => [...everAdded()].filter((p) => categoryOf(p)).sort());
  // Rename detection costs a full history walk, so a repo with nothing risky in
  // it never pays for it. Laziness makes that automatic rather than hand-written.
  const renames = once(() => (risky().length ? renameGraph(dir) : new Map()));

  return {
    // Working tree
    files,
    has: (name) => files().includes(name),
    readFile: (name) => {
      if (!OPENABLE.some((re) => re.test(name))) {
        throw new Error(`snapshot.readFile refused ${name}: pushready only opens README, LICENSE, .gitignore, package.json and .pushready.json`);
      }
      return readFileSync(join(dir, name), 'utf8');
    },

    // Git
    isGitRepo: once(() => isGitRepo(dir)),
    isBareRepo: once(() => isBareRepo(dir)),
    dir: () => dir,
    tracked,
    trackedSet,
    committed: once(() => listCommitted(dir)),
    risky,
    ignored: once(() => ignoredPaths(dir, risky())),
    // Forces the two reads that can overflow, so that "only part of the history
    // can be checked" is already known by the time this is reported — the
    // history-scope check runs before the checks that would hit the overflow.
    limits: once(() => {
      tracked();
      everAdded();
      return [...historyLimits(dir, context()), ...limitations];
    }),
    // Where one risky path lives, with the names it shares content with and
    // whether it is still in the working tree. Memoised per path: the three
    // category checks between them describe each path once.
    describe: memo((path) => describePath(dir, path, namesFor(renames(), path), trackedSet().has(path), context())),

    // Repo config
    acks: once(() => readAcknowledgements(dir)),
  };
}

/**
 * Wrap a snapshot so that reading any field the check did not declare throws.
 *
 * Used by the test suite to hold every check to its `reads` list, which is how
 * the README's "What it reads" promise stays true as checks are added. Not used
 * in normal runs: a drifted declaration should fail the build, not someone's
 * `pushready` on a repo full of secrets.
 */
export function fence(snap, allowed) {
  return new Proxy(snap, {
    get(target, key) {
      if (typeof key === 'symbol') return target[key];
      if (!allowed.includes(key)) {
        throw new Error(`undeclared snapshot read: ${String(key)} (add it to the check's "reads" list, or stop reading it)`);
      }
      return target[key];
    },
  });
}
