# Roadmap

pushready is a **local, zero-setup checker** for the mistakes people make before pushing or open-sourcing a repo. It works from file names and git paths on your own machine: no accounts, no uploads, no network calls.

**Where it's going:** from "a report you run by hand" to a small **checking framework**. Checks are registered modules with a severity and a fix plan, and the framework runs them on your machine, as a git hook, or in CI, producing structured findings and safe fix plans.

## Principles

Every feature has to keep these true:

1. **Zero setup.** It works with no config, no install step beyond Node, and no account.
2. **Look at as little as possible.** Work from file names, git paths, commit hashes and ref names. Never open `.env` files, keys, databases or source code, never read commit authors, emails, messages or dates, never make network calls, never store or send anything. Only ordinary project files are ever opened, and only when a check needs them: today README, LICENSE and `.gitignore`, plus project metadata such as `package.json`.
3. **Plain English.** Every finding says what it means and the exact fix.
4. **Safe by default.** Nothing changes on disk or in git without showing the change and asking first.
5. **Honest about limits.** Say clearly what a check can't guarantee (for example, that cleaning history doesn't un-leak a key).
6. **No dependencies** unless one saves a lot of work and is well maintained.

---

## ✅ v0.1: First checks (done)

- [x] CLI: `pushready [path]`, `--help`, `--version`, exit code 1 on failure
- [x] README present and not a stub
- [x] LICENSE present, with the type detected (MIT, Apache-2.0, GPL, ISC, BSD)
- [x] `.gitignore` present and covering `.env` / `node_modules`
- [x] Committed `.env` files (templates like `.env.example` are allowed)
- [x] Committed `node_modules`
- [x] `.env` files deleted but still in git history, reported as *unknown* rather than passing when the clone is shallow
- [x] Tests that build throwaway git repos for each case
- [x] `npm run demo`: builds a repo full of mistakes and checks it
- [x] CI on Windows, macOS and Linux (Node 20 and 24)

---

## ✅ v0.2: Git-history exposure (done)

**Goal:** show exactly what risky files are in history and how exposed they are.
**Why:** this is pushready's strongest difference. Deleting a file doesn't remove it from history, and most people don't know which of their old commits leak what.

- [x] Find risky files anywhere in history, not just `.env`, grouped into three categories with a check each, all run by default:
  - `history-keys` (fail): `id_rsa` / `id_dsa` / `id_ecdsa` / `id_ed25519`, `*.pem`, `*.key`, `*.p12`, `*.pfx`
  - `history-credentials` (fail): `.env*`, `credentials.json`, `service-account*.json`, `.netrc`
  - `history-data` (warn): `*.sqlite`, `*.sqlite3`, `*.db`
  - **Rule for adding a pattern:** a name commonly used for secrets or personal data is flagged even though pushready can't confirm what's inside. Findings are worded as a prompt to check, never as proof of a leak. Names that are public by convention (`*.pub`, `*.crt`, `*.cer`, `Thumbs.db`) are excluded.
- [x] For each one, one short line: the branch, whether it's still in the repo, and how exposed it is. Commit hashes and full branch lists are kept behind `--history` so the default output stays readable (from paths, hashes and refs only — never file contents, and never commit dates or authors, per principle 2)
- [x] **Already pushed?** Checked from remote-tracking branches using local git data only, and reported as one of three states, because they need different advice:
  - `pushed` — the commit is on a remote-tracking branch; rotate first
  - `local only` — the repo has no remote at all; the strongest safe claim
  - `not on a remote` — remotes exist but don't have it. Hedged, because remote-tracking refs are only as fresh as the last `git fetch`, so the fix text says to fetch if unsure
- [x] **Exposure guide**, printed once after the findings, with the steps built from what was actually found:
  1. If it was pushed, **revoke or rotate the credential first**. Cleaning history doesn't un-leak it from clones, forks or caches. If nothing was pushed, it says so instead of asking for a rotation that isn't needed.
  2. A separate step for data files, which can't be rotated.
  3. Remove it from history with `git filter-repo`, with the exact command for the files found. Paths are double-quoted (the same in bash, `cmd` and PowerShell); paths that can't be quoted safely, or more than eight of them, fall back to `--paths-from-file`.
  4. Force-push and ask collaborators to re-clone — only shown when something was actually pushed. `--history` adds the GitHub Support step for cached pull request refs.
- [x] Never offer an automatic history rewrite; the user runs those commands. Stated in `--help` and in the guide itself.

Added during v0.2, beyond the original list:

- [x] **`.gitignore` is explained against history.** When a risky file in history is already listed in `.gitignore`, say plainly that this neither untracks it nor removes it from history, and give the `git rm --cached` command when it's still tracked. This is the most common wrong fix.
- [x] **One clear warning when the history can't be fully checked.** Shallow clones *and* single-branch clones, reported once with the command that fixes each, instead of a repeated message under every category.
- [x] **Acknowledged findings.** `.pushready.json` in the repo accepts findings you've already judged. They stay in the output marked *acknowledged* with the reason, drop out of the guide, and stop failing the run. Acknowledging one path never excuses another. (This brings a slice of v1.0's config forward: the need arrived as soon as checks got broad enough to hit test fixtures.)
- [x] **Exit codes by exposure:** `0` clean or all acknowledged, `1` problems but nothing pushed, `2` something was pushed, `64` wrong usage. CI can tell an emergency from a two-minute fix.

