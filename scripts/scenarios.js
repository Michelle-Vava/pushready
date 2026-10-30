// Throwaway repos covering the project types and git situations pushready has to
// handle. Each one builds in a temp folder and is deleted again by the caller.
//
// `expect` is the exit code pushready should return (0 clean, 1 problems but
// nothing pushed, 2 something was pushed), so running the demo doubles as a check
// that the scenarios still behave the way they are described.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MIT = 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files, to deal in the Software\nwithout restriction.\n';
const README = '# demo\n\nWhat it does.\n\n## Install\n\nnpm install\n\n## Use\n\nnpm start\n';

function makeRepo() {
  const temps = [];
  const dir = mkdtempSync(join(tmpdir(), 'pushready-demo-'));
  temps.push(dir);
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.com', ...args], { cwd: dir, stdio: 'ignore' });
  const write = (path, content) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  const commit = (message) => {
    git('add', '-A', '-f');
    git('commit', '-q', '--allow-empty', '-m', message);
  };
  // A bare repo standing in for GitHub, so "pushed" can be demonstrated offline.
  const push = (branch = 'main') => {
    const remote = mkdtempSync(join(tmpdir(), 'pushready-remote-'));
    temps.push(remote);
    execFileSync('git', ['init', '-q', '--bare', remote], { stdio: 'ignore' });
    git('remote', 'add', 'origin', remote);
    git('push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    git('fetch', '-q', 'origin');
  };
  // Re-clones at depth 1 and checks that copy instead, so the demo can show what
  // happens when the older commits simply are not on the machine.
  const state = { checkDir: dir };
  const shallowClone = () => {
    const into = mkdtempSync(join(tmpdir(), 'pushready-shallow-'));
    temps.push(into);
    // --depth is ignored when cloning a local path, so a file:// URL is required.
    execFileSync('git', ['clone', '-q', '--depth', '1', pathToFileURL(dir).href, 'clone'], { cwd: into, stdio: 'ignore' });
    state.checkDir = join(into, 'clone');
  };
  git('init', '-q');
  git('checkout', '-q', '-b', 'main');
  return { dir, git, write, commit, push, shallowClone, temps, state };
}

export const SCENARIOS = [
  {
    name: 'clean-node',
    title: 'A tidy Node project: nothing to fix',
    expect: 0,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', 'node_modules\n.env\ndist\n');
      r.write('package.json', '{ "name": "clean-app" }\n');
      r.write('src/index.js', 'console.log("hi");\n');
      r.write('.env.example', 'API_URL=\n');
      r.commit('first commit');
    },
  },
  {
    name: 'clean-python',
    title: 'A tidy Python project: nothing to fix',
    expect: 0,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', 'venv/\n__pycache__/\n*.pyc\n.env\n');
      r.write('requirements.txt', 'requests==2.31.0\n');
      r.write('app.py', 'print("hi")\n');
      r.commit('first commit');
    },
  },
  {
    name: 'messy-node',
    title: 'A Node project with the usual mistakes',
    expect: 1,
    build(r) {
      r.write('README.md', '# my-app\n');
      r.write('package.json', '{ "name": "my-app" }\n');
      r.write('.gitignore', 'dist\n');
      r.write('index.js', 'console.log("hi");\n');
      r.write('node_modules/left-pad/index.js', '');
      r.write('.env', 'API_KEY=not-a-real-key\n');
      r.write('.env.local', 'DB_PASSWORD=not-a-real-password\n');
      r.write('dev.sqlite3', 'not-a-real-database\n');
      r.commit('first commit');
      // "Fix" one mistake the common wrong way: delete the file, leave it in history.
      r.git('rm', '-q', '.env.local');
      r.commit('remove .env.local');
    },
  },
  {
    name: 'messy-python',
    title: 'A Python project with a committed venv and database',
    expect: 1,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', '__pycache__/\n');
      r.write('requirements.txt', 'django==5.0\n');
      r.write('manage.py', 'print("hi")\n');
      r.write('venv/lib/site-packages/requests/__init__.py', '');
      r.write('db.sqlite3', 'not-a-real-database\n');
      r.write('credentials.json', '{"not": "real"}\n');
      r.commit('first commit');
    },
  },
  {
    name: 'deleted-local',
    title: 'Secrets deleted but still in history, never pushed',
    expect: 1,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', '.env\nnode_modules\n');
      r.write('package.json', '{ "name": "app" }\n');
      r.write('.env', 'API_KEY=not-a-real-key\n');
      r.write('deploy/id_rsa', 'not-a-real-key\n');
      r.write('deploy/id_rsa.pub', 'not-a-real-public-key\n');
      r.commit('first commit');
      r.git('rm', '-q', '.env', 'deploy/id_rsa');
      r.commit('remove secrets');
    },
  },
  {
    name: 'pushed-history',
    title: 'A secret that was already pushed, then deleted',
    expect: 2, // 2 means "something was pushed" — rotate before anything else.
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', '.env\nnode_modules\n');
      r.write('package.json', '{ "name": "app" }\n');
      r.write('service-account-prod.json', '{"not": "real"}\n');
      r.commit('first commit');
      r.push();
      r.git('rm', '-q', 'service-account-prod.json');
      r.commit('remove service account');
    },
  },
  {
    name: 'branch-only',
    title: 'A key on one unpushed branch, with main already pushed',
    expect: 1,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', '.env\nnode_modules\n');
      r.write('package.json', '{ "name": "app" }\n');
      r.commit('first commit');
      r.push();
      r.git('checkout', '-q', '-b', 'feature/deploy');
      r.write('certs/server.key', 'not-a-real-key\n');
      r.commit('add deploy cert');
    },
  },
  {
    name: 'gitignored-too-late',
    title: 'Secrets added to .gitignore after they were already committed',
    expect: 1,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('package.json', '{ "name": "app" }\n');
      r.write('.gitignore', '*.pem\n.env.local\nnode_modules\n.env\n');
      r.write('deploy.pem', 'not-a-real-key\n');
      r.write('.env.local', 'DB_PASSWORD=not-a-real-password\n');
      r.commit('first commit');
      // The usual wrong fix: add it to .gitignore and assume that dealt with it.
      r.git('rm', '-q', '--cached', '.env.local');
      r.commit('ignore .env.local');
    },
  },
  {
    name: 'renamed-secret',
    title: 'Secrets that were renamed, in and out of a risky name',
    expect: 1,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', 'node_modules\n.env\n');
      r.write('package.json', '{ "name": "app" }\n');
      r.write('notes/config.json', '{"not": "real"}\n');
      r.write('deploy/id_rsa', 'not-a-real-key\n');
      r.commit('first commit');
      // A tidy-up that turns an innocent name into a risky one. git records this
      // as a rename, so the new name is never "added" in the usual sense.
      r.git('mv', 'notes/config.json', 'credentials.json');
      r.commit('move config to the root');
      // The other direction: renaming a key does not hide it, because the old
      // name is still the one it was committed under.
      r.git('mv', 'deploy/id_rsa', 'deploy/key.backup');
      r.commit('rename the deploy key');
    },
  },
  {
    name: 'stash-only',
    title: 'A key that only ever went into a stash: drop it, do not rewrite history',
    expect: 1,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', 'node_modules\n.env\n');
      r.write('package.json', '{ "name": "app" }\n');
      r.commit('first commit');
      r.push();
      // Staged, then stashed to "put it aside". It never reached a commit on a
      // branch, and a stash cannot be pushed — but it is still on the machine.
      r.write('deploy.pem', 'not-a-real-key\nline 2\nline 3\nline 4\n');
      r.git('add', 'deploy.pem');
      r.git('stash', '-q');
      // A second stash on top, so the key sits in stash@{1}, which "git log --all"
      // cannot see: only the newest stash is a ref.
      r.write('notes.txt', 'wip\n');
      r.git('stash', '-q', '-u');
    },
  },
  {
    name: 'tag-only',
    title: 'A key on a tag whose branch was deleted: still history, and tags may have been pushed',
    expect: 1,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', 'node_modules\n.env\n');
      r.write('package.json', '{ "name": "app" }\n');
      r.commit('first commit');
      r.push();
      r.git('checkout', '-q', '-b', 'release');
      r.write('release.pem', 'not-a-real-key\nline 2\nline 3\nline 4\n');
      r.commit('add release key');
      r.git('tag', 'v1.0');
      r.git('checkout', '-q', 'main');
      r.git('branch', '-q', '-D', 'release');
    },
  },
  {
    name: 'unreachable',
    title: 'Secrets in commits nothing points at: amended away, deleted branch, dropped stash',
    expect: 1,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', 'node_modules\n.env\n');
      r.write('package.json', '{ "name": "app" }\n');
      r.commit('first commit');
      // The classic "I fixed it with --amend" — which leaves the old commit on disk.
      r.write('amended.pem', 'not-a-real-key\nline 2\nline 3\nline 4\n');
      r.write('src/app.js', 'console.log("hi");\n');
      r.commit('oops, committed a key');
      r.git('rm', '-q', 'amended.pem');
      r.git('commit', '-q', '--amend', '-m', 'add app');
      // A branch deleted after the fact: the commit is still reachable via the reflog.
      r.git('checkout', '-q', '-b', 'spike');
      r.write('kubeconfig', 'not-a-real-cluster-token\n');
      r.commit('spike on deploy');
      r.git('checkout', '-q', 'main');
      r.git('branch', '-q', '-D', 'spike');
      // A dropped stash leaves the reflog entirely; only git fsck still finds it.
      r.write('dropped.jks', 'not-a-real-keystore\nline 2\nline 3\nline 4\n');
      r.git('add', 'dropped.jks');
      r.git('stash', '-q');
      r.git('stash', 'drop');
    },
  },
  {
    name: 'acknowledged',
    title: 'A known test fixture, accepted in .pushready.json',
    expect: 0,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', 'node_modules\n.env\n');
      r.write('package.json', '{ "name": "app" }\n');
      r.write('test/fixtures/dummy.pem', 'not-a-real-key\n');
      r.write('.pushready.json', '{ "acknowledge": [ { "path": "test/fixtures/dummy.pem", "reason": "fixture for the TLS tests, never a real key" } ] }\n');
      r.commit('first commit');
    },
  },
  {
    name: 'shallow',
    title: 'A shallow clone, where the history cannot be fully checked',
    expect: 0,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', 'node_modules\n.env\n');
      r.write('package.json', '{ "name": "app" }\n');
      r.write('secrets.pem', 'not-a-real-key\n');
      r.commit('first commit');
      r.git('rm', '-q', 'secrets.pem');
      r.commit('remove key');
      r.shallowClone();
    },
  },
  {
    name: 'large',
    title: 'A bigger repo: 600 files over 40 commits, with an old secret',
    expect: 1,
    build(r) {
      r.write('README.md', README);
      r.write('LICENSE', MIT);
      r.write('.gitignore', '.env\nnode_modules\n');
      r.write('package.json', '{ "name": "big-app" }\n');
      r.write('config/credentials.json', '{"not": "real"}\n');
      r.commit('first commit');
      // Bury the secret early, then delete it, so it is only findable in history.
      r.git('rm', '-q', 'config/credentials.json');
      r.commit('remove credentials');
      for (let c = 0; c < 40; c++) {
        for (let f = 0; f < 15; f++) r.write(`src/mod${c}/file${f}.js`, `export const v${f} = ${c};\n`);
        r.commit(`change ${c}`);
      }
    },
  },
];

// Returns the folder to check plus a cleanup that also removes any stand-in
// remote or shallow clone the scenario created.
export function buildScenario(scenario) {
  const r = makeRepo();
  scenario.build(r);
  return { dir: r.state.checkDir, cleanup: () => r.temps.forEach((t) => rmSync(t, { recursive: true, force: true })) };
}
