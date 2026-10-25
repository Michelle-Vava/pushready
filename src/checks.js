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

// Filename conventions that commonly hold secrets or personal data.
//
// pushready never opens these files, so a match means "this name is normally
// used for X", not "this file definitely contains a secret". Messages are
// worded as a warning to check, not as an accusation. Order matters: the first
// category that matches wins, so .env is a credential rather than a data file.
const RISKY_CATEGORIES = [
  {
    id: 'history-keys',
    name: 'private key file',
    status: 'fail',
    test: (name) => /^id_(rsa|dsa|ecdsa|ed25519)$/i.test(name) || /\.(pem|key|p12|pfx)$/i.test(name),
    advice: {
      pushed: 'These names are normally used for private keys, and they were pushed. Replace any key that was real, then see "What to do next" below.',
      local: 'These names are normally used for private keys. Deleting the file in a later commit does not remove it — see "What to do next" below.',
    },
  },
  {
    id: 'history-credentials',
    name: 'credential file',
    status: 'fail',
    test: (name) =>
      isEnvFile(name) || /^credentials\.json$/i.test(name) || /^service-account.*\.json$/i.test(name) || /^\.netrc$/i.test(name),
    advice: {
      pushed: 'These names are normally used for logins or API tokens, and they were pushed. Rotate anything that was real, then see "What to do next" below.',
      local: 'These names are normally used for logins or API tokens. Deleting the file in a later commit does not remove it — see "What to do next" below.',
    },
  },
  {
    id: 'history-data',
    name: 'data file',
    status: 'warn',
    test: (name) => /\.(sqlite3?|db)$/i.test(name),
    advice: {
      pushed: 'These names are normally used for databases, and they were pushed. Leaked data cannot be rotated — see "What to do next" below.',
      local: 'These names are normally used for databases, which may hold personal data. See "What to do next" below.',
    },
  },
];

// Names that match a pattern above but are public or harmless by convention.
// Certificates (.crt, .cer, .csr) are simply not in any list: they are meant to be shared.
const NOT_RISKY = [/\.pub$/i, /^thumbs\.db$/i];

function categoryOf(path) {
  const name = basename(path);
  if (NOT_RISKY.some((re) => re.test(name))) return null;
  return RISKY_CATEGORIES.find((c) => c.test(name)) ?? null;
}

