# Roadmap

pushready is a **local, zero-setup checker** for the mistakes people make before pushing or open-sourcing a repo. It works from file names and git paths on your own machine: no accounts, no uploads, no network calls.

**Where it's going:** from "a report you run by hand" to a small **checking framework**. Checks are registered modules with a severity and a fix plan, and the framework runs them on your machine, as a git hook, or in CI, producing structured findings and safe fix plans.

## Principles

Every feature has to keep these true:

1. **Zero setup.** It works with no config, no install step beyond Node, and no account.
2. **Look at as little as possible.** Work from file names and git paths. Never open `.env` files, keys or source code, never read commit authors or emails, never make network calls, never store or send anything. The only files opened are README, LICENSE and `.gitignore`.
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
- [x] `.env` files deleted but still in git history
- [x] Tests that build throwaway git repos for each case
- [x] `npm run demo`: builds a repo full of mistakes and checks it
- [x] CI on Windows, macOS and Linux (Node 20 and 24)

---

## v0.2: Git-history exposure

**Goal:** show exactly what risky files are in history and how exposed they are.
**Why:** this is pushready's strongest difference. Deleting a file doesn't remove it from history, and most people don't know which of their old commits leak what.

- [ ] Find risky files anywhere in history, not just `.env`: `*.pem`, `*.key`, `id_rsa`, `*.p12`, `credentials.json`, `service-account*.json`, `*.sqlite3` / `*.db`
- [ ] For each one: the commit and date it was added, whether it's still in the latest commit, and which branches still contain it (all from paths and refs, never file contents)
- [ ] **Already pushed?** Check whether those commits are on a remote-tracking branch (`origin/...`), using local git data only. "Only on your machine" and "already pushed" need very different advice.
- [ ] **Exposure guide**, in this order:
  1. If it was pushed, **revoke or rotate the credential first**. Cleaning history doesn't un-leak it from clones, forks or caches.
  2. Remove it from history with `git filter-repo`, with the exact command for the files found.
  3. Force-push, ask collaborators to re-clone, and (on GitHub) contact support to purge cached pull request refs.
- [ ] Never offer an automatic history rewrite; the user runs those commands.

**Done when:** test repos cover "committed but never pushed", "pushed then deleted" and "on one branch only", each giving the right advice.

---

## v0.3: Check framework and structured findings

**Goal:** turn the built-in checks into a small framework that other features (and later, other people) build on.
**Why:** the hook, `fix`, JSON output and custom checks all need the same shape for a check and a finding.

- [ ] **Check registration:** each check is a module with `id`, `title`, `severity` (`blocker` / `warning` / `info`), `appliesTo(repo)` and `run(repo)`
- [ ] **Shared repo snapshot:** tracked paths, history paths and refs are collected once and passed to every check, so checks stay fast and can't touch anything else
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
