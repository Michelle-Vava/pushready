// A lazy, read-only view of one repository, shared by every check.
//
// Two jobs. First, *share*: three history checks all want the list of risky
// paths, and they get one git walk between them rather than three. Second,
// *limit*: a check is handed this object and nothing else, so what a check can
// look at is decided here, in one file, instead of in each check.
//
// Nothing runs until something asks for it. `pushready --only readme` never
// reaches a field that spawns git, so it spawns none.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ignoredPaths, isGitRepo, listCommitted, listTracked } from './git.js';
import { describePath, historyLimits, listEverAdded, namesFor, renameGraph, repoContext } from './history.js';
import { readAcknowledgements } from './acknowledge.js';
import { categoryOf, isEnvFile } from './patterns.js';

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
 * Build a snapshot of `dir`. Every field is a function; calling it is what does
 * the work, and calling it twice costs nothing.
 */
export function snapshot(dir) {
  const files = once(() => readdirSync(dir));
  const tracked = once(() => listTracked(dir));
  const trackedSet = once(() => new Set(tracked()));
  const context = once(() => repoContext(dir));
  const everAdded = once(() => listEverAdded(dir, context().tips));
  // Risky paths, in the order the checks report them.
  //
  // The .env filter is a cross-check policy, not a property of the repository: a
  // tracked .env is already reported by env-tracked, and repeating it under
  // history-credentials would say the same thing twice. It sits here because
  // every history check needs the same answer.
  // TODO(v0.3.1): move this to a policy pass over findings. Where it sits now,
  // `--skip env-tracked` (v0.3.2) would silently hide a committed .env from both
  // checks, because the suppression would still run with nothing to defer to.
  const risky = once(() =>
    [...everAdded()]
      .filter((p) => !(isEnvFile(p) && trackedSet().has(p)))
      .filter((p) => categoryOf(p))
      .sort(),
  );
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
    tracked,
    trackedSet,
    committed: once(() => listCommitted(dir)),
    risky,
    ignored: once(() => ignoredPaths(dir, risky())),
    limits: once(() => historyLimits(dir)),
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
