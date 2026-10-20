#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { runChecks } from './checks.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `pushready ${version}
Check a repository for common mistakes before you push it or make it public.

Usage: pushready [path]

  path            folder to check (default: current folder)
  -h, --help      show this help
  -v, --version   show the version

Exit code is 1 if any check fails.`;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const ICON = {
  pass: paint(32, '✔'),
  warn: paint(33, '!'),
  fail: paint(31, '✖'),
  skip: paint(90, '-'),
};

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}
if (args.includes('-v') || args.includes('--version')) {
  console.log(version);
  process.exit(0);
}

const dir = resolve(args[0] ?? '.');
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`pushready: not a folder: ${dir}`);
  process.exit(2);
}

const results = runChecks(dir);
console.log(`\nChecking ${dir}\n`);
for (const r of results) {
  console.log(`  ${ICON[r.status]} ${r.message}`);
  if (r.fix && r.status !== 'pass') console.log(paint(90, `      → ${r.fix}`));
}

const count = (s) => results.filter((r) => r.status === s).length;
const failed = count('fail');
const warnings = count('warn');
console.log(`\n  ${count('pass')} passed, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
