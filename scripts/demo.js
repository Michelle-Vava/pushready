// Builds throwaway repos covering different project types and git situations, and
// runs pushready on each one.
//
//   npm run demo                  every scenario
//   npm run demo -- pushed-history  just one
//   npm run demo -- --history     with the detailed history output
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, buildScenario } from './scenarios.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const args = process.argv.slice(2);
const detailed = args.includes('--history');
const wanted = args.filter((a) => !a.startsWith('-'));

const chosen = wanted.length ? SCENARIOS.filter((s) => wanted.includes(s.name)) : SCENARIOS;
if (!chosen.length) {
  console.error(`No such scenario. Available: ${SCENARIOS.map((s) => s.name).join(', ')}`);
  process.exit(2);
}

let failures = 0;
for (const scenario of chosen) {
  console.log(`\n${'═'.repeat(72)}\n${scenario.name} — ${scenario.title}\n${'═'.repeat(72)}`);
  const { dir, cleanup } = buildScenario(scenario);
  try {
    const started = Date.now();
    const { status } = spawnSync(process.execPath, [cli, dir, ...(detailed ? ['--history'] : [])], { stdio: 'inherit' });
    console.log(`  (checked in ${Date.now() - started} ms)`);
    if (status !== scenario.expect) {
      console.error(`  Expected exit code ${scenario.expect}, got ${status}`);
      failures++;
    }
  } finally {
    cleanup();
  }
}

if (failures) {
  console.error(`\n${failures} scenario(s) did not behave as described.`);
  process.exitCode = 1;
}