**Done when:** test repos cover "committed but never pushed", "pushed then deleted" and "on one branch only", each giving the right advice. ✅ All three covered, plus a shallow clone, a single-branch clone, a `.gitignore`-too-late repo and an acknowledged fixture.

---

## v0.3: Check framework and structured findings

**Goal:** turn the built-in checks into a small framework that other features (and later, other people) build on.
**Why:** the hook, `fix`, JSON output and custom checks all need the same shape for a check and a finding.

- [ ] **Check registration:** each check is a module with `id`, `title`, `severity` (`blocker` / `warning` / `info`), `appliesTo(repo)` and `run(repo)`
- [ ] **Shared repo snapshot:** tracked paths, history paths and refs are collected once and passed to every check, so checks stay fast and can't touch anything else
- [ ] **Structured findings:** every check returns the same shape: rule `id`, `severity`, `message` (what's wrong and why it matters), `fix` (suggested next step) and the file paths involved
- [ ] **Declared privacy boundary:** each check declares what it inspects (file names, git paths, or one of the three allowed files), and a test fails if a check reads anything else, so the "What it reads" section in the README stays true as checks are added
- [ ] **Finding classification:** results grouped into "Fix before making public" (blockers) and "Good practice", with a one-line verdict: `Ready to make public: no (2 blockers)`
- [ ] **Fix plans:** a check can return a list of proposed actions as data, with nothing run yet (used by `fix` in v0.5)
- [ ] `--json` output with a documented, versioned schema; `--quiet`, `--strict`, `--only` / `--skip <check>`

**Done when:** all v0.1 and v0.2 checks run through the framework, and the JSON schema is documented and tested.

---

## v0.4: Pre-push hook

**Goal:** catch the mistake at the moment it would leave your machine.
**Why:** a report is easy to forget to run; a hook isn't.

- [ ] `pushready install-hook` / `uninstall-hook`, working alongside existing hooks and Husky
- [ ] Only check the commits being pushed, so it stays quick on big repos
- [ ] A clear message when a push is blocked, including how to bypass it once on purpose (`git push --no-verify`)
- [ ] Document the limits: a hook only protects clones where it's installed, can be bypassed, and doesn't help once something is already pushed

**Done when:** in a test, a repo with a committed `.env` cannot be pushed to a local remote while the hook is installed.

---

## v0.5: `pushready fix`

**Goal:** apply the low-risk fixes for you, safely.
**Why:** knowing what is wrong isn't enough for beginners.

- [ ] Shows every planned change and asks before doing it; `--dry-run` previews only
- [ ] Create or extend `.gitignore` from a template for the detected stack (Node, Python, .NET)
- [ ] Untrack committed `node_modules` and build output (`git rm --cached`) without deleting local files
- [ ] Untrack a committed `.env`, **with a warning** that this doesn't remove it from history, linking to the v0.2 exposure guide
- [ ] Add a LICENSE by choosing from MIT / Apache-2.0 / GPL-3.0
- [ ] Offer a `.env.example` built from the variable **names** the code references (e.g. `process.env.API_URL`), never from the real `.env`

**Done when:** running `pushready fix` on the demo repo and accepting every change leaves only the history finding, with the guide shown.

---

## v0.6: More checks

**Goal:** cover the remaining common clutter. Lower priority, because these are easy and well covered elsewhere.

- [ ] Large files over 5 MB (GitHub warns at 50 MB and blocks at 100 MB)
- [ ] Build output: `dist/`, `build/`, `.next/`, `out/`, `coverage/`, `bin/`, `obj/`
- [ ] OS and editor junk: `.DS_Store`, `Thumbs.db`, `.vs/`, `.idea/`, `*.swp`
- [ ] Template README text left behind (e.g. "TODO: Give a short introduction")
- [ ] `package.json` basics: `license` matches the LICENSE file, `repository` set, lockfile present

---

## v1.0: Open it up

- [ ] **Custom checks:** load project-specific checks from a local file (e.g. `.pushready.js`) using the v0.3 check interface, with the same rules: paths in, findings out
- [ ] Optional config (`.pushready.json`) to turn checks off, change severity, or ignore paths
- [ ] Publish to npm so `npx pushready` works
- [ ] Python and .NET projects: `venv/`, `__pycache__/`, `*.pyc`, `bin/` / `obj/`
- [ ] A `docs/` page per check: what it means, why it matters, how to fix it
- [ ] Semantic versioning and a CHANGELOG

## Later

- GitHub Action with a job summary. This is last because it runs on someone else's CI servers instead of locally; the `npx` step in the README already covers basic CI use.
- Shareable check packs (e.g. "open-source release", "student project")
- VS Code extension that shows findings in the editor
- Batch mode: check every repo in a folder at once

## Out of scope

- **Scanning inside files for secrets or personal data:** gitleaks and trufflehog already do this well, so pushready points to them instead.
- **Reading commit authors, emails or messages.**
- **Anything that needs an account, token or network access.**
- **Collecting, storing or sending any data.**
- **Rewriting git history automatically:** pushready explains how, and the user runs it.
