// The checks, and the order they run in.
//
// Each check is an object rather than a bare function, so that three things are
// stated rather than implied: its `id`, whether it `needsGit`, and `reads` —
// the snapshot fields it is allowed to touch. A check receives the snapshot and
// nothing else, so it cannot reach past that list; the test suite holds every
// check to it (see "declares the snapshot fields it reads" in the tests).
//
// What is still missing from this shape, and when it arrives:
//   TODO(v0.3.1): a policy pass over results — suppression (see snapshot.risky)
//                 and acknowledgement (see riskyHistoryCheck) both belong there.
//   TODO(v0.3.1): results carry `severity` as well as `status` (see patterns.js).
//   TODO(v0.3.2): `title` and `appliesTo(snapshot)` on every check; `--only` and
//                 `--skip` select from CHECKS by id.
import { RISKY_CATEGORIES, categoryOf, isEnvFile, isNodeModules } from './patterns.js';
import { ACK_FILE } from './acknowledge.js';
import { snapshot } from './snapshot.js';
import { plural } from './text.js';

function result(id, status, message, fix) {
  return { id, status, message, fix };
}

function findFile(snap, pattern) {
  return snap.files().find((name) => pattern.test(name));
}

const readme = {
  id: 'readme',
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

const gitignore = {
  id: 'gitignore',
  reads: ['has', 'readFile'],
  run(snap) {
    if (!snap.has('.gitignore')) {
      return result('gitignore', 'fail', 'No .gitignore', 'Add a .gitignore so build output, dependencies and .env files are not committed.');
    }
    const text = snap.readFile('.gitignore');
    const missing = [];
    if (snap.has('package.json') && !/node_modules/.test(text)) missing.push('node_modules');
    if (!/\.env/.test(text)) missing.push('.env');
    if (missing.length) {
      return result('gitignore', 'warn', `.gitignore does not ignore ${missing.join(' or ')}`, `Add ${missing.map((m) => `"${m}"`).join(' and ')} to .gitignore.`);
    }
    return result('gitignore', 'pass', '.gitignore found');
  },
};

// "git ls-files" lists staged files as well as committed ones. The two need
// different words: a staged .env has never been in a commit, so there is nothing
// to rotate and nothing in history to clean — "git rm --cached" really is enough.
const envTracked = {
  id: 'env-tracked',
  needsGit: true,
  reads: ['tracked', 'committed'],
  run(snap) {
    const env = snap.tracked().filter(isEnvFile);
    if (!env.length) return result('env-tracked', 'pass', 'No .env files committed');
    const committed = snap.committed();
    const staged = env.filter((p) => !committed.has(p));
    if (staged.length === env.length) {
      return result('env-tracked', 'fail', `Secret file(s) staged, not yet committed: ${env.join(', ')}`,
        'Run "git rm --cached <file>" and add it to .gitignore before you commit. It has never been in a commit, so nothing needs cleaning up. Commit a .env.example instead.');
    }
    return result('env-tracked', 'fail', `Secret file(s) committed: ${env.join(', ')}`,
      'Run "git rm --cached <file>", add it to .gitignore, and rotate any keys it held. Commit a .env.example instead.');
  },
};

const nodeModulesTracked = {
  id: 'node-modules-tracked',
  needsGit: true,
  reads: ['tracked'],
  run(snap) {
    const count = snap.tracked().filter(isNodeModules).length;
    if (count) {
      return result('node-modules-tracked', 'fail', `node_modules is committed (${plural(count, 'file')})`,
        'Run "git rm -r --cached node_modules" and add node_modules to .gitignore.');
    }
    return result('node-modules-tracked', 'pass', 'node_modules not committed');
  },
};

// Not a check on the repository but on pushready's own config: it reports only
// when .pushready.json could not be read, and produces no "skip" placeholder.
const acknowledgements = {
  id: 'acknowledgements',
  needsGit: true,
  diagnostic: true,
  reads: ['acks'],
  run(snap) {
    const { error } = snap.acks();
    if (!error) return null;
    return result('acknowledgements', 'warn', `Could not read ${ACK_FILE}: ${error}`,
      `Fix the JSON, or delete ${ACK_FILE}. Nothing was acknowledged this run.`);
  },
};

const historyScope = {
  id: 'history-scope',
  needsGit: true,
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

// One check per category, over every path ever added on any branch. A path still
// in the repo is reported too, because "git rm" would not remove it from history.
function riskyHistoryCheck(category) {
  return {
    id: category.id,
    needsGit: true,
    reads: ['risky', 'describe', 'ignored', 'acks', 'limits'],
    run(snap) {
      const found = snap.risky().filter((p) => categoryOf(p)?.id === category.id);
      if (found.length) {
        const ignored = snap.ignored();
        // TODO(v0.3.1): acknowledgement is applied here and only here, so only a
        // history finding can be acknowledged. A tracked fixture .env, or a
        // deliberately committed node_modules, cannot — .pushready.json has no
        // effect on env-tracked or node-modules-tracked. Move to the policy pass.
        const acks = snap.acks().map;
        const items = found.map((p) => ({
          ...snap.describe(p),
          ignored: ignored.has(p),
          acknowledged: acks.has(p),
          reason: acks.get(p) ?? '',
        }));
        const open = items.filter((i) => !i.acknowledged);
        // Everything here has been looked at and accepted: still shown, no longer a failure.
        if (!open.length) {
          // TODO(v0.3.1): this heading says "in git history" even when every item
          // is in a stash or an unreachable commit; the non-acknowledged branch
          // below already gets this right via `inHistory`.
          return { ...result(category.id, 'acknowledged', `${plural(items.length, category.name)} in git history, acknowledged`), items };
        }
        // Mixed findings take the worse advice: if anything was pushed, say so.
        // Nothing on a branch or tag means nothing is in history, so neither the
        // heading nor the "deleting it later does not remove it" line applies.
        const inHistory = open.some((i) => i.place === 'branch' || i.place === 'tag' || i.place === 'unknown');
        const advice = open.some((i) => i.exposure === 'pushed')
          ? category.advice.pushed
          : inHistory
            ? category.advice.local
            : category.advice.kept;
        const where = inHistory ? 'in git history' : 'in this repository, outside its history';
        return { ...result(category.id, category.status, `${plural(found.length, category.name)} ${where}`, advice), items };
      }
      // Finding nothing in a partial clone proves nothing: the other commits aren't here.
      if (snap.limits().length) {
        return result(category.id, 'unknown', `${plural(0, category.name)} found, but the history is incomplete (see above)`);
      }
      return result(category.id, 'pass', `No ${category.name}s in git history`);
    },
  };
}

// Registration order is output order.
// TODO(v0.3.1): nothing asserts these ids are unique. Add a test before v0.3.2
// starts addressing checks by id from the command line.
export const CHECKS = [
  readme,
  license,
  gitignore,
  envTracked,
  nodeModulesTracked,
  acknowledgements,
  historyScope,
  ...RISKY_CATEGORIES.map(riskyHistoryCheck),
];

export function runChecks(dir) {
  const snap = snapshot(dir);
  const results = [];
  for (const check of CHECKS) {
    if (check.needsGit && !snap.isGitRepo()) {
      // A diagnostic has nothing to say about a folder that isn't a repo, so it
      // doesn't leave a placeholder behind either.
      if (!check.diagnostic) results.push(result(check.id, 'skip', 'Not a git repository'));
      continue;
    }
    const found = check.run(snap);
    if (found) results.push(found);
  }
  return results;
}
