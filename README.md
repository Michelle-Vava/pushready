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
  ✔ No private key files in git history
  ✖ 1 credential file in git history
      .env.local — deleted, on main, local only
      → These names are normally used for logins or API tokens. Rotate anything that was real, then remove the file from history (e.g. git filter-repo) — deleting it in a later commit does not remove it.
  ! 1 data file in git history
      dev.sqlite3 — still in the repo, on main, local only
      → These names are normally used for databases, which may hold personal data. Check what is in it: unlike a key, leaked data cannot be rotated, so you may need to tell the people affected.

  1 passed, 3 warnings, 4 failed
```

*This is the real output of `npm run demo -- messy-node` (see [Try it](#try-it)).*

Each risky file gets one short line: **where it is, whether it's still there, and how exposed it is** — `local only`, `not on a remote`, or `pushed`. "Pushed" is the one that changes what you should do first.

When something is found in history, pushready prints a short **What to do next** guide built from what it actually found — it only asks you to rotate a credential if it was really pushed, and only mentions force-pushing if there's a remote to force-push to:

```
  What to do next
    1. Rotate or revoke these now: service-account-prod.json.
       They were pushed, so cleaning history will not un-leak them from clones, forks or caches.
    2. Remove them from history yourself — pushready will not do it for you:
       git filter-repo --invert-paths --path "service-account-prod.json"
    3. Force-push the rewritten history, and ask every collaborator to re-clone.
    Docs: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
    Run again with --history for the full guide.
```

**pushready never runs any of this.** It doesn't edit files, delete anything or rewrite history — the commands are printed for you to run. `--history` adds commit hashes, every branch involved, how to install `git filter-repo`, and the GitHub Support step for cached pull request refs.

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
- **Solo developers** about to make a private repo public, or share it for a job application or portfolio.
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

# 1. See it catch problems: builds throwaway repos covering different project
#    types and git situations, and checks each one
npm run demo

# 2. Just one of them, with the detailed history output
npm run demo -- pushed-history --history

# 3. Check one of your own projects
npm start -- path/to/your/project
```

The demo scenarios are `clean-node`, `clean-python`, `messy-node`, `messy-python`, `deleted-local`, `pushed-history`, `branch-only`, `gitignored-too-late`, `acknowledged`, `shallow` and `large` (600 files over 40 commits). Each one declares the exit code it should produce, so `npm run demo` also checks they still behave as described.

To use it as a command anywhere on your machine:

```bash
npm link
pushready path/to/your/project
```

| Option | What it does |
|---|---|
| `--history` | show each risky file as a labelled block — commit, branches, remotes, `.gitignore` status — plus the full exposure guide |
| `-h`, `--help` | show usage |
| `-v`, `--version` | show the version |

**Exit codes** tell a script how urgent the problem is, so CI can treat a leaked-and-pushed key differently from one that never left the machine:

| Code | Means |
|---|---|
| `0` | nothing to fix, or everything found was acknowledged |
| `1` | problems found, but nothing has been pushed from this clone |
| `2` | problems found, and at least one was already pushed — rotate first |
| `64` | pushready was used wrongly (for example, the path is not a folder) |

## Acknowledging a finding

Some findings are fine once you've looked at them — a test fixture named `dummy.pem`, say. Put a `.pushready.json` in the repo to accept them:

```json
{
  "acknowledge": [
    { "path": "test/fixtures/dummy.pem", "reason": "fixture for the TLS tests, never a real key" }
  ]
}
```

Acknowledged findings **stay in the output**, marked `acknowledged` with your reason, and drop out of the "What to do next" guide. They no longer fail the run. Nothing is hidden: the point is to record that you decided, not to make the finding disappear. Acknowledging one path doesn't excuse any other.

## .gitignore and files git already has

Adding a file to `.gitignore` is the most common wrong fix, because it doesn't undo anything git has already recorded:

- it does **not** untrack a file git is already tracking — `git rm --cached` does that
- it does **not** remove anything from history

pushready spots this. When a risky file in your history is already listed in `.gitignore`, it says so and gives you the untracking command alongside the history rewrite.

