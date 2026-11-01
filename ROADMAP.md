# Roadmap

pushready is a **local, zero-setup checker** for the mistakes people make before pushing or open-sourcing a repo. It works from file names and git paths on your own machine: no accounts, no uploads, no network calls.

**Where it's going:** from "a report you run by hand" to a small **checking framework**. Checks are registered modules with a severity and a fix plan, and the framework runs them on your machine, as a git hook, or in CI, producing structured findings and safe fix plans.

## Status at a glance

*Updated 1 Nov 2026, pushready 0.3.6. Counts are checkbox items in this file; regenerate by eye after any release.*

```
SHIPPED                                                      53 of 77 items  █████████████████░░░░░░░  69%

  v0.1  First checks                 ██████████████████████████████  10/10   README, LICENSE, .gitignore,
                                                                             committed .env + node_modules
  v0.2  Git-history exposure         ██████████████████████████████  14/14   where a risky file lives, whether
                                                                             it was pushed, the cleanup guide
  v0.3  Check framework              ██████████████████████████████  28/28   DONE, in six point releases
        ├─ v0.3.0 module split       ██████████████████████████████   3/3    snapshot, privacy fence
        ├─ v0.3.1 close the gaps     ██████████████████████████████  10/10   severity, policy pass, 11 fixes
        ├─ v0.3.2 registry + flags   ██████████████████████████████   5/5    titles, finding shape,
        │                                                                    --only / --skip, exit contract
        ├─ v0.3.3 machine output     ██████████████████████████████   3/3    --json, --quiet, --strict, verdict
        ├─ v0.3.4 remedies as rules  ██████████████████████████████   1/1    8 rules, output unchanged
        ├─ v0.3.5 fix plans as data  ██████████████████████████████   1/1    actions, not strings
        └─ v0.3 as a whole           ██████████████████████████████   5/5    every "done when" met

NOT STARTED
  v0.4  Pre-push hook                ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0/4    NEXT: block the push, not report after
  v0.5  pushready fix                ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0/6    apply the safe fixes, previewed
  v0.6  More checks                  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0/5    large files, build output, junk
  v1.0  Open it up                   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0/6    custom checks, npm, Python/.NET
  --    Large repositories           ████████░░░░░░░░░░░░░░░░░░░░░░   1/4    oversized output is a limit now;
                                                                             batching the per-path queries is not
```

**What works today:** 9 checks over any git repository, in plain English, with a
remediation guide that branches on where a file lives and whether it was pushed.
Committed dependency trees are caught in five ecosystems (npm, Python, Composer,
Bundler, .NET), not only `node_modules`.
`--json` for CI, `--only` / `--skip` to choose checks, `--strict` and `--quiet`,
a one-line verdict, exit codes `0` / `1` / `2` / `64`. No config needed, no
network, no account.

**What is not there yet:** anything that acts on your repo (`fix`, the pre-push
hook), and any check that is not about names (file sizes, build output, junk
files). The framework for both is now in place: every remediation step is data
(`{ kind: 'run', command }`), which is what `pushready fix` will execute.

| Health | |
|---|---|
| Source | about 1,850 lines across 13 modules, no dependencies |
| Tests | 232 across 11 files, about a minute on Linux and four on Windows, on Linux / macOS / Windows and Node 18 / 20 / 22 / 24 |
| Scenarios | 19, each with its plain, `--history` and `--json` output recorded in `test/golden/` |
| Open known gaps | 0 — the five from the v0.3 review are fixed (see PROGRESS.md) |

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

*Re-planned 30 Oct 2026* as point releases, each with its own completion criteria, and **completed 1 Nov 2026** at pushready 0.3.6. v0.3.0 was cut at the two stages that changed no behaviour; v0.3.1 fixed what a review of v0.3.0 found before anything new was built on it; v0.3.2 to v0.3.5 added the registry, the flags, machine output and the guide as rules. The `TODO(v0.3.x)` markers that tied each gap to a release are all gone from `src/`.

### ✅ v0.3.0 — module split and shared snapshot (30 Oct 2026)

