// The checks, and the order they run in.
//
// Each check is an object rather than a bare function, so that what it is and
// what it may touch are stated rather than implied:
//
//   id          stable name, used by --only / --skip and in --json
//   title       what a person calls it
//   severity    how bad it is when it fires (see finding.js)
//   reads       the snapshot fields `run` may touch. A check receives the snapshot
//               and nothing else, so it cannot reach past this list; the test
//               suite holds every check to it
//   appliesTo   optional. Given the snapshot, returns true, or the reason this
//               check does not apply here, which becomes a 'skip' finding. A check
//               without it applies to any folder
//   diagnostic  optional. A check about pushready's own input, which leaves no
//               'skip' placeholder when it does not apply
//
// Each check also has a `severity`: how bad it is when it fires, fixed per check.
// A result carries it next to `status`, what happened this run, so the two are
// never confused (see patterns.js).
//
// A check that reports items (one per risky path) also has `summarise(items,
// snap, policy)`: `run` gathers, `summarise` decides status and heading. The
// policy pass (policy.js) dedupes and acknowledges items across checks, then
// calls `summarise` again with what is left, so a check never has to know about
// .pushready.json or about any other check.
//
import { RISKY_CATEGORIES, categoryOf, isEnvFile, vendoredRoots } from './patterns.js';
import { ACK_FILE, CONFIG_VERSION } from './acknowledge.js';
import { snapshot } from './snapshot.js';
import { applyPolicy } from './policy.js';
import { finding } from './finding.js';
import { plural } from './text.js';

function result(id, status, message, fix) {
  return { id, status, message, fix };
}

// A bare repository has no working tree, so there is no README to find and
// nothing is "still in the repo". Saying "No README found" about one is not a
// finding about the project, it is a statement about the wrong folder — and the
// git checks cannot run either, because there is no index to read.
const BARE = 'This is a bare repository, which has no working tree — check a clone instead';
// Free: snapshot.isBareRepo is a filesystem check, so a file-only check asking
// this still spawns no git process.
const hasWorkingTree = (snap) => (snap.isBareRepo() ? BARE : true);
// Shared by every check that needs a repository with files in it.
const inWorkingGitRepo = (snap) => (snap.isBareRepo() ? BARE : snap.isGitRepo() || 'Not a git repository');

// The status a check of this severity gets when it fires.
const STATUS_WHEN_FIRED = { blocker: 'fail', warning: 'warn' };

function findFile(snap, pattern) {
  return snap.files().find((name) => pattern.test(name));
}

const readme = {
  id: 'readme',
  title: 'README',
  severity: 'blocker',
  appliesTo: hasWorkingTree,
  reads: ['files', 'readFile'],
  run(snap) {
    const file = findFile(snap, /^readme(\.(md|markdown|txt|rst))?$/i);
    if (!file) {
      return result('readme', 'fail', 'No README found', 'Add a README.md that says what the project does and how to run it.');
    }
    const lines = snap.readFile(file).split('\n').filter((l) => l.trim());
    if (lines.length < 5) {
      return result('readme', 'warn', `${file} is very short (${plural(lines.length, 'line')})`, 'Explain what the project does, how to install it and how to use it.');
    }
    return result('readme', 'pass', `${file} found`);
  },
};

const license = {
  id: 'license',
  title: 'LICENSE',
  severity: 'blocker',
  appliesTo: hasWorkingTree,
  reads: ['files', 'readFile'],
  run(snap) {
    const file = findFile(snap, /^(licen[sc]e|copying)(\.(md|txt))?$/i);
    if (!file) {
      return result('license', 'fail', 'No LICENSE file', 'Without a license nobody may legally reuse your code. See https://choosealicense.com');
    }
    const text = snap.readFile(file);
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
  },
};

