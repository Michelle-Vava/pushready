// .pushready.json: the one file whose contents a user writes by hand, so the one
// most likely to be malformed. A bad config must never silently change what is
// reported — either it works, or pushready says it could not read it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runChecks } from '../src/index.js';
import { BLOB, MIT, README, cliRun, items, repo, status } from './helpers.js';

const withConfig = (config, files = {}) =>
  repo({ 'README.md': README, LICENSE: MIT, '.gitignore': '.env\n', 'fixtures/dummy.pem': BLOB, '.pushready.json': config, ...files });

const ackStatus = (dir) => runChecks(dir).find((r) => r.id === 'acknowledgements')?.status ?? 'absent';

test('both acknowledgement spellings work: a bare path and an object with a reason', (t) => {
  for (const config of ['{ "acknowledge": ["fixtures/dummy.pem"] }', '{ "acknowledge": [ { "path": "fixtures/dummy.pem", "reason": "test key" } ] }']) {
    const dir = withConfig(config);
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const results = runChecks(dir);
    assert.equal(status(results, 'history-keys'), 'acknowledged', config);
    assert.equal(ackStatus(dir), 'absent', 'a config that parses produces no diagnostic');
  }
});

test('a reason is shown; without one, the file is named as the source', (t) => {
  const withReason = withConfig('{ "acknowledge": [ { "path": "fixtures/dummy.pem", "reason": "fixture for the TLS tests" } ] }');
  const without = withConfig('{ "acknowledge": ["fixtures/dummy.pem"] }');
  t.after(() => {
    rmSync(withReason, { recursive: true, force: true });
    rmSync(without, { recursive: true, force: true });
  });
  assert.match(cliRun(withReason, '--history').stdout, /acknowledged +fixture for the TLS tests/);
  assert.match(cliRun(without, '--history').stdout, /acknowledged +listed in \.pushready\.json/);
});

test('broken JSON warns, names the file, and acknowledges nothing', (t) => {
  const dir = withConfig('{ "acknowledge": [ "fixtures/dummy.pem" ');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  const diagnostic = results.find((r) => r.id === 'acknowledgements');
  assert.equal(diagnostic.status, 'warn');
  assert.match(diagnostic.message, /Could not read \.pushready\.json: it is not valid JSON/);
  // Our wording, not Node's: JSON.parse words this differently in Node 18 and
  // Node 20, and the report must read the same on both.
  assert.doesNotMatch(diagnostic.message, /Unexpected token|Unexpected end/);
  assert.match(diagnostic.fix, /Nothing was acknowledged this run/);
  // The point of saying so: the finding is still a failure, not quietly excused.
  assert.equal(status(results, 'history-keys'), 'fail');
  assert.equal(cliRun(dir).status, 1);
});

// Until v0.3.2 a config of the wrong *shape* parsed, acknowledged nothing and
// said nothing, so a failing run gave no hint that the file was the reason.
test('"acknowledge" that is not a list warns, names the problem, and acknowledges nothing', (t) => {
  const dir = withConfig('{ "acknowledge": "fixtures/dummy.pem" }');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(status(results, 'history-keys'), 'fail');
  const diagnostic = results.find((r) => r.id === 'acknowledgements');
  assert.equal(diagnostic.status, 'warn');
  assert.match(diagnostic.message, /"acknowledge" should be a list of paths, got "fixtures\/dummy\.pem"/);
});

test('a misspelled key, or an empty object, is simply a file that acknowledges nothing', (t) => {
  // Nothing is wrong with these files; they just do not acknowledge anything.
  for (const config of ['{ "acknowledged": ["fixtures/dummy.pem"] }', '{}', '{ "version": 1 }']) {
    const dir = withConfig(config);
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    assert.equal(status(runChecks(dir), 'history-keys'), 'fail', config);
    assert.equal(ackStatus(dir), 'absent', config);
  }
});

test('every kind of broken JSON gets the same message, whatever Node says about it', (t) => {
  // Node 18, 20 and 24 each word these differently, and only some include a
  // position. The report must read identically on all of them.
  for (const config of ['{ "acknowledge": [ "fixtures/dummy.pem", ] }', '{ "acknowledge": [ "fixtures/dummy.pem" ', '{ acknowledge: [] }', '']) {
    const dir = withConfig(config);
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const diagnostic = runChecks(dir).find((r) => r.id === 'acknowledgements');
    assert.equal(diagnostic?.status, 'warn', JSON.stringify(config));
    assert.equal(diagnostic.message, 'Could not read .pushready.json: it is not valid JSON', JSON.stringify(config));
    assert.equal(status(runChecks(dir), 'history-keys'), 'fail', JSON.stringify(config));
  }
});