- [x] **Module split, no behaviour change.** `checks.js` (772 lines) split into `patterns.js`, `git.js`, `history.js`, `acknowledge.js`, `guide.js`, `text.js` and a `checks.js` of checks and `runChecks`.
- [x] **Shared lazy snapshot.** Checks receive a memoised, read-only view of the repository instead of `dir`, and declare in `reads` which fields they use. Nothing is read until asked: file-only checks spawn no git process, and the three history checks share one walk (16 processes instead of 30). `index.js` is the public surface.
- [x] **Privacy boundary enforced, not declared.** A test fences every check to its `reads` list and fails on an undeclared read. The snapshot refuses to open any file outside README, LICENSE, `.gitignore`, `package.json` and `.pushready.json`.

**Done when — met:** 52 tests pass; 15 scenarios exit as declared; the CLI's output before and after each stage was compared on every scenario, `--history` and plain (32 and 34 comparisons, 0 differences); removing a field from a check's `reads` fails the suite; `snapshot.readFile('.env')` throws.

### ✅ v0.3.1 — close the gaps found in v0.3.0 (31 Oct 2026, no new features)

A review of the shipped code, looking for what is *wrong* rather than what is *missing*. Nothing here adds a flag, a check or an output format. Each item got a test that failed before the fix. Done in three rounds on 31 Oct 2026: the six small items, then the fsck double run, then the category metadata and the policy pass together. See PROGRESS.md for what each round changed in the output.

- [x] **Severity and status are one field, and should be two.** `RISKY_CATEGORIES[].status` is `'fail'` / `'warn'` — a *severity* (fixed per check) named and used as a *status* (what happened this run). Rename to `severity`; results carry both. Without this there is no way to say "a blocker that passed" or "a blocker that was acknowledged", which `--strict`, `--json` and the verdict all need.
- [x] **A policy pass over results**, after the checks and before the report. Suppression (a tracked `.env` is reported once, by `env-tracked`) moved out of `snapshot.risky()`; acknowledgement moved out of the history checks. Consequence: `.pushready.json` now also applies to `env-tracked` and `dependencies-tracked` (then called `node-modules-tracked`), so a tracked fixture `.env` or a deliberately vendored folder can be acknowledged. **The symptom that made this urgent, found 31 Oct 2026:** a `.env` that was *pushed* and still tracked got exit 1, no exposure line and no guide, while the same repo after `git rm --cached .env` got exit 2 and the full rotate/rewrite/force-push guide — the suppression hid the history finding and `env-tracked` had no items to carry it. The pass *merges* rather than drops: `env-tracked` keeps the finding (its "git rm --cached" step is what a beginner needs first) and carries the history items, so exposure, the guide and the exit code all see it.
- [x] **`git fsck` runs twice per run.** Once to find unreachable commits, once more just to learn whether it works. It is the slowest call pushready makes (2 of 11 processes on a clean repo). Run it once.
- [x] **The guide hardcodes category ids.** `['history-keys', 'history-credentials']` and `['history-data']` are written into `exposureGuide`, so a fourth category would be silently left out of the advice. Derive the grouping from category metadata.
- [x] **The tag hedge covers credentials only.** A data file that is only on a tag gets the plain "probably never left your machine" line.
- [x] **The acknowledged heading ignores where the file is.** "2 private key files in git history, acknowledged" is printed even when both are in a stash.
- [x] **Unknown flags are silently ignored.** `pushready . --hsitory` runs without detail and exits 0. Reject with 64 and name the flag.
- [x] **`skip` is missing from the summary.** A non-git folder lists six skipped checks and then says "0 passed, 1 warning, 2 failed".
- [x] **Check ids are not asserted unique.** One test, before v0.3.2 starts addressing checks by id.
- [x] **A `.gitignore` comment satisfies the `.gitignore` check.** `# remember to add .env` passes it. Only a rule should count: skip comment lines, and require a pattern that would actually match.

**Done when — met:** every bullet has a test that was seen failing against v0.3.0 (the id-uniqueness guard excepted); the side-by-side output comparison against v0.3.0 differs in 4 of 30 runs, all in the lines listed in PROGRESS.md; `grep TODO(v0.3.1) src/` returns nothing; no new flag, check or output format exists. 67 tests.

### ✅ v0.3.2 — registry metadata, the finding schema, and the first flags (31 Oct 2026)

