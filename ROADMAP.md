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
  - `history-keys` (fail): `id_rsa` / `id_dsa` / `id_ecdsa` / `id_ed25519`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.ppk`
  - `history-credentials` (fail): `.env*`, `credentials.json`, `service-account*.json`, `.netrc`, `kubeconfig`, `.pgpass`, `*.tfstate`
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
- [x] **Renames are followed, in detection and in the fix.** Every name a file was ever committed under is checked, and the `git filter-repo` command names all of them — removing only the risky-looking name leaves the same content in history under the others. Exposure is judged on the content too, so a file pushed under an earlier name counts as pushed.
- [x] **The advice matches where the file actually is.** A branch or tag is history and gets the `filter-repo` command. A stash (every stash, not only the newest), a leftover ref like `refs/original/`, or a detached HEAD is not, and gets `git stash drop` / `git update-ref -d` / "check out a branch" instead — never a history rewrite for something that isn't history. A file only on a tag carries a warning that this clone cannot tell whether tags were pushed.
- [x] **Commits nothing points at are searched too.** A secret amended away, committed on a branch that was later deleted, or put in a stash that was then dropped is still on disk and still recoverable. Found via `--reflog` and `git fsck --unreachable`, and given the matching fix (`git reflog expire` + `git gc`) rather than a history rewrite.
- [x] **Anything that cannot be checked is declared**, never silently passed: shallow and single-branch clones, submodules (a separate repository the checks cannot see into), and a failed unreachable-commit search.
- [x] **Name matching is case-insensitive throughout**, so `.ENV` is caught as well as `.env`, and the pattern lists cover `*.jks`, `*.keystore`, `*.ppk`, `kubeconfig`, `.pgpass` and `*.tfstate`.
- [x] **Exit codes by exposure:** `0` clean or all acknowledged, `1` problems but nothing pushed, `2` something was pushed, `64` wrong usage. CI can tell an emergency from a two-minute fix.

**Done when:** test repos cover "committed but never pushed", "pushed then deleted" and "on one branch only", each giving the right advice. ✅ All three covered, plus a shallow clone, a single-branch clone, a `.gitignore`-too-late repo and an acknowledged fixture.

---

## v0.3: Check framework and structured findings

**Goal:** turn the built-in checks into a small framework that other features (and later, other people) build on.
**Why:** the hook, `fix`, JSON output and custom checks all need the same shape for a check and a finding.

*Rewritten 29 Oct 2026.* The original plan was written before v0.2's three fix rounds, and two things they proved change the shape: **remediation is cross-cutting** (the guide merges findings from several checks into one ordered set of steps and one `filter-repo` command, and branches on where a *finding* lives, not which check made it), and **checks are not independent** (`env-tracked` deliberately suppresses what `history-credentials` would otherwise repeat, and acknowledgement applies across all of them). A per-check `fix` string cannot express the first; putting suppression inside a check breaks the second the moment `--skip` exists. So: findings and fix plans are separate layers, and suppression and acknowledgement are policy applied over findings, not inputs to them.

*Re-planned 30 Oct 2026* as point releases, each with its own completion criteria. v0.3.0 is cut at the two stages that changed no behaviour. **v0.3.1 fixes what a review of v0.3.0 found before anything new is built on it.** Every `TODO(v0.3.x)` comment in `src/` is tied to one of the releases below.

### ✅ v0.3.0 — module split and shared snapshot (30 Oct 2026)

- [x] **Module split, no behaviour change.** `checks.js` (772 lines) split into `patterns.js`, `git.js`, `history.js`, `acknowledge.js`, `guide.js`, `text.js` and a `checks.js` of checks and `runChecks`.
- [x] **Shared lazy snapshot.** Checks receive a memoised, read-only view of the repository instead of `dir`, and declare in `reads` which fields they use. Nothing is read until asked: file-only checks spawn no git process, and the three history checks share one walk (16 processes instead of 30). `index.js` is the public surface.
- [x] **Privacy boundary enforced, not declared.** A test fences every check to its `reads` list and fails on an undeclared read. The snapshot refuses to open any file outside README, LICENSE, `.gitignore`, `package.json` and `.pushready.json`.

**Done when — met:** 52 tests pass; 15 scenarios exit as declared; the CLI's output before and after each stage was compared on every scenario, `--history` and plain (32 and 34 comparisons, 0 differences); removing a field from a check's `reads` fails the suite; `snapshot.readFile('.env')` throws.

### v0.3.1 — close the gaps found in v0.3.0 (no new features)

A review of the shipped code, looking for what is *wrong* rather than what is *missing*. Nothing here adds a flag, a check or an output format. Each item gets a test that fails before the fix.

- [ ] **Severity and status are one field, and should be two.** `RISKY_CATEGORIES[].status` is `'fail'` / `'warn'` — a *severity* (fixed per check) named and used as a *status* (what happened this run). Rename to `severity`; results carry both. Without this there is no way to say "a blocker that passed" or "a blocker that was acknowledged", which `--strict`, `--json` and the verdict all need.
- [ ] **A policy pass over results**, after the checks and before the report. Suppression (a tracked `.env` is reported once, by `env-tracked`) moves out of `snapshot.risky()`; acknowledgement moves out of the history checks. Consequence worth having: `.pushready.json` then also applies to `env-tracked` and `node-modules-tracked`, which it cannot today — a tracked fixture `.env` is unacknowledgeable.
- [ ] **`git fsck` runs twice per run.** Once to find unreachable commits, once more just to learn whether it works. It is the slowest call pushready makes (2 of 11 processes on a clean repo). Run it once.
- [ ] **The guide hardcodes category ids.** `['history-keys', 'history-credentials']` and `['history-data']` are written into `exposureGuide`, so a fourth category would be silently left out of the advice. Derive the grouping from category metadata.
- [ ] **The tag hedge covers credentials only.** A data file that is only on a tag gets the plain "probably never left your machine" line.
- [ ] **The acknowledged heading ignores where the file is.** "2 private key files in git history, acknowledged" is printed even when both are in a stash.
- [ ] **Unknown flags are silently ignored.** `pushready . --hsitory` runs without detail and exits 0. Reject with 64 and name the flag.
- [ ] **`skip` is missing from the summary.** A non-git folder lists six skipped checks and then says "0 passed, 1 warning, 2 failed".
- [ ] **Check ids are not asserted unique.** One test, before v0.3.2 starts addressing checks by id.
- [ ] **A `.gitignore` comment satisfies the `.gitignore` check.** `# remember to add .env` passes it. Only a rule should count: skip comment lines, and require a pattern that would actually match.