## What it checks

| Check | Fails when | Warns when |
|---|---|---|
| README | there is none | it has fewer than 5 lines |
| LICENSE | there is none | the license type is not recognised |
| .gitignore | there is none | it doesn't ignore `.env`, or `node_modules` in a Node project |
| Committed secrets | a `.env` / `.env.*` file is tracked (`.env.example` is fine) | |
| Committed dependencies | files under `node_modules` are tracked | |
| Private keys in history | a name like `id_rsa`, `*.pem`, `*.key`, `*.p12` or `*.pfx` is anywhere in history | |
| Credential files in history | a name like `.env*`, `credentials.json`, `service-account*.json` or `.netrc` is anywhere in history | |
| Database files in history | | a name like `*.sqlite3` or `*.db` is anywhere in history |

| Git history available | | only part of the history can be checked (shallow or single-branch clone) |

The three history checks match on **file names only**, because pushready never opens these files. A match means "this name is normally used for a private key", not "this file definitely holds a secret" — it's a prompt to go and check. Names that are public by convention (`*.pub`, `*.crt`, `*.cer`, `Thumbs.db`) and templates like `.env.example` are not flagged.

Database files warn rather than fail: unlike a key, leaked data can't be rotated, so it needs your judgement rather than a standard fix.

The history checks need the full history. If the clone is shallow (`git clone --depth`, or `actions/checkout` without `fetch-depth: 0`) or covers only one branch (`--single-branch`), the other commits aren't on your machine. pushready says so in one line and reports the history checks as **could not be checked** rather than passing them — a clean result you can't trust is worse than no result.

## What it reads

pushready is designed to look at as little as possible:

- **File names and paths** in the folder and in git (`git ls-files`, and the paths added in past commits).
- **Commit hashes and branch names**, to say which commit and which branches a file is in. A commit is only ever identified by its hash.
- **Ordinary project files, only when a check needs them.** Today that is README, LICENSE and `.gitignore`, to check they're filled in, and `.pushready.json` for findings you have acknowledged. Project metadata such as `package.json` may be opened by a check that needs it.
- **Never opened:** `.env` files, keys, databases, source code, or anything else that could hold a secret or personal data. A risky file is always reported by its name alone.
- **Never read:** commit authors, emails, messages or dates.
- **Never sent or stored:** it makes no network calls and writes nothing to disk.

A repository can still contain personal data in files pushready doesn't open. pushready can tell you that a risky *file* exists, but it doesn't scan what's inside. For that, use a dedicated secret scanner such as gitleaks.

**If a secret was ever pushed, deleting it isn't enough.** Removing it from git history helps, but anyone who already cloned or cached the repo still has it. Treat the key as compromised: revoke or rotate it first.

## How it's tested

- `npm test` runs 28 tests with Node's built-in test runner. Each test builds a throwaway git repo in your temp folder (clean, missing files, committed `.env`, risky files left in history, never pushed, pushed then deleted, on one branch only, a shallow clone, and so on) and checks the result. Pushing is tested against a local bare repo, so the tests stay offline.
- GitHub Actions runs the tests, the demo, and pushready on its own repo on **Windows, macOS and Linux** with Node 20 and 24 on every push.

## Roadmap

| Version | Focus |
|---|---|
| ✅ v0.1 | First checks: README, LICENSE, `.gitignore`, committed `.env` / `node_modules`, secrets in history |
| ✅ v0.2 | Git-history exposure: what risky files are in history, which commits and branches hold them, and whether they were already pushed, plus a rotate-then-clean guide |
| v0.3 | Check framework: every check is a module with an id, severity and fix plan; structured `--json` findings |
| v0.4 | Pre-push git hook that blocks a bad push |
| v0.5 | `pushready fix`: safe, previewed fixes |
| v0.6 | More checks: large files, build output, junk files, template README text, `package.json` basics |
| v1.0 | Custom checks from a local file, npm package, Python and .NET support, GitHub Action |

See [ROADMAP.md](ROADMAP.md) for the details and what "done" means for each.

## License

[MIT](LICENSE)