- [x] Every check has `title` and `appliesTo(snapshot)` (`severity` and `reads` landed in v0.3.1 and v0.3.0). *Open question, not blocking:* whether README and LICENSE deserve `blocker`. They were given it because they fail the run today; a project owner may well want a missing README to be a warning. Revisit when `--strict` has been used in anger.
- [x] **One finding shape**, documented in `src/finding.js`: `{ id, title, severity, status, message, fix, items[] }`, keeping the two levels the output already relies on — a finding per check, evidence items (path, place, exposure, aliases, …) under it.
- [x] `--only <id>` / `--skip <id>`, selecting from the registry. The policy pass still runs, so skipping `env-tracked` does not hide a committed `.env`.
- [x] **The exit-code contract, written and tested** (`src/verdict.js` and `--help`), on top of v0.2's `0` / `1` / `2` / `64`. The answers to the questions this item opened with: `--skip` of a failing check lowers the code, because the check did not run; `--only` narrows what is reported and the summary says `N not run`; `unknown` never fails without `--strict`; `--json` never changes the code. A bare repository, two paths, an unknown check id or an option missing its value are all `64`.
- [x] **`.pushready.json` gets a `version` field** (absent means 1; a newer version warns and is applied where understood; a file of the wrong shape says what was expected). **Decision, confirmed by the project owner 1 Nov 2026:** the file holds `version` and `acknowledge` only. Choosing which checks run is done with `--only` and `--skip`; there is no config-based severity override or check selection for now. *Why:* a config that silences a check hides it from everyone who reads the CI output, while a flag is visible in the command that ran. The v1.0 config item stays on the list to be reconsidered alongside custom checks.

**Done when — met:** `pushready --only readme` spawns no git process (asserted with `GIT_TRACE`); every exit-code question above has a test in `test/flags.test.js`; the finding shape is documented and a test asserts every result, placeholders included, has exactly those keys; `.pushready.json` without `version` works and `"version": 2` warns.

### ✅ v0.3.3 — machine output and strictness (31 Oct 2026)

- [x] `--json`: the finding shape plus a top-level `{ version, dir, findings, guide, exit }`, documented and covered by a test that fails if the shape drifts.
- [x] `--quiet` (failures, warnings and could-not-check; passes, skips and acknowledged are folded away but still counted) and `--strict` (a `warn` or an `unknown` is exit 1; never lowers a 2).
- [x] **Verdict:** one line before the summary, `Ready to make public: yes` / `no (2 blockers) — something was pushed, rotate first` / `yes, as far as could be checked (4 could not be checked)`, and a `verdict` object in `--json` with the counts. **Decision, confirmed by the project owner 1 Nov 2026:** the report keeps its existing organisation rather than being regrouped into "Fix before making public" and "Good practice" sections. The distinctions a reader needs are **severity** (how bad a check is), **status** (what happened this run) and **exposure** (whether a file left the machine), each already on every finding, and the guidance stays as one ordered set of steps. A grouped view can be a `--json` consumer's choice.

**Done when — met:** `--json` is byte-stable across two runs (tested) and every scenario's recording includes its `--json` output, so drift fails the suite; `--strict` is tested on `warn` and `unknown`; a test reads every recording and checks that the verdict, the text exit code and the JSON `exit` field agree.

### ✅ v0.3.4 — remedies as rules (1 Nov 2026)

- [x] `exposureGuide` is an ordered list of rules — rotate, data, gitignore-too-late, drop stash, delete ref, expire unreachable, rewrite, force-push — each with `appliesTo(context)` and `build(context)`. `RULES` is exported, so the order the steps appear in is the order they should be done in, stated in one line.

**Done when — met:** the single function is gone (the longest is now 20 lines); the text report was compared against the recordings made before the split, 38 comparisons, **0 differences**; each rule has a test that fires it, plus one asserting the step order and one asserting a rule that does not apply contributes nothing.

### ✅ v0.3.5 — fix plans as data (1 Nov 2026)

- [x] Rules return actions, `{ kind: 'manual' | 'run', text, command? }`, not strings. `text` is exactly what the report prints; `command` is the runnable part on its own, so a line like "Untrack it first: git rm --cached x" carries both and nobody has to parse English back into a command. `'edit'` is not in `ACTION_KINDS` yet: no rule produces one, and adding a kind nothing emits would be a shape nothing guarantees. It arrives with `pushready fix` in v0.5.