function git(dir, args) {
  // quotePath=false stops git escaping non-ASCII paths (".env" under "café/" came
  // back as "caf\303\251/.env" and was missed). Commands that can see odd paths
  // also use -z, which covers paths containing newlines.
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
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

// Reasons the local clone cannot show the whole history, so "nothing found"
// cannot be trusted. Each entry carries the command that fixes it.
function historyLimits(dir) {
  const read = (args) => {
    try {
      return git(dir, args).trim();
    } catch {
      return '';
    }
  };
  const limits = [];
  // git clone --depth, or actions/checkout without fetch-depth: 0.
  if (read(['rev-parse', '--is-shallow-repository']) === 'true') {
    limits.push({ reason: 'this is a shallow clone, so older commits are not here', fix: 'git fetch --unshallow' });
  }
  // git clone --single-branch narrows the refspec, so other branches were never fetched.
  const refspec = read(['config', '--get', 'remote.origin.fetch']);
  if (refspec && !refspec.includes('*')) {
    limits.push({ reason: 'only one branch was cloned, so other branches are not here', fix: 'git remote set-branches origin "*" && git fetch' });
  }
  return limits;
}

// Which of these paths the current .gitignore would ignore. Works on paths that no
// longer exist on disk, which is the point: it is how we spot someone who added a
// secret to .gitignore and assumed that dealt with the copy already in git.
function ignoredPaths(dir, paths) {
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

// Findings the user has looked at and accepted, from .pushready.json in the repo
// being checked. They stay visible; they just stop failing the run.
export const ACK_FILE = '.pushready.json';

function readAcknowledgements(dir) {
  const path = join(dir, ACK_FILE);
  if (!existsSync(path)) return { map: new Map(), error: null };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const map = new Map();
    for (const entry of Array.isArray(parsed.acknowledge) ? parsed.acknowledge : []) {
      if (typeof entry === 'string') map.set(entry, '');
      else if (entry && typeof entry.path === 'string') map.set(entry.path, typeof entry.reason === 'string' ? entry.reason : '');
    }
    return { map, error: null };
  } catch (error) {
    return { map: new Map(), error: error.message };
  }
}

function checkHistoryScope(limits) {
  if (!limits.length) return result('history-scope', 'pass', 'Full git history available');
  return result(
    'history-scope',
    'unknown',
    `Only part of the git history can be checked: ${limits.map((l) => l.reason).join('; ')}`,
    `A risky file in the commits that are missing will not be found. Fix with: ${limits.map((l) => l.fix).join(' , then ')}`,
  );
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
  const out = git(dir, ['log', '--all', '--diff-filter=A', '--name-only', '--pretty=format:', '-z']);
  return new Set(out.split('\0').filter(Boolean));
}

const lines = (out) => out.split('\n').map((l) => l.trim()).filter(Boolean);
// "origin/HEAD" is a pointer to another branch, not a branch of its own.
const refNames = (out) => lines(out).filter((r) => !r.endsWith('/HEAD'));

// Read once per run: which branch we're on, and whether a remote exists at all.
function repoContext(dir) {
  const read = (args) => {
    try {
      return git(dir, args).trim();
    } catch {
      return '';
    }
  };
  return { branch: read(['rev-parse', '--abbrev-ref', 'HEAD']), hasRemote: read(['remote']).length > 0 };
}

// Where one risky path lives. Only commit hashes and ref names are read here;
// never the author, message or date (see "What it reads" in the README).
function describePath(dir, path, present, context) {
  const read = (args) => {
    try {
      return git(dir, args);
    } catch {
      return '';
    }
  };
  const commit = lines(read(['log', '--all', '--diff-filter=A', '--format=%H', '--reverse', '--', path]))[0] ?? '';
  const branches = commit ? refNames(read(['branch', '--contains', commit, '--format=%(refname:short)'])) : [];
  const remotes = commit ? refNames(read(['branch', '-r', '--contains', commit, '--format=%(refname:short)'])) : [];
  // Remote-tracking refs are only as fresh as the last fetch, so "not on a remote"
  // is a statement about this clone, not about the server.
  const exposure = remotes.length ? 'pushed' : context.hasRemote ? 'not on a remote' : 'local only';
  // One branch is enough for the default output; prefer the one the user is on.
  const branch = branches.includes(context.branch) ? context.branch : branches[0] ?? '';
  return { path, present, commit, branch, branches, remotes, exposure };
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

// One check per category, over every path ever added on any branch. A path still
// in the repo is reported too, because "git rm" would not remove it from history.
function checkRiskyHistory(dir, category, risky, scan) {
  const found = risky.filter((p) => categoryOf(p)?.id === category.id);
  if (found.length) {
    const items = found.map((p) => ({
      ...describePath(dir, p, scan.tracked.has(p), scan.context),
      ignored: scan.ignored.has(p),
      acknowledged: scan.acks.has(p),
      reason: scan.acks.get(p) ?? '',
    }));
    const open = items.filter((i) => !i.acknowledged);
    // Everything here has been looked at and accepted: still shown, no longer a failure.
    if (!open.length) {
      return { ...result(category.id, 'acknowledged', `${plural(items.length, category.name)} in git history, acknowledged`), items };
    }
    // Mixed findings take the worse advice: if anything was pushed, say so.
    const advice = open.some((i) => i.exposure === 'pushed') ? category.advice.pushed : category.advice.local;
    return { ...result(category.id, category.status, `${plural(found.length, category.name)} in git history`, advice), items };
  }
  // Finding nothing in a partial clone proves nothing: the other commits aren't here.
  if (scan.limits.length) {
    return result(category.id, 'unknown', `${plural(0, category.name)} found, but the history is incomplete (see above)`);
  }
  return result(category.id, 'pass', `No ${category.name}s in git history`);
}

export const DOCS = {
  removingData: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository',
  filterRepo: 'https://github.com/newren/git-filter-repo#how-do-i-install-it',
  support: 'https://support.github.com/',
};

// Double quotes work the same in bash, cmd and PowerShell, but only for paths
// without these characters. Anything else is handed over as a file list instead.
const HARD_TO_QUOTE = /["$`\\\n]/;
const MAX_PATHS_INLINE = 8;

function filterRepoCommand(paths) {
  if (paths.length > MAX_PATHS_INLINE || paths.some((p) => HARD_TO_QUOTE.test(p))) {
    return 'git filter-repo --invert-paths --paths-from-file paths.txt   (list one path per line in paths.txt)';
  }
  return `git filter-repo --invert-paths ${paths.map((p) => `--path "${p}"`).join(' ')}`;
}

/**
 * The "what to do next" guide, built from what the checks actually found.
 * Returns null when there is nothing in history to act on.
 *
 * pushready never runs any of this: the steps are for the user to run.
 */
export function exposureGuide(results, { detailed = false } = {}) {
  const withItems = results.filter((r) => r.items?.length);
  if (!withItems.length) return null;

  // Acknowledged findings are ones the user has already looked at and accepted,
  // so they stay on screen but drop out of the list of things to go and do.
  const pick = (ids) => withItems.filter((r) => ids.includes(r.id)).flatMap((r) => r.items).filter((i) => !i.acknowledged);
  const credentials = pick(['history-keys', 'history-credentials']);
  const data = pick(['history-data']);
  const all = [...credentials, ...data];
  if (!all.length) return null;
  const wasPushed = (i) => i.exposure === 'pushed';
  const names = (list) => list.map((i) => i.path).join(', ');

  const steps = [];
  if (credentials.length) {
    const pushed = credentials.filter(wasPushed);
    steps.push(
      pushed.length
        ? [
            `Rotate or revoke these now: ${names(pushed)}.`,
            'They were pushed, so cleaning history will not un-leak them from clones, forks or caches.',
          ]
        : [
            'None of these were pushed from this clone, so they probably never left your machine.',
            'Run "git fetch" if you are not sure, and rotate anything you cannot account for.',
          ],
    );
  }
  if (data.length) {
    const pushed = data.filter(wasPushed);
    steps.push(
      pushed.length
        ? [`Work out what ${names(pushed)} held and who it affects. Leaked data cannot be rotated.`]
        : [`Check what ${names(data)} holds before you push. Leaked data cannot be rotated.`],
    );
  }

  // The most common misunderstanding: adding a file to .gitignore after the fact.
  const ignored = all.filter((i) => i.ignored);
  if (ignored.length) {
    const tracked = ignored.filter((i) => i.present);
    const explain = [
      `.gitignore already lists ${names(ignored)}, but that does not undo anything git has already recorded.`,
      'It only stops a file being added in future: it does not remove anything from history.',
    ];
    if (tracked.length) {
      explain.push(
        `It also has no effect on a file git already tracks, which is why ${names(tracked)} is still in the repo.`,
        `Untrack it first: git rm --cached ${tracked.map((i) => `"${i.path}"`).join(' ')}`,
      );
    }
    steps.push(explain);
  }

  const remove = [`Remove them from history yourself — pushready will not do it for you:`, filterRepoCommand(all.map((i) => i.path))];
  if (detailed) {
    remove.push(
      'git filter-repo is not part of git; install it first.',
      'Run it on a fresh clone. It refuses to rewrite a repo with other changes unless you pass --force,',
      'and it removes the "origin" remote afterwards, so add it back before pushing.',
    );
  }
  steps.push(remove);

  if (all.some(wasPushed)) {
    const after = ['Force-push the rewritten history, and ask every collaborator to re-clone.'];
    if (detailed) {
      after.push(
        'Old clones and forks still hold the secret; a rewrite on your side does not reach them.',
        'On GitHub, cached pull request refs can keep the old commits reachable even after a force-push.',
        `Contact GitHub Support to have them purged: ${DOCS.support}`,
      );
    }
    steps.push(after);
  }

  const links = [DOCS.removingData];
  if (detailed) links.push(DOCS.filterRepo);
  return { steps, links, detailed };
}

export function runChecks(dir) {
  const results = [checkReadme(dir), checkLicense(dir), checkGitignore(dir)];
  const gitIds = ['env-tracked', 'node-modules-tracked', 'history-scope', ...RISKY_CATEGORIES.map((c) => c.id)];
  if (!isGitRepo(dir)) {
    for (const id of gitIds) results.push(result(id, 'skip', 'Not a git repository'));
    return results;
  }
  const tracked = listTracked(dir);
  results.push(checkTrackedEnv(tracked), checkTrackedNodeModules(tracked));

  // Everything the category checks need is gathered once here and shared.
  const trackedSet = new Set(tracked);
  const risky = [...listEverAdded(dir)]
    // A tracked .env is already reported by env-tracked; don't say it twice.
    .filter((p) => !(isEnvFile(p) && trackedSet.has(p)))
    .filter((p) => categoryOf(p))
    .sort();
  const { map: acks, error: ackError } = readAcknowledgements(dir);
  const scan = {
    tracked: trackedSet,
    context: repoContext(dir),
    limits: historyLimits(dir),
    ignored: ignoredPaths(dir, risky),
    acks,
  };

  if (ackError) {
    results.push(result('acknowledgements', 'warn', `Could not read ${ACK_FILE}: ${ackError}`,
      `Fix the JSON, or delete ${ACK_FILE}. Nothing was acknowledged this run.`));
  }
  results.push(checkHistoryScope(scan.limits));
  for (const category of RISKY_CATEGORIES) results.push(checkRiskyHistory(dir, category, risky, scan));
  return results;
}
