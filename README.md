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
      .env — still in the repo, on main, local only
      → Run "git rm --cached <file>", add it to .gitignore, and rotate any keys it held. Commit a .env.example instead.
  ✖ node_modules (1 file) is committed — installed npm packages
      → Run "git rm -r --cached node_modules", add it to .gitignore, and commit your lockfile instead. Files inside are not checked one by one: untrack the folder, then run pushready again.
  ✔ Full git history available
  ✔ No private key files in git history
  ✖ 1 credential file in git history
      .env.local — deleted, on main, local only
      → These names are normally used for logins or API tokens. Deleting the file in a later commit does not remove it — see "What to do next" below.
  ! 1 data file in git history
      dev.sqlite3 — still in the repo, on main, local only
      → These names are normally used for databases, which may hold personal data. See "What to do next" below.

  What to do next
    1. None of these were pushed from this clone, so they probably never left your machine.
       Run "git fetch" if you are not sure, and rotate anything you cannot account for.
    2. Check what dev.sqlite3 holds before you push. Leaked data cannot be rotated.
    3. Remove .env, .env.local, dev.sqlite3 from history yourself — pushready will not do it for you:
       git filter-repo --invert-paths --path ".env" --path ".env.local" --path "dev.sqlite3"
    Docs: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
    Run again with --history for the full guide.

  Ready to make public: no (4 blockers)
  2 passed, 3 warnings, 4 failed
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

Add `--strict` to fail the step on warnings and on anything that could not be checked, or `--json` to read the result from a later step. A shallow checkout (the default `fetch-depth`) is reported as "could not be checked", not as a pass.

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

The demo scenarios are `clean-node`, `clean-python`, `messy-node`, `messy-python`, `deleted-local`, `pushed-history`, `branch-only`, `gitignored-too-late`, `renamed-secret`, `stash-only`, `tag-only`, `unreachable`, `acknowledged`, `broken-config`, `misshaped-config`, `no-commits`, `detached-head`, `shallow` and `large` (600 files over 40 commits — a test of *many* files, not of large ones; there is no size check yet). Each one declares the exit code it should produce, and its full output is recorded under `test/golden/`, so `npm run demo` checks the code and `npm test` checks every line it printed.

To use it as a command anywhere on your machine:

```bash
npm link
pushready path/to/your/project
```

| Option | What it does |
|---|---|
| `--history` | show each risky file as a labelled block — commit, branches, remotes, `.gitignore` status — plus the full exposure guide |
| `--json` | print the findings as one JSON document instead of the report: `{ version, dir, findings, guide, verdict, notRun, exit }`. The shape of a finding is documented in `src/finding.js`. Byte-stable across runs; never changes the exit code |
| `--quiet` | print only what failed, warned or could not be checked. Everything else is still counted in the summary |
| `--strict` | a warning, or a check that could not run, is enough for exit `1` |
| `--only <ids>` | run only these checks (`--only readme,license`, or repeat the flag). `pushready --help` lists the ids |
| `--skip <ids>` | run every check except these. Skipping the check that would report a path hands the path to the next check that saw it, so `--skip env-tracked` does not hide a committed `.env` |
| `-h`, `--help` | show usage, the check ids and the exit-code contract |
| `-v`, `--version` | show the version |

Point it at a folder inside a repository and it checks the whole repository, and says so.

Every run ends with a one-line verdict that agrees with the exit code: `Ready to make public: yes`, or `no (2 blockers) — something was pushed, rotate first`, or `yes, as far as could be checked (4 could not be checked)` when part of the history is missing.

**Exit codes** tell a script how urgent the problem is, so CI can treat a leaked-and-pushed key differently from one that never left the machine:

| Code | Means |
|---|---|
| `0` | nothing to fix, or everything found was acknowledged |
| `1` | problems found, but nothing has been pushed from this clone |
| `2` | problems found, and at least one was already pushed — rotate first |
| `64` | pushready was used wrongly: the path is not a folder or is a bare repository, two paths were given, an option or check id is not one pushready knows, or an option is missing its value |

`--skip` and `--only` leave checks unrun, so those checks cannot affect the code. A check that *could not* run (a shallow clone, a broken `.pushready.json`) never fails the run on its own; `--strict` changes that. `--json` never changes the code.

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

This applies to every check, not only the history ones: a tracked fixture such as `test/fixtures/.env` is acknowledged by its path, and a deliberately vendored `node_modules` by the path `node_modules`.

