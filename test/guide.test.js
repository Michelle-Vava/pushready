// The guide as rules (v0.3.4) and actions (v0.3.5).
//
// The guide decides what someone should *do* after a finding, so these tests
// are about advice being right and safe: the correct tool for where a file
// lives, in an order that does not lose data, and never a command pushready
// ran itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTION_KINDS, RULES, exposureGuide, guideCommands, guideLines, runChecks } from '../src/index.js';
import { BLOB, MIT, README, cliRun, commitAll, guideText, pushTo, repo, run } from './helpers.js';

const project = (extra = {}) => repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', ...extra });
const guideFor = (dir, options) => exposureGuide(runChecks(dir), options);
const stepIds = (guide) => (guide?.steps ?? []).map((s) => s.id);

// --- The rules themselves ------------------------------------------------------

test('every rule has an id, and the ids are unique and stable', () => {
  const ids = RULES.map((r) => r.id);
  assert.deepEqual(ids, ['rotate', 'data', 'gitignore-too-late', 'drop-stash', 'delete-ref', 'expire-unreachable', 'rewrite', 'force-push']);
  assert.equal(new Set(ids).size, ids.length);
  for (const rule of RULES) {
    assert.equal(typeof rule.appliesTo, 'function', rule.id);
    assert.equal(typeof rule.build, 'function', rule.id);
  }
});

test('a rule that does not apply contributes no step at all', (t) => {
  const dir = project({ 'key.pem': BLOB });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ids = stepIds(guideFor(dir));
  // A plain unpushed key on a branch: rotate (as reassurance) and rewrite only.
  assert.deepEqual(ids, ['rotate', 'rewrite']);
  for (const absent of ['data', 'gitignore-too-late', 'drop-stash', 'delete-ref', 'expire-unreachable', 'force-push']) {
    assert.ok(!ids.includes(absent), absent);
  }
});

test('steps appear in the order the work has to be done', (t) => {
  // A repo hitting as many rules at once as one repo can: a pushed credential
  // that .gitignore lists, a database, and a key in a stash.
  const dir = project({ '.gitignore': '.env\nleaked.pem\n', 'leaked.pem': BLOB, 'data.sqlite3': 'x' });
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  writeFileSync(join(dir, 'stashed.pem'), BLOB.replace(/line/g, 'other'));
  run(dir, 'add', 'stashed.pem');
  run(dir, 'stash', '-q');
  const ids = stepIds(guideFor(dir));
  assert.deepEqual(ids, ['rotate', 'data', 'gitignore-too-late', 'drop-stash', 'rewrite', 'force-push']);
  // The two that matter most: rotate before any cleanup, force-push last.
  assert.equal(ids[0], 'rotate', 'a leaked credential is urgent before any tidying');
  assert.equal(ids.at(-1), 'force-push', 'nothing to force-push until the rewrite is done');
  assert.ok(ids.indexOf('drop-stash') < ids.indexOf('rewrite'), 'drop the stash before rewriting what is left');
});

test('each rule fires for the situation it is named after', (t) => {
  const cases = {
    'drop-stash': (dir) => {
      writeFileSync(join(dir, 'k.pem'), BLOB);
      // -f because this fixture's .gitignore lists k.pem, for the case below.
      run(dir, 'add', '-f', 'k.pem');
      run(dir, 'stash', '-q');
    },
    'delete-ref': (dir) => {
      writeFileSync(join(dir, 'k.pem'), BLOB);
      commitAll(dir, 'key');
      run(dir, 'update-ref', 'refs/original/refs/heads/main', 'HEAD');
      run(dir, 'reset', '-q', '--hard', 'HEAD~1');
    },
    'expire-unreachable': (dir) => {
      run(dir, 'checkout', '-q', '--detach');
      writeFileSync(join(dir, 'k.pem'), BLOB);
      commitAll(dir, 'key');
      run(dir, 'checkout', '-q', '-');
    },
    'gitignore-too-late': (dir) => {
      writeFileSync(join(dir, 'k.pem'), BLOB);
      commitAll(dir, 'key');
    },
    data: (dir) => {
      writeFileSync(join(dir, 'app.sqlite3'), 'x');
      commitAll(dir, 'db');
    },
  };
  for (const [id, setUp] of Object.entries(cases)) {
    const dir = repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\nk.pem\n' });
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    setUp(dir);
    assert.ok(stepIds(guideFor(dir)).includes(id), `${id} did not fire; got ${stepIds(guideFor(dir)).join(', ')}`);
  }
});

test('the rules are the only thing that decides the guide: no findings, no guide', (t) => {
  const clean = project();
  const acknowledged = project({ 'k.pem': BLOB, '.pushready.json': '{ "acknowledge": ["k.pem"] }' });
  t.after(() => {
    rmSync(clean, { recursive: true, force: true });
    rmSync(acknowledged, { recursive: true, force: true });
  });
  assert.equal(guideFor(clean), null);
  assert.equal(guideFor(acknowledged), null, 'an accepted finding is not a thing to go and do');
});

// --- Actions ---------------------------------------------------------------------