**Done when:** every bullet has a test that was seen failing against v0.3.0; the side-by-side output comparison against v0.3.0 differs *only* in lines these fixes intentionally change, and that list is written in PROGRESS.md; `grep TODO(v0.3.1) src/` returns nothing; no new flag, check or output format exists.

### v0.3.2 — registry metadata, the finding schema, and the first flags

- [ ] Every check has `title`, `severity` (`blocker` / `warning` / `info`), `reads` and `appliesTo(snapshot)`.
- [ ] **One finding shape**, documented: `{ id, title, severity, status, message, fix, items[] }`, keeping the two levels the output already relies on — a finding per check, evidence items (path, place, exposure, aliases, …) under it.
- [ ] `--only <id>` / `--skip <id>`, selecting from the registry. The policy pass still runs, so skipping `env-tracked` does not hide a committed `.env`.
- [ ] **The exit-code contract, written and tested.** v0.2's `0` / `1` / `2` / `64` are the base. Decide and test: does `--skip` of a failing check lower the code? Does `--only` narrow what can be reported? Does `unknown` ever fail? `--json` must not change the code. Stated in `--help`.
- [ ] **`.pushready.json` gets a `version` field**, and a decision is recorded on which of v1.0's config items (turn checks off, change severity, ignore paths) land here in v0.3 versus stay flags-only. An older pushready meeting a newer file says so.

**Done when:** `pushready --only readme` spawns no git process (asserted); every exit-code question above has a test; the finding shape is documented and a test asserts every check's output matches it; `.pushready.json` without `version` still works and one with an unknown version warns.

### v0.3.3 — machine output and strictness

- [ ] `--json`: the finding shape plus a top-level `{ version, dir, findings, guide, exit }`, documented and covered by a test that fails if the shape drifts.
- [ ] `--quiet` (failures and warnings only) and `--strict` (per the v0.3.2 contract: what it promotes, and whether `unknown` fails).
- [ ] **Classification and verdict:** findings grouped into "Fix before making public" (blockers) and "Good practice", with one line: `Ready to make public: no (2 blockers)`.

**Done when:** `--json` output is byte-stable across two runs on the same repo and parses in CI without the text renderer; `--strict` is tested on `warn` and `unknown`; the verdict agrees with the exit code in every scenario.

### v0.3.4 — remedies as rules

- [ ] `exposureGuide` becomes an ordered list of rules — rotate, data, gitignore-too-late, drop stash, delete ref, expire unreachable, rewrite, force-push — each with `appliesTo(findings)` and `build(findings)`.

**Done when:** the single function is gone; the side-by-side comparison against v0.3.3 shows 0 differences in guide output; each rule has its own test.

### v0.3.5 — fix plans as data

- [ ] Rules return actions, `{ kind: 'run' | 'edit' | 'manual', … }`, not strings. The text renderer prints them as today; `--json` carries them.

**Done when:** no remedy returns a bare string; a test asserts a full run spawns no process and writes no file beyond what v0.3.0 did; `--json` includes `actions` for every step.

### v0.3 as a whole — done when

- All v0.1 and v0.2 checks run through the snapshot, the registry and the policy pass, and `grep TODO(v0.3` in `src/` returns nothing.
- The finding schema, the JSON schema and the exit-code contract are each documented in one place and each guarded by a test.
- A check that reads an undeclared snapshot field, or opens a file outside the allowlist, fails the suite.
- `exposureGuide` no longer exists as one function, and the guide's output is unchanged from v0.3.0 except for the v0.3.1 fixes listed in PROGRESS.md.
- Every point release above has its "Done when" ticked in this file.

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
