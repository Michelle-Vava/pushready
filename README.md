# pushready

[![test](https://github.com/Michelle-Vava/pushready/actions/workflows/test.yml/badge.svg)](https://github.com/Michelle-Vava/pushready/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Check a repository for common mistakes **before** you push it or make it public.

One command, no setup, no config file, no account. It reads the folder on your own machine and tells you, in plain English, what to fix.

```
$ pushready ./my-app

Checking /home/me/my-app

  ! README.md is very short (1 line)
      → Explain what the project does, how to install it and how to use it.
  ✖ No LICENSE file
      → Without a license nobody may legally reuse your code. See https://choosealicense.com
  ! .gitignore does not ignore node_modules or .env
      → Add "node_modules" and ".env" to .gitignore.
  ✖ Secret file(s) committed: .env
      → Run "git rm --cached <file>", add it to .gitignore, and rotate any keys it held. Commit a .env.example instead.
  ✖ node_modules is committed (1 file)
      → Run "git rm -r --cached node_modules" and add node_modules to .gitignore.
  ✖ Deleted, but still in git history: .env.local
      → Anyone can read old commits. Rotate the keys, then remove the file from history (e.g. git filter-repo) before making the repo public.

  0 passed, 2 warnings, 4 failed
```

*This is the real output of `npm run demo` (see [Try it](#try-it)).*

## Why

Committing a `.env` file or `node_modules`, or making a repo public without a license, are some of the most common mistakes on GitHub. They're easy to fix before you push and painful after. Once a secret is in git history, deleting the file doesn't remove it.

How it compares:

- **Secret scanners** (gitleaks, trufflehog, git-secrets) find secrets *inside* files. They don't check whether a repo is ready to share.
- **Repolinter** checked whole repositories, but it needed a config file and was archived in 2026.
- **Repo health reports** (repo-doctor, GitHealthGuard) score a repo after the fact.

pushready focuses on **stopping the mistake before it's pushed**: zero setup, plain-English fixes, and (on the roadmap) a deeper look at what's exposed in git history, a pre-push hook, and `pushready fix` to repair problems for you.

## Background

I built pushready after getting several of my own projects ready to make public in October 2026. One older project had a `.env` file and `node_modules` committed early on. Deleting them wasn't enough, because they were still in the git history, so I had to rewrite the history and force-push. Other repos were missing a LICENSE or still had template README text. Every one of these problems was easy to prevent and slow to fix afterwards.

The tools I found either looked for secrets only, needed configuration, or had been abandoned. I wanted one command that tells me in plain English what to fix **before** I push. I'm working on it because it's a problem I've hit myself, and the same mistakes show up across thousands of GitHub issues from students and solo developers.

**Why the history starts here:** pushready is a new project. The idea, research and first version all came together in October 2026, so this repository holds its full history from the first commit.

## Who it's for

- **Students and new developers** pushing their first projects, who don't yet know what shouldn't go into git.
- **Solo developers** about to make a private repo public, or share it for a job application, portfolio or submission.
- **Teams and maintainers** who want a quick safety net in CI so a `.env` or `node_modules` never gets merged.

## How it helps

- Catches the mistake **before** it's public, when fixing it is one command instead of a history rewrite and key rotation.
- Explains each problem and the exact fix in plain English, so you learn the rule and don't just get a score.
- Needs nothing: no install step, no config, no account, no network. It runs only on your machine and doesn't open your code or secret files (see [What it reads](#what-it-reads)).

## Ways to use it

| Where | How | Status |
|---|---|---|
| On your machine | `npm start -- path/to/project` or `pushready` after `npm link` | ✅ works now |
| In a CI pipeline (GitHub Actions) | see the example below | ✅ works now |
| As a git pre-push hook | `pushready install-hook` blocks a bad push | 🗺️ on the roadmap |
| As an npm package | `npx pushready` | 🗺️ on the roadmap |

**In GitHub Actions**, add this step to any workflow. The step fails if a check fails:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0   # full history, so deleted .env files are found
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npx --yes github:Michelle-Vava/pushready
```

## Try it

Needs Node.js 18 or newer and git. There are no dependencies to install.

```bash
git clone https://github.com/Michelle-Vava/pushready.git
cd pushready

# 1. See it catch problems: builds a throwaway repo full of mistakes and checks it
npm run demo

# 2. Check one of your own projects
npm start -- path/to/your/project
```

To use it as a command anywhere on your machine:

```bash
npm link
pushready path/to/your/project
```

The exit code is `1` if any check fails, so it can be used in scripts and CI.

## What it checks

| Check | Fails when | Warns when |
|---|---|---|
| README | there is none | it has fewer than 5 lines |
| LICENSE | there is none | the license type is not recognised |
| .gitignore | there is none | it doesn't ignore `.env`, or `node_modules` in a Node project |
| Committed secrets | a `.env` / `.env.*` file is tracked (`.env.example` is fine) | |
| Committed dependencies | files under `node_modules` are tracked | |
| Secrets in history | a `.env` file was deleted but is still in an old commit | |

## What it reads

pushready is designed to look at as little as possible:

- **File names and paths** in the folder and in git (`git ls-files`, and the paths added in past commits).
- **Only three files are opened:** README, LICENSE and `.gitignore`, to check that they're filled in.
- **Never opened:** `.env` files, keys, source code or any other file. A committed `.env` is reported by its name only.
- **Never read:** commit authors, emails, messages or dates. pushready only asks git for file paths.
- **Never sent or stored:** it makes no network calls and writes nothing to disk.

A repository can still contain personal data in files pushready doesn't open. pushready can tell you that a risky *file* exists, but it doesn't scan what's inside. For that, use a dedicated secret scanner such as gitleaks.

**If a secret was ever pushed, deleting it isn't enough.** Removing it from git history helps, but anyone who already cloned or cached the repo still has it. Treat the key as compromised: revoke or rotate it first.

## How it's tested

- `npm test` runs 8 tests with Node's built-in test runner. Each test builds a throwaway git repo in your temp folder (clean, missing files, committed `.env`, secrets left in history, and so on) and checks the result.
- GitHub Actions runs the tests, the demo, and pushready on its own repo on **Windows, macOS and Linux** with Node 20 and 24 on every push.

## Roadmap

| Version | Focus |
|---|---|
| ✅ v0.1 | First checks: README, LICENSE, `.gitignore`, committed `.env` / `node_modules`, secrets in history |
| v0.2 | Git-history exposure: what risky files are in history, since when, and whether they were already pushed, plus a rotate-then-clean guide |
| v0.3 | Check framework: every check is a module with an id, severity and fix plan; structured `--json` findings |
| v0.4 | Pre-push git hook that blocks a bad push |
| v0.5 | `pushready fix`: safe, previewed fixes |
| v0.6 | More checks: keys, databases, large files, build output, junk files |
| v1.0 | Custom checks from a local file, npm package, Python and .NET support, GitHub Action |

See [ROADMAP.md](ROADMAP.md) for the details and what "done" means for each.

## License

[MIT](LICENSE)