**Done when — met:** no remedy returns a bare string; `guideCommands()` returns every suggested command with no prose, and a test asserts each one starts with `git `; a test runs the full CLI on a repo whose guide says to drop a stash, untrack a file and rewrite history, then asserts every file's size and mtime, `HEAD` and the stash list are unchanged; `--json` carries `actions` for every step, in all 19 recordings.

### v0.3 as a whole — done when

- [x] All v0.1 and v0.2 checks run through the snapshot, the registry and the policy pass, and `grep TODO(v0.3` in `src/` returns nothing.
- [x] The finding schema (`finding.js`), the JSON schema (the same shape, plus the top-level document) and the exit-code contract (`verdict.js`) are each documented in one place and each guarded by a test.
- [x] A check that reads an undeclared snapshot field, or opens a file outside the allowlist, fails the suite.
- [x] `exposureGuide` no longer exists as one function, and the guide's output is unchanged from v0.3.0 except for the v0.3.1 fixes listed in PROGRESS.md.
- [x] Every point release above has its "Done when" ticked in this file.

**v0.3 is complete (1 Nov 2026, pushready 0.3.6).** 232 tests in 11 files, 19 scenarios recorded three ways each, 13 modules, no dependencies. The five problems the v0.3 review left open are fixed, and the suite runs on Linux, macOS and Windows with Node 18 to 24.

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

- [ ] **Large files** — see the section below; it is the only one of these that needs a new kind of question asked of git
- [ ] Build output: `dist/`, `build/`, `.next/`, `out/`, `coverage/`, `__pycache__/`, `*.pyc`. (.NET `bin/Debug`, `bin/Release` and `obj/` are already caught by `dependencies-tracked`, by marker rather than by name.)
- [ ] OS and editor junk: `.DS_Store`, `Thumbs.db`, `.vs/`, `.idea/`, `*.swp`
- [ ] Template README text left behind (e.g. "TODO: Give a short introduction")
- [ ] `package.json` basics: `license` matches the LICENSE file, `repository` set, lockfile present

### The large-files check, in detail

*Scoped 31 Oct 2026, after measuring the cost on real repositories. The numbers
below were taken with `GIT_TRACE` and `time` on the demo scenarios and on
purpose-built repos; they are repeated in PROGRESS.md with how they were taken.*

**Why it is not just another name pattern.** Every check today answers a
question about *names*. This one needs *sizes*, which is the first time
pushready has to ask git about the content of an object. The good news from
measuring: it can be done without reading any content.

- `git cat-file --batch-check --batch-all-objects` returns the type and byte
  size of every object: **11 ms** on a repo holding a 60 MB binary. It reads the
  object headers, never the data.
- `git rev-list --objects --all` maps blobs to the paths they were committed
  under: **10 ms** on the same repo.

So the check is two git calls whose cost is set by the number of *objects*, not
by how big they are. **A 60 MB file costs nothing to check** — a full run on a
repo containing one takes 881 ms, the same as a repo with none — because
pushready reads names and sizes and never opens the file. That keeps the
privacy boundary exactly as it is: add "object sizes" to the README's "What it
reads", and nothing else changes.

**What the check has to distinguish**, because the fix is different for each:

| Where the big file is | What it means | The fix to give |
|---|---|---|
| Tracked now | every clone downloads it, for ever | Git LFS, or untrack it and ignore it |
| In history, deleted since | the clone is still as big as it ever was | `git filter-repo`, the same path the credential checks already walk |
| Staged, never committed | nothing has happened yet | `git rm --cached`, no history to clean |

That is the same three-way split `env-tracked` and the history checks already
make, so it reuses `describePath` and the existing guide rather than inventing
a second notion of where a file lives.

**Thresholds to decide before building:**

- GitHub **warns at 50 MB** and **rejects at 100 MB** per file; the repository
  soft limit is 1 GB. npm and PyPI have their own.
- 5 MB (the original bullet) is a *hygiene* number, not a platform one. Proposal:
  **warn at 5 MB**, **fail at 50 MB**, and say which limit the file is against.
  A `warning` severity for the first and `blocker` for the second fits the
  severity field v0.3.1 added, and needs no new vocabulary.
