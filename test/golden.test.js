// Every scenario's full output, compared against the recorded copy in
// test/golden/. This is what stops a wording or guidance change from passing
// unnoticed because the exit code did not move; `scripts/demo.js` only ever
// checked the code. Run `npm run golden` to review and accept a change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '../scripts/scenarios.js';
import { readGolden, renderScenario } from '../scripts/golden.js';

for (const scenario of SCENARIOS) {
  test(`scenario ${scenario.name} produces its recorded output`, () => {
    const expected = readGolden(scenario.name);
    assert.ok(expected !== null, `no recorded output for ${scenario.name}. Run: npm run golden -- ${scenario.name}`);
    const actual = renderScenario(scenario);
    if (actual !== expected) {
      // Point at the first differing line: a 60-line diff in the assertion
      // message is unreadable, and the file on disk has the full picture.
      const a = actual.split('\n');
      const e = expected.split('\n');
      const i = a.findIndex((line, n) => line !== e[n]);
      assert.fail(
        `${scenario.name} output changed at line ${i + 1}:\n` +
          `  recorded: ${JSON.stringify(e[i])}\n` +
          `  now:      ${JSON.stringify(a[i])}\n` +
          `Review the whole change with: npm run golden -- ${scenario.name} && git diff test/golden/`,
      );
    }
  });
}

test('every scenario declares the exit code its recorded output shows', () => {
  for (const scenario of SCENARIOS) {
    const recorded = readGolden(scenario.name);
    assert.ok(recorded, scenario.name);
    // The plain run is the one scripts/demo.js checks, so that is the one that
    // has to agree with `expect`.
    const [, code] = recorded.match(/=== pushready <repo> \(exit (\d+)\) ===/) ?? [];
    assert.equal(Number(code), scenario.expect, `${scenario.name} declares ${scenario.expect}`);
  }
});

test('in every recording, the verdict agrees with the exit code, in text and in JSON', () => {
  for (const scenario of SCENARIOS) {
    const recorded = readGolden(scenario.name);
    const [, textCode] = recorded.match(/=== pushready <repo> \(exit (\d+)\) ===/);
    const [, jsonCode] = recorded.match(/=== pushready <repo> --json \(exit (\d+)\) ===/);
    assert.equal(jsonCode, textCode, `${scenario.name}: --json changed the exit code`);
    const ready = /Ready to make public: yes/.test(recorded.split('--history')[0]);
    assert.equal(ready, textCode === '0', `${scenario.name}: verdict "${ready ? 'yes' : 'no'}" against exit ${textCode}`);
    const doc = JSON.parse(recorded.slice(recorded.indexOf('{', recorded.indexOf('--json (exit'))));
    assert.equal(String(doc.exit), textCode, `${scenario.name}: JSON exit field`);
    assert.equal(doc.verdict.ready, textCode === '0', `${scenario.name}: JSON verdict`);
  }
});
