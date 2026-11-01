// Recorded output for every scenario, so the demos verify what pushready *says*
// and not only the exit code it returns.
//
// Each scenario has a file under test/golden/ holding its plain and --history
// output and both exit codes. `npm test` compares against it; `npm run golden`
// rewrites it. A wording change shows up as a reviewable diff instead of
// slipping through because the exit code happened to stay the same.
//
// Why this exists: the gitignored-too-late scenario spent three releases not
// demonstrating what its title claimed (its commit helper re-added the file it
// had just untracked) and every exit-code assertion still passed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCENARIOS, buildScenario } from './scenarios.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
export const GOLDEN_DIR = fileURLToPath(new URL('../test/golden/', import.meta.url));
export const goldenPath = (name) => join(GOLDEN_DIR, `${name}.txt`);

// Everything that legitimately differs between two runs of the same scenario —
// including between two *platforms*, so that one recording is the truth on
// Linux, macOS and Windows alike. Windows paths use backslashes, macOS puts its
// temp folder under /var/folders, and JSON escapes backslashes again.
function normalise(text, dir) {
  const bothWays = (value, token) =>
    (s) => s.split(value).join(token).split(JSON.stringify(value).slice(1, -1)).join(token);
  const steps = [
    bothWays(dir, '<repo>'),
    // Any other temp folder in the output (the shallow clone's source).
    bothWays(tmpdir(), '<tmp>'),
    (s) => s.split(pathToFileURL(tmpdir()).href).join('<tmp-url>'),
    // Windows prints the repo path with backslashes; the token must not depend
    // on which separator the platform chose.
    (s) => s.replace(/<repo>[\\]/g, '<repo>/'),
    // Full hashes in --json, the short form in --history and the item lines.
    (s) => s.replace(/\b[0-9a-f]{40}\b/g, '<sha>').replace(/\b[0-9a-f]{10}\b/g, '<sha>'),
    // The version, so a release bump is not a 19-file diff.
    (s) => s.replace(/^pushready \d+\.\d+\.\d+$/m, 'pushready <version>').replace(/"version": "\d+\.\d+\.\d+"/, '"version": "<version>"'),
    // Node prints \n on Windows too, but a CRLF checkout of a recording would
    // not match it. .gitattributes keeps them LF; this is the belt to that brace.
    (s) => s.replace(/\r\n/g, '\n'),
  ];
  return steps.reduce((value, step) => step(value), text);
}

function runCli(dir, flags) {
  const r = spawnSync(process.execPath, [CLI, dir, ...flags], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { text: normalise(r.stdout + r.stderr, dir), code: r.status };
}

/** Build one scenario, run pushready on it both ways, and render the record. */
export function renderScenario(scenario) {
  const { dir, cleanup } = buildScenario(scenario);
  try {
    const plain = runCli(dir, []);
    const detailed = runCli(dir, ['--history']);
    const json = runCli(dir, ['--json']);
    return [
      `# ${scenario.name} — ${scenario.title}`,
      `# expects exit ${scenario.expect}`,
      '',
      `=== pushready <repo> (exit ${plain.code}) ===`,
      plain.text.trimEnd(),
      '',
      `=== pushready <repo> --history (exit ${detailed.code}) ===`,
      detailed.text.trimEnd(),
      '',
      `=== pushready <repo> --json (exit ${json.code}) ===`,
      json.text.trimEnd(),
      '',
    ].join('\n');
  } finally {
    cleanup();
  }
}

export function readGolden(name) {
  const path = goldenPath(name);
  // Normalise line endings on read as well as write: a recording checked out
  // with CRLF must still compare equal to what the CLI prints.
  return existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null;
}

// Run directly:
//
//   npm run golden                 re-record every scenario
//   npm run golden -- stash-only   just one
//   npm run golden -- --check      compare without writing; non-zero if any differ
//
// --check is what CI runs on each platform: the recordings are committed from
// one machine, so this is the step that proves they are the truth on the others.
// pathToFileURL, not string concatenation: on Windows process.argv[1] is a path
// like C:\... which is not a URL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes('--check');
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const chosen = wanted.length ? SCENARIOS.filter((s) => wanted.includes(s.name)) : SCENARIOS;
  if (!chosen.length) {
    console.error(`No such scenario. Available: ${SCENARIOS.map((s) => s.name).join(', ')}`);
    process.exit(2);
  }
  if (!check) mkdirSync(GOLDEN_DIR, { recursive: true });
  let differing = 0;
  for (const scenario of chosen) {
    const before = readGolden(scenario.name);
    const after = renderScenario(scenario);
    const state = before === after ? 'unchanged' : before === null ? 'new      ' : 'DIFFERS  ';
    if (before !== after) differing++;
    if (!check) writeFileSync(goldenPath(scenario.name), after);
    console.log(`${check ? state : state.replace('DIFFERS  ', 'UPDATED  ')}  ${scenario.name}`);
    if (check && before !== after) {
      const a = after.split('\n');
      const e = (before ?? '').split('\n');
      const i = a.findIndex((line, n) => line !== e[n]);
      console.log(`    line ${i + 1}\n      recorded: ${JSON.stringify(e[i])}\n      here:     ${JSON.stringify(a[i])}`);
    }
  }
  // A scenario that was renamed or removed leaves a file behind; say so.
  const known = new Set(SCENARIOS.map((s) => `${s.name}.txt`));
  for (const file of readdirSync(GOLDEN_DIR)) {
    if (!known.has(file)) console.log(`orphan    ${file} — no scenario by that name`);
  }
  if (check && differing) {
    console.error(`\n${differing} scenario(s) differ here from the recorded output.`);
    process.exit(1);
  }
}