- Decide explicitly what Git LFS pointers do: a repo using LFS correctly has a
  132-byte pointer in git and must not be reported. Detect `.gitattributes`
  `filter=lfs` and say so rather than staying silent.

**One implementation constraint, found while measuring.** `src/git.js` buffers
every git command into memory with a 64 MB `maxBuffer`, and
`git cat-file --batch-all-objects` prints *one line per object* — roughly 60
bytes each, so about **1.1 million objects** before a run dies with `ENOBUFS`.
That is the most output-heavy command pushready would have ever run. This check
should stream its output rather than buffer it, or filter inside git with
`--batch-check` on a `rev-list` pipe. See "Large repositories" below.

**Done when:** a 60 MB file committed and then deleted is reported as history
with the `filter-repo` path; a tracked one is reported with the LFS advice; an
LFS-tracked file is not reported; a repo with 100k objects is checked without
buffering its object list into memory; and the scale test asserts the check adds
a constant number of git processes, not one per file.

---

## Large repositories

*Measured 31 Oct 2026. Not a release of its own — a property the project has to
keep, with the findings that back it up. `test/scale.test.js` asserts the ones
that can be asserted without a wall-clock timer.*

**What is already good, and should stay that way.** Cost does not grow with the
size of the repository. Going from 10 files to 2,000 across 40 commits changes
the run from 758 ms to 1,218 ms and **the git process count not at all** (17
either way), because every path ever added comes out of a single `git log`
rather than a question per file. A test now pins this.

**The real cliff is the number of findings, not the size of the repo.** Locating
one risky path costs two git processes (`for-each-ref --contains` and
`merge-base --is-ancestor`), and they are per path:

| Risky paths | git processes | Wall clock |
|---|---|---|
| 1 | 17 | 758 ms |
| 10 | 35 | 1,084 ms |
| 50 | 115 | 2,211 ms |
| 100 | 215 | 3,227 ms |

- [ ] **Batch the location queries.** One `for-each-ref --contains` can take
  several commits, and most findings share a commit. Group paths by the commit
  that added them first: a repo that committed a whole `node_modules` of keys
  has hundreds of paths but a handful of distinct commits.
- [ ] **Cap what is described.** Past some number of findings the per-file detail
  stops being useful anyway. Describe the first N and say "and 340 more", the way
  the branch list already says `+2`.

**Robustness, not speed.** `src/git.js` buffers each command's output with a
64 MB `maxBuffer`. Until 1 Nov 2026 a repository big enough to exceed it exited
with a Node `ENOBUFS` stack trace. The output is about 19 bytes per added path
(11.5 KB for 604 files over 42 commits), so it takes a very large monorepo to
reach — which is why it was found by reasoning rather than by a user.

- [x] **Turn an oversized git output into a limit, not a crash** (1 Nov 2026).
  `git()` throws `GitOutputTooLarge`; the snapshot catches it around the two
  reads that can overflow and records a limit, so the run reports "only part of
  the git history can be checked" and the category checks say "found nothing,
  but the history is incomplete" rather than "none found". `PUSHREADY_MAX_BUFFER`
  exists so that path is tested without building a 64 MB repository.
- [ ] **A scenario with enough objects to prove it**, once the large-files check
  makes the object list a thing pushready reads.

---

## v1.0: Open it up

- [ ] **Custom checks:** load project-specific checks from a local file (e.g. `.pushready.js`) using the v0.3 check interface, with the same rules: paths in, findings out
- [ ] Optional config (`.pushready.json`) to turn checks off, change severity, or ignore paths. *Decided against for v0.3* (see v0.3.2): flags do this today, and a config that silences a check hides it from whoever reads the CI output. Reconsider here, alongside custom checks, where a project-level policy may be the point.
- [ ] Publish to npm so `npx pushready` works
- [ ] Python and .NET projects. *Partly done 1 Nov 2026:* a committed virtualenv (`pyvenv.cfg`, `site-packages/`) and .NET `bin`/`obj` output are reported by `dependencies-tracked`. Left: `__pycache__/` and `*.pyc` (build output, v0.6) and stack-aware `.gitignore` advice.
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
