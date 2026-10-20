// Builds a throwaway repo with common mistakes and runs pushready on it.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pushready-demo-'));
const git = (...args) =>
  execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.com', ...args], { cwd: dir, stdio: 'ignore' });
const write = (path, content) => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), content);
};

try {
  git('init', '-q');
  write('README.md', '# my-app\n');
  write('package.json', '{ "name": "my-app" }\n');
  write('.gitignore', 'dist\n');
  write('index.js', 'console.log("hi");\n');
  write('node_modules/left-pad/index.js', '');
  write('.env', 'API_KEY=not-a-real-key\n');
  write('.env.local', 'DB_PASSWORD=not-a-real-password\n');
  git('add', '-A', '-f');
  git('commit', '-q', '-m', 'first commit');
  // "Fix" one mistake the common wrong way: delete the file but leave it in history.
  git('rm', '-q', '.env.local');
  git('commit', '-q', '-m', 'remove .env.local');

  console.log('Demo repo: README too short, no LICENSE, .gitignore missing entries,');
  console.log('.env and node_modules committed, .env.local deleted but still in history.');

  const cli = new URL('../src/cli.js', import.meta.url);
  const { status } = spawnSync(process.execPath, [cli.pathname.replace(/^\/(\w:)/, '$1'), dir], { stdio: 'inherit' });
  if (status !== 1) {
    console.error(`Expected pushready to exit with 1, got ${status}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