The file may carry `"version": 1`. Without it, 1 is assumed. A file that names a newer version is applied where understood, with a warning. A file that is not valid JSON, is not an object, or has `"acknowledge"` as anything but a list, is reported with what was expected, and acknowledges nothing. This is the whole of the format: which checks run is decided by flags, not config, so that nothing silenced in a file can surprise someone reading the CI output.

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
| Committed secrets | a `.env` / `.env.*` file is tracked (`.env.example` is fine). Says *staged, not yet committed* when it has never been in a commit, since then there is nothing to rotate or clean. A committed one is shown with where it is and whether it was pushed, exactly like a file in history, and goes into the cleanup command | |
| Committed dependencies | a dependency tree or build output is committed: `node_modules`, a Python virtualenv (`pyvenv.cfg` or `site-packages/`), Composer's `vendor/`, Ruby's `vendor/bundle/`, or .NET `bin/Debug` / `obj`. Detected by marker, not by folder name, so a hand-written `bin/` script or a deliberately vendored Go dependency is left alone | |
| Private keys in history | a name like `id_rsa`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore` or `*.ppk` is anywhere in history | |
| Credential files in history | a name like `.env*`, `credentials.json`, `service-account*.json`, `.netrc`, `kubeconfig`, `.pgpass` or `*.tfstate` is anywhere in history | |
| Database files in history | | a name like `*.sqlite3` or `*.db` is anywhere in history |
| Git history available | | only part of it can be checked: a shallow or single-branch clone, or a submodule |

Files **inside** a committed dependency tree are not matched individually: they are third-party, and a `.pem` in there is almost always a CA bundle or a test fixture. The finding is that the tree was committed, and untracking it removes them all. CA bundles (`cacert.pem`, `ca-bundle.crt`, Java's `cacerts`) are never flagged, wherever they live — they are lists of public certificates.

Matching is case-insensitive, so a `.ENV` is caught as well as a `.env` — it is the same file on Windows and macOS. Java keystores (`*.jks`, `*.keystore`) and PuTTY keys (`*.ppk`) hold private keys even though the extension doesn't say so. Terraform state is treated as a credential rather than data because it routinely records provider credentials and generated passwords in plain text, and those can be rotated.

The three history checks match on **file names only**, because pushready never opens these files. A match means "this name is normally used for a private key", not "this file definitely holds a secret" — it's a prompt to go and check. Names that are public by convention (`*.pub`, `*.crt`, `*.cer`, `Thumbs.db`) and templates like `.env.example` are not flagged.

Database files warn rather than fail: unlike a key, leaked data can't be rotated, so it needs your judgement rather than a standard fix.

**Renaming doesn't hide a file.** Every name a file was ever committed under is checked, so a `config.json` later renamed to `credentials.json` is found, and so is an `id_rsa` renamed to something harmless-looking. Both names are in history, and either one is enough.

The cleanup command names **all** of them. A file renamed from `deploy/id_rsa` to `deploy/key.backup` sits in history under both names, so removing only the risky-looking one leaves the exact same content behind under the other — a cleanup that appears to work and doesn't. Exposure follows the content too: if it was pushed under an earlier name, it counts as pushed, even if the rename itself never left your machine.

**Where a file lives decides the advice.** On a branch or a tag it is history, and the guide gives a `git filter-repo` command. But a file that only ever went into a stash, or is held only by a leftover ref such as `git filter-branch`'s `refs/original/`, or sits on a detached HEAD, is *not* history — telling you to rewrite history for a stash would be the wrong tool. pushready says what is holding it and gives the matching command instead: `git stash drop stash@{1}`, `git update-ref -d`, or checking out a branch. Every stash is checked, not only the newest one. A file that is only on a tag gets the rewrite advice, with one honest caveat: your clone keeps no record of which tags were pushed, so if you have ever run `git push --tags`, treat it as pushed.

**A commit nothing points at is still checked.** Amending a secret away, deleting the branch you committed it on, or dropping a stash does not delete the commit — git keeps the object until it collects garbage, and `git fsck` or `git reflog` can still reach it. pushready searches those commits too (via `--reflog` and `git fsck --unreachable`) and reports them as *in a commit nothing points at any more*. There is no history to rewrite in that case, so the fix is `git reflog expire --expire-unreachable=now --all && git gc --prune=now`.

The history checks need the full history. If the clone is shallow (`git clone --depth`, or `actions/checkout` without `fetch-depth: 0`) or covers only one branch (`--single-branch`), the other commits aren't on your machine. The same goes for a **submodule**, which is a separate repository that `git ls-files` and `git log` both stop at, so files inside it are never seen. pushready says so in one line and reports the history checks as **could not be checked** rather than passing them — a clean result you can't trust is worse than no result. What it cannot tell you either way: a commit that git has *already* collected is gone from this clone, so finding nothing is never proof that nothing was ever there.

## What it reads

pushready is designed to look at as little as possible:

- **File names and paths** in the folder and in git (`git ls-files`, and the paths added in past commits).
- **Commit hashes and branch names**, to say which commit and which branches a file is in. A commit is only ever identified by its hash.
- **Ordinary project files, only when a check needs them.** Today that is README, LICENSE and `.gitignore`, to check they're filled in, and `.pushready.json` for findings you have acknowledged. Project metadata such as `package.json` may be opened by a check that needs it.
- **Never opened:** `.env` files, keys, databases, source code, or anything else that could hold a secret or personal data. A risky file is always reported by its name alone.
- **Enforced, not just intended.** The list above is an allowlist in `src/snapshot.js`, and a check that asks for anything else gets an error rather than the file. See [How it's tested](#how-its-tested).
- **One delegated exception, for renames.** To work out which names share one file's content, pushready asks git for its rename list. Git pairs those names by comparing the files itself, and returns only the names and a similarity score — no content reaches pushready, and nothing is stored or sent. This runs only when a risky file was already found, and it is what makes the cleanup command name every copy.
- **Never read:** commit authors, emails, messages or dates.
- **Never sent or stored:** it makes no network calls and writes nothing to disk.

A repository can still contain personal data in files pushready doesn't open. pushready can tell you that a risky *file* exists, but it doesn't scan what's inside. For that, use a dedicated secret scanner such as gitleaks.

**If a secret was ever pushed, deleting it isn't enough.** Removing it from git history helps, but anyone who already cloned or cached the repo still has it. Treat the key as compromised: revoke or rotate it first.

## Code layout

One run, end to end. Each stage hands the next one a single, named thing:

```
  pushready ./my-app --json
        │
        ▼
  ┌──────────────┐  parse flags, resolve the path. A folder inside a repo
  │   cli.js     │  means the repo. Nothing here knows what a check is.
  └──────┬───────┘
         ▼
  ┌──────────────┐  ONE lazy, read-only view of the repository, shared by
  │ snapshot.js  │  every check. Nothing is read until a check asks, and a
  └──────┬───────┘  check can only reach the fields it declared.
         │              ├── git.js       the only place git is run
         │              ├── history.js   where a path lives, was it pushed
         │              ├── patterns.js  which names are risky
         ▼              └── acknowledge.js  reads .pushready.json
  ┌──────────────┐  9 checks. Each declares id, title, severity, what it
  │  checks.js   │  reads, and when it applies. --only / --skip pick from here.
  └──────┬───────┘
         ▼
  ┌──────────────┐  What no single check can decide: report each path once,
  │  policy.js   │  and apply .pushready.json to all of them.
  └──────┬───────┘
         ▼
  ┌──────────────┐  { id, title, severity, status, message, fix, items[] }
  │ finding.js   │  The one shape. Every result has it, placeholders included.
  └──────┬───────┘
         ├───────────────────────────┐
         ▼                           ▼
  ┌──────────────┐           ┌──────────────┐  8 rules → steps of actions:
  │ verdict.js   │           │  guide.js    │  { kind: 'run', text, command }
  │ exit code +  │           │ what to do   │  Pure: it never touches git or
  │ the verdict  │           │ next, in     │  the disk, which is why it can
  │ line         │           │ order        │  describe a command safely.
  └──────┬───────┘           └──────┬───────┘
         └─────────────┬────────────┘
                       ▼
            text report  │  --json
            (cli.js renders both from the same findings)