test('JSON that is valid but not an object says what it expected instead of a JavaScript error', (t) => {
  for (const [config, shown] of [['null', 'null'], ['"fixtures/dummy.pem"', '"fixtures/dummy.pem"'], ['42', '42'], ['["fixtures/dummy.pem"]', 'a list']]) {
    const dir = withConfig(config);
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const diagnostic = runChecks(dir).find((r) => r.id === 'acknowledgements');
    assert.equal(diagnostic?.status, 'warn', config);
    assert.match(diagnostic.message, /expected an object like/, config);
    assert.ok(diagnostic.message.includes(shown), `${config} names what it got`);
    assert.doesNotMatch(diagnostic.message, /Cannot read properties/, 'no leaked JavaScript error');
  }
});

// --- The version field (v0.3.2). Absent means 1; anything else is a file this
// pushready may not fully understand, and it says so rather than guessing quietly.
test('a config without a version is version 1, and one that says 1 is the same', (t) => {
  for (const config of ['{ "acknowledge": ["fixtures/dummy.pem"] }', '{ "version": 1, "acknowledge": ["fixtures/dummy.pem"] }']) {
    const dir = withConfig(config);
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const results = runChecks(dir);
    assert.equal(status(results, 'history-keys'), 'acknowledged', config);
    assert.equal(ackStatus(dir), 'absent', config);
  }
});

test('a config from a newer pushready warns, and is still applied where understood', (t) => {
  for (const version of ['2', '"2.0"', '99']) {
    const dir = withConfig(`{ "version": ${version}, "acknowledge": ["fixtures/dummy.pem"] }`);
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const results = runChecks(dir);
    const diagnostic = results.find((r) => r.id === 'acknowledgements');
    assert.equal(diagnostic.status, 'warn', version);
    assert.match(diagnostic.message, /understands version 1/, version);
    assert.match(diagnostic.fix, /applied where understood/, version);
    // The acknowledgement it could read was honoured: the run does not fail.
    assert.equal(status(results, 'history-keys'), 'acknowledged', version);
    assert.equal(cliRun(dir).status, 0, version);
  }
});

test('entries that are not usable are skipped, and the usable ones still apply', (t) => {
  const dir = withConfig('{ "acknowledge": [ 42, null, { "reason": "no path" }, { "path": 7 }, "fixtures/dummy.pem" ] }');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status(runChecks(dir), 'history-keys'), 'acknowledged');
});

test('an acknowledgement for a path that does not exist changes nothing', (t) => {
  const dir = withConfig('{ "acknowledge": ["does/not/exist.pem", "fixtures/dummy.pem"] }');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(status(results, 'history-keys'), 'acknowledged');
  assert.deepEqual(items(results, 'history-keys').map((i) => i.path), ['fixtures/dummy.pem']);
});

test('acknowledgement is by exact path, so it does not spread to similar names', (t) => {
  const dir = withConfig('{ "acknowledge": ["fixtures/dummy.pem"] }', { 'fixtures/dummy.pem.bak': BLOB, 'other/dummy.pem': BLOB });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const results = runChecks(dir);
  assert.equal(status(results, 'history-keys'), 'fail');
  assert.deepEqual(
    items(results, 'history-keys').map((i) => [i.path, i.acknowledged]),
    [['fixtures/dummy.pem', true], ['other/dummy.pem', false]],
  );
});

test('an empty acknowledge list is valid and excuses nothing', (t) => {
  const dir = withConfig('{ "acknowledge": [] }');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(status(runChecks(dir), 'history-keys'), 'fail');
  assert.equal(ackStatus(dir), 'absent');
});

test('.pushready.json is read from the repo being checked, not the current folder', (t) => {
  const dir = withConfig('{ "acknowledge": ["fixtures/dummy.pem"] }');
  const elsewhere = repo({ 'README.md': README }, { git: false });
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });
  // Run from a folder with no config at all; the target's config must still apply.
  assert.equal(cliRun(dir).status, 0);
});

test('the config file itself is never reported as a risky file', (t) => {
  const dir = withConfig('{ "acknowledge": [] }');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const all = runChecks(dir).flatMap((r) => r.items ?? []).map((i) => i.path);
  assert.ok(!all.includes('.pushready.json'), all.join(', '));
});