// One .gitignore pattern as a regular expression over a root-level name. Enough
// of gitignore's glob syntax for the names this check asks about: "*" and "?"
// stay within one path segment, "**/" means any number of leading folders.
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        out += '(?:.*/)?';
      } else {
        out += '.*';
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else {
      const literal = c === '\\' && i + 1 < glob.length ? glob[++i] : c;
      out += literal.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

// Whether a .gitignore would ignore `name` at the top of the repository. Only a
// rule counts: "# remember to add .env" is a comment, "!.env" un-ignores, and
// ".env.local" is a rule for a different file. A leading "/" anchors to the
// root, which is where we are looking anyway; a trailing "/" restricts the rule
// to folders, which does not change whether the name matches.
function ignores(gitignore, name) {
  return gitignore.split('\n').some((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) return false;
    const pattern = line.replace(/^\/+/, '').replace(/\/+$/, '');
    return pattern.length > 0 && globToRegExp(pattern).test(name);
  });
}

const gitignore = {
  id: 'gitignore',
  title: '.gitignore',
  severity: 'blocker',
  appliesTo: hasWorkingTree,
  reads: ['has', 'readFile'],
  run(snap) {
    if (!snap.has('.gitignore')) {
      return result('gitignore', 'fail', 'No .gitignore', 'Add a .gitignore so build output, dependencies and .env files are not committed.');
    }
    const text = snap.readFile('.gitignore');
    const missing = [];
    if (snap.has('package.json') && !ignores(text, 'node_modules')) missing.push('node_modules');
    if (!ignores(text, '.env')) missing.push('.env');
    if (missing.length) {
      return result('gitignore', 'warn', `.gitignore does not ignore ${missing.join(' or ')}`, `Add ${missing.map((m) => `"${m}"`).join(' and ')} to .gitignore.`);
    }
    return result('gitignore', 'pass', '.gitignore found');
  },
};

// "git ls-files" lists staged files as well as committed ones. The two need
// different words: a staged .env has never been in a commit, so there is nothing
// to rotate and nothing in history to clean — "git rm --cached" really is enough.
//
// A committed .env is also in history, and the history knows where it is and
// whether it was pushed. Those items are reported here, under the check whose
// advice ("git rm --cached") is the first thing to do, so that the exposure, the
// guide and the exit code see a tracked .env exactly as they see a deleted one.
const envTracked = {
  id: 'env-tracked',
  title: 'Committed secrets',
  severity: 'blocker',
  appliesTo: inWorkingGitRepo,
  reads: ['tracked', 'committed', 'risky', 'describe', 'ignored'],
  run(snap) {
    const env = snap.tracked().filter(isEnvFile);
    if (!env.length) return this.summarise([], snap);
    const inHistory = new Set(snap.risky());
    const items = env.filter((p) => inHistory.has(p)).map((p) => describeItem(snap, p));
    return this.summarise(items, snap);
  },
  summarise(items, snap) {
    const env = snap.tracked().filter(isEnvFile);
    if (!env.length) return result('env-tracked', 'pass', 'No .env files committed');
    const committed = snap.committed();
    const staged = env.filter((p) => !committed.has(p));
    if (staged.length === env.length) {
      return result('env-tracked', 'fail', `Secret file(s) staged, not yet committed: ${env.join(', ')}`,
        'Run "git rm --cached <file>" and add it to .gitignore before you commit. It has never been in a commit, so nothing needs cleaning up. Commit a .env.example instead.');
    }
    // Acknowledged only when every committed one is: a fixture does not excuse a real one.
    const accepted = new Set(items.filter((i) => i.acknowledged).map((i) => i.path));
    if (env.filter((p) => committed.has(p)).every((p) => accepted.has(p))) {
      return { ...result('env-tracked', 'acknowledged', `Secret file(s) committed: ${env.join(', ')}, acknowledged`), items };
    }
    return {
      ...result('env-tracked', 'fail', `Secret file(s) committed: ${env.join(', ')}`,
        'Run "git rm --cached <file>", add it to .gitignore, and rotate any keys it held. Commit a .env.example instead.'),
      items,
    };
  },
};

// Dependency trees and build output: node_modules, a Python virtualenv,
// Composer's vendor, Ruby's vendor/bundle, .NET bin/obj output. Detected by
// marker rather than folder name, so a legitimate bin/ or a deliberately
// vendored Go dependency is left alone (see patterns.js).
//
// Thousands of files, so no items: the report names the root folder, and
// acknowledging that path in .pushready.json is how a deliberately committed
// one is accepted.
const dependenciesTracked = {
  id: 'dependencies-tracked',
  title: 'Committed dependencies',
  severity: 'blocker',
  appliesTo: inWorkingGitRepo,
  reads: ['tracked'],
  run(snap) {
    return { ...this.summarise([], snap, { acks: new Map() }), items: [] };
  },
  summarise(items, snap, { acks }) {
    const roots = vendoredRoots(snap.tracked());
    if (!roots.length) return result('dependencies-tracked', 'pass', 'No dependencies or build output committed');
    const describe = (list) => list.map((r) => `${r.root} (${plural(r.files, 'file')})`).join(', ');
    const open = roots.filter((r) => !acks.has(r.root));
    if (!open.length) {
      const reasons = [...new Set(roots.map((r) => acks.get(r.root)).filter(Boolean))];
      return result('dependencies-tracked', 'acknowledged', `Committed and acknowledged: ${describe(roots)}${reasons.length ? `: ${reasons.join('; ')}` : ''}`);
    }
    const what = [...new Set(open.map((r) => r.what))].join(' and ');
    return result(
      'dependencies-tracked',
      'fail',
      `${describe(open)} ${open.length === 1 ? 'is' : 'are'} committed — ${what}`,
      // The whole tree is the finding, so the files inside it are not reported
      // one by one; say so, because a .pem in there is deliberately not flagged.
      `Run "git rm -r --cached ${open.map((r) => (/[ "']/.test(r.root) ? `"${r.root}"` : r.root)).join(' ')}", add ${open.length === 1 ? 'it' : 'them'} to .gitignore, and commit your lockfile instead. Files inside are not checked one by one: untrack the folder, then run pushready again.`,
    );
  },
};

// Not a check on the repository but on pushready's own config: it reports only
// when .pushready.json could not be used as written, and produces no "skip"
// placeholder.
const acknowledgements = {
  id: 'acknowledgements',
  title: 'Acknowledgements file',
  severity: 'warning',
  appliesTo: inWorkingGitRepo,
  diagnostic: true,
  reads: ['acks'],
  run(snap) {
    const { error, version } = snap.acks();
    if (error) {
      return result('acknowledgements', 'warn', `Could not read ${ACK_FILE}: ${error}`,
        `Fix the file, or delete ${ACK_FILE}. Nothing was acknowledged this run.`);
    }
    if (version !== CONFIG_VERSION) {
      return result('acknowledgements', 'warn', `${ACK_FILE} says "version": ${JSON.stringify(version)}, but this pushready understands version ${CONFIG_VERSION}`,
        'It was probably written for a newer pushready. Acknowledgements were still applied where understood; update pushready to be sure.');
    }
    return null;
  },
};

// Never a failure: it reports what the other checks could not see, as "unknown".
const historyScope = {
  id: 'history-scope',
  title: 'Git history available',
  severity: 'info',
  appliesTo: inWorkingGitRepo,
  reads: ['limits'],
  run(snap) {
    const limits = snap.limits();
    if (!limits.length) return result('history-scope', 'pass', 'Full git history available');
    return result(
      'history-scope',
      'unknown',
      `Only part of the git history can be checked: ${limits.map((l) => l.reason).join('; ')}`,
      `A risky file in the commits that are missing will not be found. Fix with: ${limits.map((l) => l.fix).join(' , then ')}`,
    );
  },
};

// One risky path as an item: where it lives, whether .gitignore lists it, and
// what kind of thing it is. Acknowledgement is filled in by the policy pass.
function describeItem(snap, path) {
  return { ...snap.describe(path), kind: categoryOf(path)?.kind ?? 'credential', ignored: snap.ignored().has(path), acknowledged: false, reason: '' };
}

// One check per category, over every path ever added on any branch. A path still
// in the repo is reported too, because "git rm" would not remove it from history.
function riskyHistoryCheck(category) {
  return {
    id: category.id,
    title: category.title,
    severity: category.severity,
    appliesTo: inWorkingGitRepo,
    reads: ['risky', 'describe', 'ignored', 'limits'],
    run(snap) {
      const found = snap.risky().filter((p) => categoryOf(p)?.id === category.id);
      return this.summarise(found.map((p) => describeItem(snap, p)), snap);
    },
    // `deferred` is how many of this category's paths another check already
    // reported, so that "No credential files" is never said about a repo with one.
    summarise(items, snap, { deferred = 0 } = {}) {
      if (items.length) {
        const open = items.filter((i) => !i.acknowledged);
        // Nothing on a branch or tag means nothing is in history, so neither the
        // heading nor the "deleting it later does not remove it" line applies.
        // "unknown" is treated as history to be safe.
        const isHistory = (i) => i.place === 'branch' || i.place === 'tag' || i.place === 'unknown';
        const whereOf = (list) => (list.some(isHistory) ? 'in git history' : 'in this repository, outside its history');
        // Everything here has been looked at and accepted: still shown, no longer a failure.
        if (!open.length) {
          return { ...result(category.id, 'acknowledged', `${plural(items.length, category.name)} ${whereOf(items)}, acknowledged`), items };
        }
        // Mixed findings take the worse advice: if anything was pushed, say so.
        const inHistory = open.some(isHistory);
        const advice = open.some((i) => i.exposure === 'pushed')
          ? category.advice.pushed
          : inHistory
            ? category.advice.local
            : category.advice.kept;
        return { ...result(category.id, STATUS_WHEN_FIRED[category.severity], `${plural(items.length, category.name)} ${whereOf(open)}`, advice), items };
      }
      // Finding nothing in a partial clone proves nothing: the other commits aren't here.
      if (snap.limits().length) {
        return result(category.id, 'unknown', `${plural(0, category.name)} found, but the history is incomplete (see above)`);
      }
      return result(category.id, 'pass', `No ${deferred ? 'other ' : ''}${category.name}s in git history`);
    },
  };
}

// Registration order is output order. Ids are asserted unique by the test suite,
// because v0.3.2 will address checks by id from the command line.
export const CHECKS = [
  readme,
  license,
  gitignore,
  envTracked,
  dependenciesTracked,
  acknowledgements,
  historyScope,
  ...RISKY_CATEGORIES.map(riskyHistoryCheck),
];

/**
 * The checks to run for `--only` and `--skip`, in registration order. Throws
 * with every unknown id named, so the CLI can refuse the whole command (exit
 * 64) rather than quietly check less than was asked.
 */
export function selectChecks({ only = [], skip = [] } = {}) {
  const known = new Set(CHECKS.map((c) => c.id));
  const unknown = [...only, ...skip].filter((id) => !known.has(id));
  if (unknown.length) {
    throw new Error(`unknown check: ${unknown.join(', ')}. The checks are: ${[...known].join(', ')}`);
  }
  return CHECKS.filter((c) => (!only.length || only.includes(c.id)) && !skip.includes(c.id));
}

export function runChecks(dir, { checks = CHECKS } = {}) {
  const snap = snapshot(dir);
  const results = [];
  for (const check of checks) {
    const applies = check.appliesTo ? check.appliesTo(snap) : true;
    if (applies !== true) {
      // A diagnostic has nothing to say about a folder it does not apply to, so
      // it doesn't leave a placeholder behind either.
      if (!check.diagnostic) results.push(finding(check, result(check.id, 'skip', applies)));
      continue;
    }
    const found = check.run(snap);
    if (found) results.push(finding(check, found));
  }
  return applyPolicy(results, snap, checks);
}