```

**Why it is shaped like this.** Three rules fall out of the diagram, and each
one closes a bug that actually happened:

- **Only `snapshot.js` reads anything.** A check gets the snapshot and nothing
  else, so "pushready never opens your `.env`" is enforced in one file instead
  of promised by each check. It is also why the whole run costs the same on a
  2,000-file repo as on a 10-file one: one history walk, shared.
- **Cross-check decisions live in `policy.js`, not inside a check.** When
  suppressing a duplicate lived inside the snapshot, a pushed `.env` that was
  still tracked was reported with *less* detail than one that had been deleted.
  A pass over the findings can merge them instead of dropping one.
- **`verdict.js` decides the exit code once.** The text report and `--json`
  cannot disagree about whether a repo is ready, because neither computes it.

| File | Job |
|---|---|
| `src/index.js` | What the CLI and the tests import. Everything else is internal. |
| `src/cli.js` | Parse arguments, print the report, choose the exit code. No checking logic. |
| `src/checks.js` | The checks and the order they run in. Each has an id, a title, a severity, the snapshot fields it reads, and when it applies. `--only` / `--skip` select from here. |
| `src/finding.js` | The one shape every result has, documented and built in one place. What `--json` prints. |
| `src/policy.js` | What applies across checks after they run: each path is reported once, and `.pushready.json` is applied everywhere. |
| `src/verdict.js` | The exit code and the verdict line, decided once for the text report and `--json` alike. |
| `src/snapshot.js` | A lazy, shared, read-only view of one repository. Decides what a check may look at. |
| `src/patterns.js` | Which file names count as risky, and which folders are committed dependency trees. Pure data and matching, no I/O. |
| `src/git.js` | The only place git is run. Everything else asks for paths and hashes. |
| `src/history.js` | Where a path lives in git: first commit, what holds it, whether it was pushed, other names it had. |
| `src/guide.js` | The "What to do next" steps: 8 rules, each deciding whether it applies and building its actions. Touches neither git nor the filesystem. |
| `src/acknowledge.js` | Reads `.pushready.json`. |
| `src/text.js` | Shared wording helpers. |

## How it's tested

- `npm test` runs 232 tests with Node's built-in test runner, across eleven files: the checks themselves, the command line, repository states, unusual git states (detached HEAD, orphan branch, mid-merge, mid-rebase, linked worktree, packed refs), `.pushready.json`, non-JavaScript projects, the flags and the exit-code contract, the remediation guide, portability, and cost. Each test builds a throwaway git repo in your temp folder (clean, missing files, committed `.env`, risky files left in history, renamed in or out of a risky name, renamed through a chain of names, never pushed, pushed then deleted, on one branch only, only in a stash, only on a tag, held by a leftover ref, amended away, on a deleted branch, in a dropped stash, a shallow clone, no commits at all, and so on) and checks the result. Pushing is tested against a local bare repo, so the tests stay offline.
- **The demo scenarios assert their whole output, not just their exit code.** Each one's full report, plain, `--history` and `--json`, is recorded under `test/golden/` and compared on every run, so a change in wording or guidance shows up as a reviewable diff. `npm run golden` re-records them. This exists because a scenario once spent three releases not demonstrating what its title claimed while every exit-code assertion still passed.
- **Cost is asserted in git processes, not seconds**, because a loaded CI runner makes wall-clock flaky. The tests pin that a bigger repository costs no more processes than a small one, and that each risky path adds at most two.
- **The privacy boundary is tested, not just documented.** Every check declares which parts of the repository snapshot it reads, and a test fails the build if a check touches anything else. The snapshot also refuses outright to open any file beyond README, LICENSE, `.gitignore`, `package.json` and `.pushready.json` — so "pushready never opens your `.env`" is enforced in one place rather than promised by each check.
- GitHub Actions runs the tests, the demo, pushready on its own repo, and a check that the recorded scenario output is identical on that machine — on **Windows, macOS and Linux**, with **Node 18, 20, 22 and 24**, on every push. `package.json` says `engines: >=18`, so 18 is in the matrix: claiming a version nothing runs on is how a release breaks for someone else.
- **Portability is tested, not assumed.** The suite has been run under Windows Node 24 and Git for Windows as well as Linux, and the three differences that showed up are fixed and guarded against. `test/portability.test.js` checks the behaviour that only breaks elsewhere — a repository under a path with spaces and accents, CRLF `.gitignore` and README files, findings always using forward slashes — and scans pushready's own source for the habits that caused real breakages: building a path with `+ '/'`, turning a path into a URL by hand, hardcoding `/tmp`, or asserting on a message Node words differently between versions.

## Roadmap

| Version | Focus |
|---|---|
| ✅ v0.1 | First checks: README, LICENSE, `.gitignore`, committed `.env` / `node_modules`, secrets in history |
| ✅ v0.2 | Git-history exposure: what risky files are in history, which commits and branches hold them, and whether they were already pushed, plus a rotate-then-clean guide |
| ✅ v0.3 | Check framework, in six point releases: a shared, lazy repository snapshot that enforces what a check may read; severity and a cross-check policy pass; one documented finding shape; `--only` / `--skip`, `--json`, `--quiet`, `--strict` and a verdict line; and the remediation guide as rules returning actions rather than strings. See [ROADMAP.md](ROADMAP.md) |
| v0.4 | Pre-push git hook that blocks a bad push |
| v0.5 | `pushready fix`: safe, previewed fixes |
| v0.6 | More checks: large files (scoped in detail in [ROADMAP.md](ROADMAP.md), including why it needs no file contents), build output, junk files, template README text, `package.json` basics |
| v1.0 | Custom checks from a local file, npm package, Python and .NET support, GitHub Action |

See [ROADMAP.md](ROADMAP.md) for the details and what "done" means for each.

## License

[MIT](LICENSE)