test('every action has a known kind and the text the report prints', (t) => {
  const dir = project({ '.gitignore': '.env\nk.pem\n', 'k.pem': BLOB, 'db.sqlite3': 'x' });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const guide = guideFor(dir, { detailed: true });
  let seen = 0;
  for (const step of guide.steps) {
    assert.ok(step.actions.length > 0, step.id);
    for (const action of step.actions) {
      assert.ok(ACTION_KINDS.includes(action.kind), `${step.id}: ${action.kind}`);
      assert.equal(typeof action.text, 'string');
      assert.ok(action.text.length > 0);
      if (action.kind === 'run') {
        assert.equal(typeof action.command, 'string', `${step.id} run action has a command`);
        assert.ok(action.text.includes(action.command), 'the printed line contains the command verbatim');
      } else {
        assert.equal(action.command, undefined, 'only a run action carries a command');
      }
      seen++;
    }
  }
  assert.ok(seen > 10, `only ${seen} actions`);
});

test('a command can be read without parsing English back out of a sentence', (t) => {
  const dir = project({ '.gitignore': '.env\nk.pem\n', 'k.pem': BLOB });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const commands = guideCommands(guideFor(dir));
  // "Untrack it first: git rm --cached ..." is one line of prose plus a command;
  // the command comes back on its own, which is what `pushready fix` will need.
  assert.ok(commands.includes('git rm --cached "k.pem"'), commands.join(' | '));
  assert.ok(commands.includes('git filter-repo --invert-paths --path "k.pem"'), commands.join(' | '));
  for (const command of commands) {
    assert.doesNotMatch(command, /^(Untrack|Run|Check|Drop|Remove|Expire)\b/, `"${command}" still has prose in it`);
    assert.match(command, /^git /, 'every command pushready suggests is a git command');
  }
});

test('the paths.txt fallback keeps the hint on screen but out of the command', (t) => {
  const files = { 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n' };
  for (let i = 0; i < 12; i++) files[`k${i}.pem`] = BLOB + i;
  const dir = repo(files);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const guide = guideFor(dir);
  const action = guide.steps.find((s) => s.id === 'rewrite').actions.find((a) => a.kind === 'run');
  assert.equal(action.command, 'git filter-repo --invert-paths --paths-from-file paths.txt');
  assert.match(action.text, /\(list one path per line in paths\.txt\)$/);
});

test('stashes are dropped highest-first, and the order survives as data', (t) => {
  const dir = project();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['first.pem', 'second.pem']) {
    writeFileSync(join(dir, name), BLOB + name);
    run(dir, 'add', name);
    run(dir, 'stash', '-q');
  }
  const commands = guideCommands(guideFor(dir)).filter((c) => c.startsWith('git stash drop'));
  // Dropping stash@{0} renumbers the rest, so the higher entry has to go first.
  assert.deepEqual(commands, ['git stash drop stash@{1}', 'git stash drop stash@{0}']);
});

test('guideLines is exactly what the report prints, in order', (t) => {
  const dir = project({ 'k.pem': BLOB });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lines = guideLines(guideFor(dir));
  const printed = cliRun(dir).stdout;
  for (const line of lines) assert.ok(printed.includes(line), `missing from the report: ${line}`);
  // And in the same order.
  let at = 0;
  for (const line of lines) {
    const next = printed.indexOf(line, at);
    assert.ok(next >= at, `out of order: ${line}`);
    at = next;
  }
});

test('--history adds detail to the steps that have more to say, and nothing else changes', (t) => {
  const dir = project({ 'k.pem': BLOB });
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  const short = guideFor(dir);
  const full = guideFor(dir, { detailed: true });
  assert.deepEqual(stepIds(short), stepIds(full), 'the same steps apply either way');
  assert.ok(guideLines(full).length > guideLines(short).length);
  assert.match(guideText(full), /git filter-repo is not part of git/);
  assert.doesNotMatch(guideText(short), /git filter-repo is not part of git/);
  // The commands are the advice; detail does not add or remove any.
  assert.deepEqual(guideCommands(full), guideCommands(short));
});

// --- The promise the actions rest on ------------------------------------------------

test('a full run suggests commands and executes none of them', (t) => {
  const dir = project({ '.gitignore': '.env\nk.pem\n', 'k.pem': BLOB, 'db.sqlite3': 'x' });
  let remote;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  });
  remote = pushTo(dir);
  writeFileSync(join(dir, 'stashed.pem'), BLOB.replace(/line/g, 'other'));
  run(dir, 'add', 'stashed.pem');
  run(dir, 'stash', '-q');

  const before = snapshotOf(dir);
  const head = run_(dir, 'rev-parse', 'HEAD');
  const stashes = run_(dir, 'stash', 'list');
  const { stdout } = cliRun(dir, '--history');

  // The guide told the user to drop a stash, untrack a file and rewrite history.
  assert.match(stdout, /git stash drop/);
  assert.match(stdout, /git rm --cached/);
  assert.match(stdout, /git filter-repo/);
  // None of it happened: same files, same mtimes, same HEAD, same stashes.
  assert.deepEqual(snapshotOf(dir), before, 'a file changed');
  assert.equal(run_(dir, 'rev-parse', 'HEAD'), head, 'HEAD moved');
  assert.equal(run_(dir, 'stash', 'list'), stashes, 'a stash was dropped');
});

import { execFileSync } from 'node:child_process';
const run_ = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

// Every file in the working tree with its size and modified time, so that a
// write of any kind shows up.
function snapshotOf(dir) {
  const out = [];
  const walk = (at, prefix = '') => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      // .git holds the stash and reflog, which the commands above would change,
      // so it is covered by the HEAD and stash-list assertions instead: git's
      // own housekeeping can touch it without pushready having done anything.
      if (entry.name === '.git') continue;
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else {
        const { size, mtimeMs } = statSync(path);
        out.push(`${prefix}${entry.name} ${size} ${mtimeMs}`);
      }
    }
  };
  walk(dir);
  return out;
}
