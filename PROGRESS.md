# Progress

Working log for pushready, updated as we go. [ROADMAP.md](ROADMAP.md) is the plan;
this file is where we are in it, and why things were decided the way they were.

**Where things stand:** v0.3 is complete at pushready **0.3.6** (1 Nov 2026) — the check
framework, the flags, `--json`, the guide as rules, the five review gaps closed, and the
suite portable to Windows, macOS and Node 18–24. **Next:** v0.4, the pre-push hook. The
"Status at a glance" dashboard at the top of ROADMAP.md is the quickest picture.

---

## Done

### v0.1 (released)

All first checks, tests, demo and cross-platform CI. See the v0.1 section of ROADMAP.md.

### v0.1 bug fixes (24 Oct 2026)

Both of these made the history check report a confident **pass** when it should not have.
Both now have a regression test that was verified failing against the pre-fix code.

- **Non-ASCII paths were invisible.** `git log --name-only` escapes them by default, so a
  `.env` under `café/` came back as `"caf\303\251/.env"` and never matched. History paths are
  now read with `-z`, and `core.quotePath=false` is set on every git call.
- **Shallow clones silently passed.** A `git clone --depth 1`, or `actions/checkout` without
  `fetch-depth: 0`, doesn't have the older commits. The history checks now report a new
  `unknown` status ("could not be checked") instead of passing.

### v0.2 item 1 — find risky files anywhere in history (24 Oct 2026)

Three category checks, all run by default, each with its own id and severity:

| Check | Severity | Patterns |
|---|---|---|
| `history-keys` | fail | `id_rsa` / `id_dsa` / `id_ecdsa` / `id_ed25519`, `*.pem`, `*.key`, `*.p12`, `*.pfx` |
| `history-credentials` | fail | `.env*`, `credentials.json`, `service-account*.json`, `.netrc` |
| `history-data` | warn | `*.sqlite`, `*.sqlite3`, `*.db` |

Replaces the single `.env`-only `env-history` check. 6 new tests (14 total, all passing).

### v0.2 items 2 and 3 — detail per file, and "already pushed?" (24 Oct 2026)

Done together, because the thing that makes the default line useful is knowing whether a
file ever left the machine. One short line per risky file:

```
.env.local — deleted, on main, local only
certs/server.key — still in the repo, on feature/deploy, not on a remote
service-account-prod.json — deleted, on main, pushed
```

- **Exposure is one of three words:** `pushed`, `local only` (no remote configured at all),
  or `not on a remote` (remotes exist but don't have it). The third is hedged in the fix
  text, because remote-tracking refs are only as fresh as the last `git fetch`.
- **`--history`** adds the commit hash and every branch, kept out of the default output.
- 3 new tests covering the roadmap's three "Done when" cases (17 total, all passing).

### Demo scenarios (24 Oct 2026)

`scripts/scenarios.js` replaces the single demo repo with eight: `clean-node`,
`clean-python`, `messy-node`, `messy-python`, `deleted-local`, `pushed-history`,
`branch-only` and `large` (600 files over 40 commits). Each declares the exit code it
should produce, so `npm run demo` also checks they still behave as described. Pushing uses
a local bare repo, so everything stays offline.

### v0.2 items 4 and 5 — exposure guide (24 Oct 2026)

One **What to do next** block after the findings, built from what was actually found
rather than a fixed script:

- **Rotate** is only step 1 when something was really pushed. Otherwise it says nothing
  left this clone, and suggests `git fetch` if unsure.
- **Data files get their own step**, because they can't be rotated.
- **The `git filter-repo` command** lists the exact paths found. Paths are double-quoted,
  which behaves the same in bash, `cmd` and PowerShell. Paths containing `" $ \` \` or a
  newline, or more than eight paths, fall back to `--paths-from-file`.
- **Force-push and re-clone** only appear when something was pushed.
- `--history` adds the install note, the fresh-clone requirement, and the GitHub Support
  step for cached pull request refs. `--help` explains the three exposure states.
- 5 new tests (22 total, all passing).

### v0.2 follow-ups (24 Oct 2026)

- **`--history` is now a labelled block per file** — status, exposure (with a plain-English
  explanation of what that state means), commit, branches, remotes, `.gitignore` status —
  instead of a dense line plus a dump.
- **`.gitignore` explained against history.** A risky path that `.gitignore` already lists
  is marked as such, and the guide says plainly that ignoring a file neither untracks it
  nor removes it from history, with the `git rm --cached` command when it's still tracked.
- **One history-completeness warning,** covering shallow *and* single-branch clones, each
  with the command that fixes it. Replaces the repeated per-category message.
- **Acknowledged findings** via `.pushready.json`; see the decision below.
- **Exit codes by exposure:** `0` / `1` / `2` / `64`.
- 6 new tests (28 total) and 3 new scenarios: `gitignored-too-late`, `acknowledged`,
  `shallow`. 11 scenarios in total.

**v0.2 is complete.** All five roadmap items are ticked, the "Done when" criterion is met,
and four follow-ups were added on top.

### v0.2 bug fix — renamed files were missed (29 Oct 2026)

A file renamed *into* a risky name was invisible. Regression test verified failing against
the pre-fix code.

`git log` detects renames by default (`diff.renames` has been on since git 2.9), so a
rename is reported as a single `R100 old new` entry rather than an add plus a delete.
`--diff-filter=A` skips `R` entirely, so the new name was never seen: a `notes.txt` renamed
to `deploy.pem` produced **no finding at all**. Both history walks now pass `--no-renames`,
which decomposes every rename back into `A` on the new path and `D` on the old one — the
list we actually want is "every name this content was ever committed under", not "where
git thinks the file came from". It also skips the similarity search, so it's a little
cheaper on big histories.

The reverse direction (`deploy.pem` renamed to `notes.txt`) already worked, because the
risky name was a genuine add at its first commit. The new test pins both directions, and
asserts the commit and branch are still resolved — `describePath` needed the same flag, or
a renamed-in path would have reported an empty branch and the wrong exposure.

New scenario `renamed-secret` (12 in total) and 1 new test (29 total, all passing).

### v0.2 bug fix — cleanup guidance named only one of a file's names (29 Oct 2026)

The gap the fix above exposed, and the worse half of it: detection was right, the advice
was wrong. For `deploy/id_rsa` renamed to `deploy/key.backup`, the guide said
`git filter-repo --invert-paths --path "deploy/id_rsa"` — which removes that path and
leaves the identical blob in history under the other name. A cleanup that looks like it
worked and didn't is worse than no cleanup, because the user stops worrying.

Verified both directions with `git filter-branch` standing in for `filter-repo` (dropping
the `refs/original` backup first, which otherwise keeps the old objects reachable and makes
any such test read as a false negative): with the old single-path command the blob was
still reachable at `deploy/key.backup`; with the new command it was unreachable.

- **A rename graph.** `git log --all --diff-filter=R --name-status -z --format=` gives flat
  `R<score>\0old\0new\0` triplets. These are linked into an *undirected* graph and walked
  breadth-first from each risky path, so a chain (`notes.txt` → `deploy.pem` →
  `archive/old.txt`) resolves to all three names from any one of them.
- **The command lists every name**, deduplicated, with a line above it saying which names
  are aliases and why they are there — otherwise it reads like pushready telling you to
  delete an unrelated backup file. The 8-path `--paths-from-file` fallback counts aliases.
- **Exposure now follows the content, not the name.** A file pushed as `notes.txt` and only
  then renamed to `deploy.pem` had already left the machine, but the commit that created
  the name `deploy.pem` never did, so it used to report "probably never left your machine"
  about a secret that was public. Exposure is now the union across every name.
- **`--history`** gains an `also committed as` row, shown only when there are aliases.
- 4 new tests (33 total, all passing). One of them — two risky names for the same file —
  passed before the change and is there to stop aliases double-listing paths.

### v0.2 bug fix — advice assumed everything was on a branch (29 Oct 2026)

Started from one report: a key that only ever went into a stash was told to run
`git filter-repo`. Chasing the cause found a family. The location lookup only ever asked
git about branches (`git branch --contains` and `git branch -r --contains`), so anything
held by something else came back as "on no branch" and got branch advice. Six cases,
each reproduced against the pre-fix code before anything was changed:

| Where the commit actually was | Said before | Says now |
|---|---|---|
| Only in a stash | deleted, on no branch → `filter-repo` | `in stash@{1}, never committed to a branch` → `git stash drop stash@{1}` |
| In an **older** stash (`stash@{1}`+) | nothing — not found at all | found; see above |
| Only on a tag (branch deleted) | on no branch, "`git fetch` if unsure" | `only on tag v1.0`, and a warning that this clone cannot know whether tags were pushed |
| `refs/original/` left by `filter-branch` | on no branch → `filter-repo` | `kept only by refs/original/…` → `git update-ref -d` |
| On a detached HEAD | on no branch | located; told to check out or create a branch |
| `.env` staged, never committed | "committed… rotate any keys it held" | "staged, not yet committed", no rotation, nothing to clean |

One mechanism: `git for-each-ref --contains <commit>` lists everything holding a commit,
sorted into branches, remotes, tags and "other". Stashes need two extra things because
only the newest one is a ref: `git stash list --format=%H` is added to every history walk
so older stashes are seen at all, and `git merge-base --is-ancestor` says which entries
hold a given commit. The ancestry check only runs when nothing else holds the commit,
which is the only time it changes the advice. Each finding now carries a `place` —
`branch`, `tag`, `stash`, `ref` or `head` — and the guide splits on it: branches and tags
get the rewrite, everything else gets told what is holding it and how to drop that.

Two things found on the way:

- **`git log` with a pathspec prunes a stash's untracked-files parent.** Default history
  simplification dropped it, so a file stashed with `-u` came back with no commit, empty
  branch and a guessed exposure — before this fix too. `--full-history` on the per-path
  lookup.
- **`git stash drop` renumbers.** Dropping `stash@{0}` makes `stash@{1}` the new `{0}`,
  so the commands are emitted highest-first with a line saying why.

It also removed one call: `for-each-ref` replaces the two `branch --contains` calls.

New scenarios `stash-only` and `tag-only` (14 in total), 6 new tests (39 total, all
passing). `--help` explains the split.

### v0.2 bug fix — unreachable commits, case, and the agreed extra names (29 Oct 2026)

Three things, the last v0.2 fixes before v0.3.

**Commits nothing points at are now searched.** Amending a secret away, deleting the
branch you committed it on, or dropping a stash does not delete the commit: the object
survives until git collects it. Three cases, each needing a different source:

| Case | Found by |
|---|---|
| Amended away (`git commit --amend`) | `--reflog` |
| On a deleted branch | `--reflog` |
| In a **dropped** stash | `git fsck` only — dropping leaves the reflog entirely |

So the walk is now `git log --all --reflog <fsck commits> <stash commits>`. fsck runs with
`--unreachable --connectivity-only --no-progress`; `--connectivity-only` skips validating
object contents, which is the slow part and not what we are asking. Measured on the `large`
scenario: 45 ms for fsck, and `--reflog` made the walk no slower. Total scenario time went
from about 900 ms to about 1000 ms.

These findings get `place: 'unreachable'`, which slots into the classifier added by the
previous fix — a commit that nothing holds used to fall through to `'unknown'`. The guide
gives `git reflog expire --expire=now --expire-unreachable=now --all && git gc
--prune=now` instead of a rewrite, and that exact command was verified: it removed the
blob, and a re-run then passed.

Two wording corrections fell out of it. A category whose findings are *all* outside
history was still headed "N private key files in git history" and advised that "deleting
the file in a later commit does not remove it" — neither true for a stash or an amended
commit. There is now a third advice variant, `kept`, and the heading says "in this
repository, outside its history".

**Case-insensitive `.env`.** `ENV_FILE` and `ENV_TEMPLATE` gained `/i`, closing the known
gap where `.ENV` escaped both `env-tracked` and `history-credentials` while every other
pattern was already case-insensitive. Templates stay excluded whatever their case.

**The names agreed earlier**, moved out of "deliberately left out": `*.jks`, `*.keystore`,
`*.ppk` to keys; `kubeconfig`, `.pgpass`, `*.tfstate` / `*.tfstate.backup` to credentials.
Terraform state is a credential rather than data — see the decision below.

**Submodules are now declared**, as a history-scope limit rather than silently skipped.

New scenario `unreachable` (15 in total) and 8 new tests (47 total, all passing), one of
which is a lookalike guard (`kubeconfig.example`, `main.tf`, `keystore.md`) that passed
before the change and is there to stop the new patterns over-matching.

### v0.3 stage 0 — mechanical module split (29 Oct 2026)

`checks.js` had reached 772 lines in one module, with a 178-line `exposureGuide` as 23% of
it. Before changing how anything works, the file was split by responsibility with **no
behaviour change**: every function body was moved verbatim, and the pre-split file was
kept aside and run side by side against the new one on all 15 scenarios plus this repo,
plain and `--history`, comparing stdout and exit code. 32 comparisons, 0 differences.

| File | Holds | Lines |
|---|---|---|
| `patterns.js` | `isEnvFile`, `RISKY_CATEGORIES`, `NOT_RISKY`, `categoryOf` — pure, no I/O | 84 |
| `git.js` | the one `execFileSync` wrapper, `isGitRepo`, `lines`, `listTracked`, `listCommitted`, `ignoredPaths` | 55 |
| `history.js` | `historyLimits`, `listEverAdded`, stash / unreachable / rename discovery, `whereIs`, `describePath` | 261 |
| `acknowledge.js` | `ACK_FILE`, `readAcknowledgements` | 22 |
| `guide.js` | `exposureGuide`, `filterRepoCommand`, `DOCS` — pure over results | 210 |
| `text.js` | `plural` | 4 |
| `checks.js` | the eight check functions and `runChecks`; re-exports the public surface | 179 |

`checks.js` stays the single import for `cli.js` and the tests, by re-exporting
`isEnvFile`, `ACK_FILE` and `exposureGuide`. That is a compatibility facade, not a design:
stage 1 replaces it with `index.js` once checks stop receiving `dir`. `DOCS` is no longer
re-exported — nothing outside the old file ever imported it. Tests, scenarios and `cli.js`
are untouched.

**What the split made visible**, for stage 1 to deal with rather than this one:

- The `read` try/catch wrapper is written out four times (`historyLimits`, `repoContext`,
  `whereIs`, `describePath`). A snapshot makes it one.
- `runChecks` hand-builds a `scan` object and threads it into the history checks: that is
  the snapshot, eager and untyped. Three checks receive `dir` and can run anything; three
  receive `scan` and cannot. Stage 1 makes the second kind the only kind.
- `exposureGuide` is pure over results and imports nothing — which is exactly what lets it
  be split into one rule per step later without touching the checks.

### v0.3 stage 1 — shared lazy snapshot (30 Oct 2026)

Checks no longer receive `dir`. They receive a snapshot: a lazy, memoised, read-only view
of the repository, and nothing else. Verified the same way as stage 0 — the stage-0 tree
kept aside and run side by side against the new one on all 15 scenarios, this repo, and a
plain non-git folder, plain and `--history`: **34 comparisons, 0 differences.**

**Each check is now an object, not a bare function**, stating three things that used to be
implied: `id`, whether it `needsGit`, and `reads` — the snapshot fields it may touch.
`CHECKS` is an ordered array, and registration order is output order, which is what let
`runChecks` shrink from a hand-written sequence to a loop.

**Laziness is the point, and it measures.** Counted with a `git` shim on `PATH`, on the
`messy-node` scenario:

| | git processes | time |
|---|---|---|
| Full `runChecks`, all 10 checks | 18 | 535 ms |
| The 3 file checks only (what `--only readme` will do) | **0** | 1 ms |
| The 3 history checks sharing one snapshot | 16 | 328 ms |
| The same 3, each with its own snapshot | 30 | 487 ms |

Sharing saves 14 of 30 processes; laziness takes the file-only path to zero. Both used to
be hand-written in `runChecks` (`risky.length ? renameGraph(dir) : new Map()`) and are now
properties of the structure.

**The privacy boundary is enforced in two ways, not declared.**

- `reads` is held by a `Proxy` fence in the test suite: reading an undeclared field throws.
  Verified by deleting `'ignored'` from one check's list and watching the suite fail with
  `undeclared snapshot read: ignored`, then restoring it.
- `snapshot.readFile` refuses any name outside an allowlist (README, LICENSE, `.gitignore`,
  `package.json`, `.pushready.json`). A check asking for `.env` or `deploy.pem` throws.
  This is new: before, a check held `dir` and could open anything.

The fence runs in tests, not in normal runs — a drifted declaration should fail the build,
not someone's `pushready` on a repo full of secrets. The cost is that a `reads` list can
only drift on a path the tests never take, which is why the fencing test uses a repo that
makes every check do real work rather than return early.

`src/index.js` is now the public surface; `cli.js` and the tests import from it. 5 new
tests (52 total, all passing).

**What stage 1 left for stage 2**, deliberately:

- The `.env` suppression moved into `snapshot.risky()`, which is the wrong home for it —
  it is a cross-check policy, not a property of the repository. It sits there only because
  all three history checks need the same answer. Stage 2 moves it to a policy pass over
  findings, before `--skip env-tracked` can silently hide a committed `.env`.
- Acknowledgement is still read inside the risky-history check, for the same reason.
- `severity` is still absent: `RISKY_CATEGORIES[].status` holds `'fail'` / `'warn'`, which
  is a severity wearing a status's name. See the decision below.

### v0.3.0 cut, and what reviewing it found (30 Oct 2026)

Stages 0 and 1 are **v0.3.0**. `package.json` says so. The point of cutting here: both
stages were verified to change no behaviour, so v0.3.0 is "v0.2 with its insides
rearranged", and anything that breaks afterwards is attributable to a later change.

Before planning v0.3.1, the shipped code was reviewed for things that are *wrong*, as
opposed to *missing* — the severity/status conflation suggested there would be more. There
were. Each was confirmed against the running tool, not just read off the source:

| # | Gap | Evidence |
|---|---|---|
| 1 | `status` on a category is a severity | `patterns.js`: `status: 'fail'` is fixed per check; the CLI renders six run-time statuses |
| 2 | Suppression lives in the snapshot | `snapshot.risky()` filters tracked `.env`; with `--skip env-tracked` nothing would report it |
| 3 | Acknowledgement only reaches history findings | `snap.acks()` is read in one place; a tracked fixture `.env` cannot be acknowledged |
| 4 | **`git fsck` runs twice per run** | Counted with a `git` shim: 2 of 11 processes on `clean-node`, 2 of 18 on `messy-node`. It is the slowest call |
| 5 | Guide hardcodes category ids | `guide.js:40` — a fourth category would be silently left out of the advice |
| 6 | Tag hedge is credentials-only | `guide.js:79` — a data file only on a tag gets the plain reassurance |
| 7 | Acknowledged heading ignores `place` | `checks.js`: "in git history, acknowledged" printed for stash-only items |
| 8 | **Unknown flags are silently ignored** | `pushready . --hsitory` → exit 0, no detail. `--json` → exit 0, no JSON |
| 9 | `skip` missing from the summary | Non-git folder: six skip lines, then "0 passed, 1 warning, 2 failed" |
| 10 | Check ids not asserted unique | No test; v0.3.2 addresses checks by id |
| 11 | **A comment satisfies the `.gitignore` check** | `# remember to add .env and node_modules later` → "✔ .gitignore found" |
| 12 | **README's "real output" block was stale** | Missing the "Full git history available" line and the entire "What to do next" section; summary said 1 passed, tool says 2. **Fixed now** — regenerated from the live demo |

Items 1–11 are v0.3.1. Item 12 was a documentation bug and is fixed in this cut. Item 4 is
a performance bug with no behaviour change; it is still deferred, so that v0.3.0 stays
exactly the state that was verified identical to v0.2.

Each of 1–11 is marked in the source with a `TODO(v0.3.1)` comment at the line it concerns,
16 TODOs in all across six files (including `TODO(v0.3.2)`, `(v0.3.4)`, `(v0.3.5)` for the
later releases). `grep -r "TODO(v0.3" src/` is the live list; a release is done when its
tag no longer appears.

Also in this cut: `cli.js` gained the module header it was missing, and every module now
opens with what it is for.

### v0.3.1, first half — the six small gaps (31 Oct 2026)

The eleven items were sorted by how much they touch before any were fixed: six are each
one file and a few lines, two cross files (#4 fsck, #5 guide ids), and three are one
architectural change (#1 severity, #2 and #3 the policy pass). The six went first, so that
the output diff against v0.3.0 stays small and attributable, and the hard ones land on a
clean base.

Each got a test that was seen failing against v0.3.0 (5 of 6; the id-uniqueness test is a
guard and had nothing to fail on). 58 tests, all passing.

| # | Fix | Where |
|---|---|---|
| 6 | The tag hedge ("this clone keeps no record of which tags were pushed") now covers data files too; for data the closing advice is "treat it as pushed" rather than "rotate it" | `guide.js`, `tagHedge()` |
| 7 | The acknowledged heading says "in this repository, outside its history" when every acknowledged item is in a stash, a leftover ref, a detached HEAD or an unreachable commit, as the open-findings heading already did | `checks.js`, `whereOf()` |
| 8 | Anything starting with `-` that is not `--history`, `-h`, `--help`, `-v` or `--version` exits 64 with `pushready: unknown option: --hsitory`. `--json` is refused the same way until v0.3.2 adds it | `cli.js` |
| 9 | The summary appends "N skipped" when any check was skipped, so a non-git folder reads "1 passed, 0 warnings, 2 failed, 6 skipped" | `cli.js` |
| 10 | Check ids are asserted unique | test only |
| 11 | A `.gitignore` line counts only if it is a rule that would ignore the name: comments, blank lines and `!` negations do not, and nor does a rule for a different name (`.env.local` does not ignore `.env`). `.env`, `/.env`, `.env*`, `*.env`, `node_modules`, `node_modules/`, `/node_modules` and `**/node_modules/` all still count | `checks.js`, `ignores()` and `globToRegExp()` |

**Side-by-side against v0.3.0:** all 15 scenarios, plain and `--history`, 30 comparisons,
0 differences, and every scenario still exits as declared (re-run after #4 below: still 0).
No scenario exercises any of the six changed paths, which is the point: the lines that
*would* differ are exactly

- the summary line, only when something was skipped (non-git folder);
- the `history-*` heading, only when every finding is acknowledged and none is in history;
- the guide's data step, only for a data file that is on a tag and nowhere else;
- the `.gitignore` check, only when the file mentioned `.env` or `node_modules` without a rule for it;
- the whole run, only when an unknown option was passed (exit 64 instead of running).

One behaviour change is worth calling out: a `.gitignore` containing only `.env.local` or
`.env.*` used to pass the check and now warns that `.env` itself is not ignored. That is
the intended reading of "require a pattern that would actually match".

### v0.3.1 — #4, one fsck per run (31 Oct 2026)

`unreachableCommits()` now returns `{ commits, ok }`, `repoContext()` carries `fsckFailed`,
and `historyLimits(dir, context)` reads that instead of running fsck again to find out.
`snapshot.limits` passes the memoised context through. The failure path (fsck fails →
"unreachable commits could not be listed" limit) kept its behaviour and gained its first
test, by handing `historyLimits` a context with `fsckFailed: true`.

The counting test uses `GIT_TRACE`, which every git on every CI platform honours, rather
than a shim on `PATH`, which Windows would not. Measured on the demo scenarios (built-in
git commands per run, from the same trace):

| Scenario | v0.3.0 | now |
|---|---|---|
| clean-node | 17 git calls, 2 fsck | 13 git calls, 1 fsck |
| messy-node | 24 git calls, 2 fsck | 20 git calls, 1 fsck |

Four processes per fsck, because fsck itself spawns `refs verify`, `commit-graph verify`
and `multi-pack-index verify`. Output: 30 comparisons against v0.3.0, 0 differences.
60 tests, all passing.

### Found while here: a pushed `.env` that is still tracked is under-reported (31 Oct 2026)

Reproduced: commit `.env`, push, run pushready. It says "Secret file(s) committed: .env"
with the git-rm advice, then "✔ No credential files in git history", no exposure, no
"What to do next", exit **1**. Run `git rm --cached .env`, commit, run again: "1 credential
file in git history — deleted, on master, **pushed**", the full rotate / filter-repo /
force-push guide, exit **2**. Same leak, and the version where the file is *still in the
repo* is the one that is told less.

Cause: `snapshot.risky()` drops a tracked `.env` so that `env-tracked` is its only
reporter, but `env-tracked` has no `items`, so nothing downstream (the guide, the "pushed"
exit code) ever learns where the file is or whether it was pushed. This is gap #2 with a
concrete victim, and it sharpens what the policy pass has to do: not *drop* the duplicate
but *merge* it, so `env-tracked` keeps its finding and gains the history items. It also
means #5 (grouping the guide by category `kind` rather than by check id) has to land first,
because the guide must treat `env-tracked`'s items as credentials without knowing the id.
The test is written and marked `todo` at the end of the suite; it fails today for all four
reasons above, and is the acceptance test for #2.

### v0.3.1, second half — category metadata and the policy pass (31 Oct 2026)

The four remaining items, in two steps, each with its tests seen failing first.

**#5 and #1, category metadata.** Each entry in `RISKY_CATEGORIES` now has `severity`
(`blocker` / `warning`, the v0.3.2 vocabulary, so it is not renamed twice) and `kind`
(`credential` / `data`). Every check has a `severity`, and every result carries it next to
`status`, placeholders included, so "a blocker that passed" is `{ severity: 'blocker',
status: 'pass' }`. The non-category checks were given the severity that matches what they
do today: `blocker` for anything that can fail the run, `warning` for the `.pushready.json`
diagnostic, `info` for history-scope, which only ever says "unknown". Whether README and
LICENSE deserve `blocker` is a v0.3.2 question, noted there.

Items carry `kind`, and the guide groups by it instead of by check id. Anything that is not
`data` gets the credential advice, the stronger one, so a kind the guide has no words for is
never dropped. The test builds one finding per category and asserts the guide names it.

**#2 and #3, the policy pass** (`src/policy.js`, called at the end of `runChecks`). Checks
that report items now have `run`, which gathers, and `summarise(items, snap, policy)`, which
decides status and heading. The pass walks results in registration order, drops any item
whose path an earlier result already reported, marks the rest acknowledged from
`.pushready.json`, and calls `summarise` again with what is left. Two consequences:

- `snapshot.risky()` no longer hides a tracked `.env`. `env-tracked` reports it with its
  history items (it declares `risky`, `describe` and `ignored` for that), and
  `history-credentials` says "No *other* credential files in git history" when everything
  it found was already reported. Running every check except `env-tracked` makes
  `history-credentials` report the `.env` instead, which is what `--skip` needs.
- Acknowledgement reaches every check. A tracked fixture `.env` is acknowledged by path;
  a vendored `node_modules` by the path `node_modules`, since that check has no items.
  A fixture `.env` does not excuse a real one next to it.

**The pushed, still-tracked `.env`** now gets its exposure line, step 1 "Rotate or revoke",
the `filter-repo` command and exit 2, the same as after `git rm --cached`. The `todo` test
is a real test.

**Side-by-side against v0.3.0:** 30 comparisons, 4 differ, all in `messy-node` and
`gitignored-too-late`, the two scenarios with a tracked `.env`, and only in these lines:

- under "Secret file(s) committed", the item line (or `--history` block) for the tracked `.env`;
- "No credential files in git history" → "No other credential files in git history", when
  the tracked `.env` was the only credential (`gitignored-too-late`);
- the guide's `.gitignore` step and `git rm --cached` command now also name the tracked `.env`
  when `.gitignore` lists it;
- the `filter-repo` command now includes the tracked `.env`.

Every scenario still exits as declared. README's "real output" block was regenerated.
67 tests. `grep TODO(v0.3.1) src/` returns nothing; `package.json` says 0.3.1.

Noticed while reading the diff, not fixed: the `gitignored-too-late` scenario means to
untrack `.env.local` with `git rm --cached`, but the scenario helper's `commit()` runs
`git add -A -f`, which re-adds it. So `.env.local` is still tracked in that scenario, and
the "wrong fix" it describes is only demonstrated by `deploy.pem`. See the test and
scenario review below.

### Strengthening the tests, and what that found (31 Oct 2026)

The suite went from 67 tests to **139**, in six files instead of one, and the demo
scenarios went from asserting an exit code to asserting every line they print. 32 seconds
for the lot.

**The change that matters most: scenarios now have recorded output.** `scripts/golden.js`
runs each scenario plain and with `--history`, normalises the temp path and commit hashes,
and writes the whole report to `test/golden/<name>.txt`. `test/golden.test.js` compares;
`npm run golden` re-records. Two runs of the generator produce identical files, so the
recordings are stable rather than merely plausible.

This was not theoretical. The `gitignored-too-late` scenario had never demonstrated what
its title claims: it ran `git rm --cached .env.local`, then called the `commit()` helper,
which does `git add -A -f` and put the file straight back. Three releases of "all scenarios
exit as declared" passed over it, because the exit code was 1 either way. Fixed with a
`commitStaged()` helper, and the scenario now shows what it always meant to — the file
untracked but still in history, reported by `history-credentials` rather than `env-tracked`,
with the guide separating "still in the repo, needs git rm --cached" from "already deleted".

**New test files.** `test/helpers.js` holds the fixtures the old suite had inline, so the
new files share them instead of copying:

| File | Tests | What it is for |
|---|---|---|
| `checks.test.js` | 71 | What the checks find. The original suite, plus the cleanup-command limits |
| `cli.test.js` | 17 | Flags, the path argument, printed output, exit codes |
| `repo-states.test.js` | 9 | No commits, branches, a branch only a remote has |
| `config.test.js` | 10 | `.pushready.json`, mostly malformed |
| `languages.test.js` | 10 | Python, .NET, Java, Go, Ruby, Terraform |
| `scale.test.js` | 5 | What a run costs, in git processes |
| `golden.test.js` | 16 | Every scenario's full recorded output |

**Specifically requested, and what each one turned up:**

- **CLI flags.** `--help` and `-h`, `--version` and `-v`, path before or after flags, a
  relative path, and a test that the options listed in `--help` are exactly the options the
  parser accepts — drift in either direction fails. Also that `--help` documents all four
  exit codes, and that a rejected option checks nothing at all (empty stdout, exit 64).
- **No commits.** A repository with no commits, and one with a staged `.env` before the
  first commit, are both handled: history checks pass rather than erroring, and the `.env`
  is correctly called *staged, not yet committed*. Nothing asserted this before.
- **Default path.** Running with no argument checks the current folder; with an argument,
  that folder instead, verified from a different working directory so one cannot pass by
  accident. `.pushready.json` is read from the repo being checked, not from where you stand.
- **Branches.** A secret on a second branch names that branch and not the one checked out;
  on three branches it says `+2`; a deleted branch becomes `unreachable`; and the default
  branch name (`main`, `master`, `trunk`) makes no difference.
- **Messy configuration.** Both acknowledgement spellings, a reason shown or defaulted,
  broken JSON, JSON that is valid but not an object, unusable entries mixed with good ones,
  a stale path, near-miss paths that must not inherit an acknowledgement, and an empty list.
- **Cleanup guidance past eight paths.** Eight paths inline, nine or more as
  `--paths-from-file paths.txt`, the paths still printed so the file can be written, and the
  limit counting a renamed file's *other* names too — seven findings with two renames is
  nine paths and correctly switches to the file list.
- **Languages other than JavaScript.** The scenarios covered Python; the unit tests were
  entirely Node fixtures. Now Python, .NET, Java, Go, Ruby, Terraform and Kubernetes names
  are covered, along with `README.rst` and `COPYING`.

**Four findings worth acting on, recorded as tests that pin today's behaviour:**

1. **A CA bundle in a committed venv is reported as a private key.** `certifi` ships
   `cacert.pem` inside every Python virtualenv. A beginner who commits their venv — the
   exact mistake `messy-python` is about — is told to rewrite history for a public
   certificate. `*.pem` is in the private-key category and `.pub`/`.crt`/`.cer` are the only
   exclusions. Worth a path-aware exclusion (inside `venv/`, `site-packages/`,
   `node_modules/`) or a content-free name heuristic (`cacert`, `ca-bundle`).
2. **A committed `venv/` or `bin/`+`obj/` is not reported at all**, while a committed
   `node_modules` fails the run. A Python project that commits its virtualenv gets exit 0.
   This is the v1.0 "Python and .NET projects" item, and it is a bigger gap than it looks:
   it is the most common beginner mistake in those ecosystems.
3. **A config of the wrong shape says nothing.** `{"acknowledge": "path"}` or a misspelled
   `"acknowledged"` parses fine, acknowledges nothing, and produces no diagnostic — the run
   just fails and the user has no idea their file was ignored. Broken JSON *is* reported, so
   the quiet case is the inconsistent one.
4. **A second path argument is silently ignored.** `pushready . ../other` checks only the
   first. Unknown *options* now exit 64; unknown extra *paths* still do not.

Two smaller ones, noted in the tests where they live: a secret on a branch only a remote has
is correctly called `pushed`, but the item line says "deleted", which means "not in your
working tree" and reads oddly for a file alive on someone else's branch; and a
`.pushready.json` of `null` surfaces a raw JavaScript error message.

### The `large` scenario, reviewed (31 Oct 2026)

It builds 604 files over 42 commits and asserts one thing: exit 1. It is also misnamed — it
is a test of *many* files, not of large ones, and pushready has no size check at all yet.
As of this cut it does at least assert its full output, like every other scenario.

Measured rather than guessed, with `GIT_TRACE` and `time`:

| | Wall clock | git processes |
|---|---|---|
| `clean-node` (6 files, 1 commit) | 820 ms | 13 |
| `large` (604 files, 42 commits) | 1,294 ms | 13 |
| Repo with a committed 60 MB binary | 881 ms | 13 |
| 1 risky path | 758 ms | 17 |
| 10 risky paths | 1,084 ms | 35 |
| 50 risky paths | 2,211 ms | 115 |
| 100 risky paths | 3,227 ms | 215 |

The conclusions, now in ROADMAP.md under **v0.6** and **Large repositories**:

- **Repository size is already cheap and must stay that way.** 10 files to 2,000 changes the
  process count not at all, because every path comes out of one `git log`. `scale.test.js`
  asserts it.
- **The cost grows with findings, not with the repo** — two git processes per risky path, so
  100 findings is 215 processes. Batching the location queries by commit is the fix.
- **A large file costs nothing to check, because pushready never opens one.** Sizes come
  from `git cat-file --batch-check --batch-all-objects` (11 ms on a 60 MB repo) and paths
  from `git rev-list --objects --all` (10 ms). The v0.6 check is therefore two constant-cost
  calls and does *not* widen the privacy boundary: it adds object sizes, not contents.
- **The thresholds need deciding, not inheriting.** GitHub warns at 50 MB and blocks at
  100 MB; the roadmap's 5 MB is a hygiene number. Proposed: warn at 5 MB, fail at 50 MB, and
  do not report a file that Git LFS is correctly handling.
- **`maxBuffer` is the one real robustness risk.** `src/git.js` buffers every command with a
  64 MB limit, and `listEverAdded` and `listTracked` are unguarded, so a big enough
  repository exits with an `ENOBUFS` stack trace rather than a finding. `cat-file
  --batch-all-objects` prints a line per object (~1.1M objects to hit the limit) and would
  become the most output-heavy command pushready runs, so the large-files check should
  stream. Either way, `ENOBUFS` belongs in `historyLimits` as "could not be checked".

Recommended but not done, because it churns file names: rename the scenario to `many-files`
and let `large-files` mean the v0.6 one.

### Flags, git states, and config scenarios (31 Oct 2026)

164 tests across eight files, 19 scenarios. Three areas asked for, each of which turned up
something.

**`--help`, `--version`, `--json`.** The three a user or a CI script reaches for first, now
treated as a contract rather than incidental output.

- `--help` is asserted to document all four exit codes *with their meanings*, every
  exposure word (`local only`, `not on a remote`, `pushed`), acknowledgement, stashes, and
  both privacy promises. It also wins over everything else on the command line, including a
  bad path and an unknown option — asking for help always works.
- `--version` prints the version and nothing else, matched against `^\d+\.\d+\.\d+$`, with
  empty stderr, so `pushready --version` is safe to read in a script. It agrees with
  `package.json`, and `--help`'s banner agrees with both.
- `--json` does not exist yet, and there is now a test saying so out loud: exit 64, **empty
  stdout**, the flag named on stderr. A CI step piping pushready into a parser must break at
  the flag, not three lines into parsing a human-readable report. The same test covers every
  flag the roadmap promises (`--quiet`, `--strict`, `--only`, `--skip`, `--fix`,
  `--no-color`), so when one lands its line fails and the reminder to document it is
  automatic. `--only=readme` is rejected by its whole name too.

**Git history and branch edge cases** (`test/git-states.test.js`, 14 tests). States git
allows but a tool rarely expects, each changing the answer to "what holds this commit?":

- Detached HEAD, four ways: a commit held only by HEAD (`place: 'head'`, advice is "check
  out a branch", never `filter-repo`); a detached HEAD on a commit a branch also holds
  (still `branch`); detached at a tag (the tag wins, because it outlives the checkout);
  and walking away from a detached commit, which correctly becomes `unreachable`.
- Orphan branch, annotated tag, packed refs (`git pack-refs --all` moves refs out of loose
  files and must not hide anything), and a remote that exists but has never been fetched —
  which must stay `not on a remote` and exit 1, not be guessed as pushed.
- A conflicted **merge in progress** and a stopped **rebase in progress**: both leave the
  index and HEAD in an odd state, and both still produce correct findings.
- A **linked worktree**, where `.git` is a file rather than a folder, works correctly.
- A path containing a space, and a secret still pushed after its local branch is deleted.

**New scenarios** (19 total), with their full output recorded like the rest:

| Scenario | What it demonstrates |
|---|---|
| `broken-config` | `.pushready.json` with a trailing comma: warns, names the file, acknowledges nothing, still fails |
| `misshaped-config` | `"acknowledge"` as a string: parses, acknowledges nothing, **says nothing at all** |
| `no-commits` | A brand new repo, files staged and never committed: "staged, not yet committed" |
| `detached-head` | A key committed while detached: "check out a branch", no history rewrite |

`broken-config` and `misshaped-config` sit next to each other on purpose. Reading the two
recordings side by side is the clearest statement of the inconsistency found last round: one
warns, the other is silent, and only the user of the silent one is left wondering why their
file had no effect.

**One more finding: a bare repository is reported misleadingly.** Run pushready on a
`repo.git` and it says "No README found", "No LICENSE file", "No .gitignore" and skips six
checks — because a bare repo has no working tree and `rev-parse --is-inside-work-tree`
answers "false". Nothing in the output tells you it is a bare repo. It should say so and
point at a clone instead. Pinned by a test, added to the open-gaps list.

**Open gaps, all pinned by tests, in rough order of how much they would bite a beginner:**

| # | Gap | Where it shows |
|---|---|---|
| 1 | A committed `venv/` or `bin/`+`obj/` is not reported, while `node_modules` fails the run | `languages.test.js` |
| 2 | `cacert.pem` inside a committed venv is reported as a private key | `languages.test.js` |
| 3 | A misshaped `.pushready.json` acknowledges nothing and says nothing | `config.test.js`, `misshaped-config` |
| 4 | A bare repository is reported as a project missing its README | `git-states.test.js` |
| 5 | A second path argument is silently ignored | `cli.test.js` |
| 6 | "deleted" is printed for a file alive on someone else's branch | `repo-states.test.js` |
| 7 | An oversized git output crashes with `ENOBUFS` instead of reporting a limit | ROADMAP, Large repositories |

### Two reported bugs (31 Oct 2026)

Both reported from use, both reproduced before being touched.

**A secret first introduced inside a merge commit was not found.** `git log` shows no file
changes for a merge commit unless asked, so a key typed in while resolving a conflict — one
that exists in no commit on either side — was invisible to every history walk, and the run
said "No private key files in git history". Fixed by adding `-m` to the three walks
(`listEverAdded`, `renamePairs`, and the per-path `addedIn`), which diffs a merge against
each parent. A file that came in from one side now appears twice, which a Set absorbs.
Tests: a key born in a merge, and a rename done inside a merge.

**Running on a subfolder gave a broken report.** Pointing pushready at `src/` reported
`src/.env` twice — once as `.env` (tracked, path relative to `src/`) and once as
`src/.env — deleted, on no branch` (history, path relative to the root) — and said the
README, LICENSE and `.gitignore` at the root were missing. Cause: `git ls-files` returns
paths relative to the folder it runs in; every other git question answers relative to the
root. Fixed with `repositoryRoot(dir)`, a filesystem walk up to the nearest `.git` (file or
folder, so linked worktrees count) that spawns no git process, so file-only checks stay free
of git. The CLI checks the root and prints `src is inside this repository, so the whole
repository is checked`; the library does the same, so `runChecks('repo/src')` equals
`runChecks('repo')`. A folder with no `.git` above it is unchanged.

### v0.3.2 and v0.3.3 (31 Oct 2026) — the framework is usable from the command line

Done together because they share the finding shape and the exit-code contract. 194 tests
across nine files; 19 scenarios, each recorded three ways.

**v0.3.2.** Every check has `title` and (where it needs a repository) `appliesTo(snap)`,
which returns `true` or the reason it does not apply; `needsGit` is gone. `src/finding.js`
is the one documented shape, `{ id, title, severity, status, message, fix, items }`, built in
one place and used by `runChecks` and the policy pass alike, so a skip placeholder and a
real finding have the same keys (`fix: null`, `items: []`). A test asserts every result,
whatever its status, has exactly those keys, and every item exactly `ITEM_KEYS`.

`--only` and `--skip` select from the registry by id (commas, repeats or `=`), refuse an
unknown id by name with the valid ids listed, and leave the summary saying `N not run`.
The policy pass still runs over what did run, so `--skip env-tracked` hands a committed
`.env` to `history-credentials` rather than hiding it — tested. `--only readme` spawns no
git process — tested with `GIT_TRACE`.

`.pushready.json` gains `version` (absent means 1; newer warns and is applied where
understood). While there, the config reader stopped being silent about the wrong *shape*:
`"acknowledge": "path"` and a root that is not an object now warn with what was expected
instead of a JavaScript error or nothing. That closes the gap the `misshaped-config`
scenario was added to show; its title changed to match.

**v0.3.3.** `src/verdict.js` decides the exit code and the verdict line once, for the text
report and `--json` alike, with the contract written at the top of the file and in `--help`:

| Question left open in the roadmap | Answer |
|---|---|
| Does `--skip` of a failing check lower the code? | Yes. The check did not run, so it cannot count. |
| Does `--only` narrow what is reported? | Yes, and the summary says `N not run`. |
| Does `unknown` ever fail? | Only under `--strict`. "Could not check" is not "found a problem". |
| Does `--json` change the code? | Never. |

`--json` prints `{ version, dir, findings, guide, verdict, notRun, exit }`, always the full
guide, byte-stable across two runs (tested), and every scenario's recording now includes it,
so any drift in the shape fails the suite. `--quiet` shows fail, warn and unknown and folds
the rest away without uncounting them. `--strict` makes a warning or an unknown exit 1 and
never lowers a 2. The verdict line sits above the summary — `Ready to make public: yes`,
`no (1 blocker) — something was pushed, rotate first`, or `yes, as far as could be checked
(4 could not be checked)` — and a test reads every recording to confirm the verdict, the
text exit code and the JSON `exit` agree.

**Decision recorded:** the human report is not regrouped into "Fix before making public"
and "Good practice" sections. Registration order is output order, every recording depends
on it, and the verdict line plus `severity` on every finding carry the same information.

**Also closed:** a second path argument is now refused (`one path at a time`) instead of
silently ignored.

**Open gaps now**, each pinned by a test: a committed `venv/` or `bin/`+`obj/` is not
reported (v1.0); `cacert.pem` inside a committed venv is reported as a private key; a bare
repository is reported as a project missing its README; "deleted" is printed for a file
alive only on someone else's branch; an oversized git output crashes with `ENOBUFS` rather
than reporting a limit.

### v0.3.4 and v0.3.5 — the guide as rules, and fix plans as data (1 Nov 2026)

Done together: splitting the guide and changing what it returns touch the same lines, and
doing them separately would have meant rewriting the same 200 lines twice.

**v0.3.4.** `exposureGuide` was one function of about 200 lines with eight `if` blocks. It
is now eight rules, each `{ id, appliesTo(context), build(context) }`, listed in `RULES` in
the order the steps appear — which is the order the work has to be done in. `guideContext`
slices the open findings the ways the rules ask about (by kind, by where the file lives,
by whether .gitignore lists it) once, so no rule re-derives it.

The acceptance test was that nothing changes for the user. The text report was compared
against the recordings made before the split: **38 comparisons, 0 differences.**

What this buys, concretely: the step order is now one readable line rather than an
emergent property of eight `if` blocks, and a test asserts it directly
(`['rotate', 'data', 'gitignore-too-late', 'drop-stash', 'rewrite', 'force-push']` on a repo
that triggers six rules at once). Tests that used to match a blob of text now say
`steps[0].id === 'rotate'`.

**v0.3.5.** Every line a rule produces is now an action:

```js
{ kind: 'manual', text: 'They were pushed, so cleaning history will not un-leak them.' }
{ kind: 'run',    text: 'Untrack it first: git rm --cached "k.pem"',
                  command: 'git rm --cached "k.pem"' }
```

`text` is exactly what the report prints, so the text output is unchanged by construction.
`command` is the runnable part with the prose stripped off, which is what `pushready fix`
(v0.5) needs and what a `--json` consumer wants. `guideCommands(guide)` returns them in
order; a test asserts every one starts with `git ` and none begins with a word like
"Untrack" or "Drop", which would mean prose had leaked into a command.

**`'edit'` is in the roadmap's action kinds but not in `ACTION_KINDS`.** No rule produces
an edit — every step today is a git command or an explanation — and adding a kind nothing
emits would be a shape with nothing guaranteeing it. It arrives with `pushready fix`.

**The promise this rests on, now tested directly.** A run on a repo whose guide says to
drop a stash, untrack a file and rewrite history: every file's size and modified time,
`HEAD`, and the stash list are all asserted unchanged afterwards. pushready describes
these commands; it has never run one, and now a test fails if that changes.

**v0.3 is complete.** `grep TODO(v0.3 src/` returns nothing. 206 tests across ten files,
19 scenarios recorded three ways each (plain, `--history`, `--json`), 13 modules, 1,722
lines, no dependencies.

### How the code changed across v0.3

| | v0.2 (29 Oct) | v0.3.5 (1 Nov) |
|---|---|---|
| Modules | 2 | 13 |
| Largest file | `checks.js`, 443 lines, holding patterns, git, history, the checks and the guide | `checks.js`, 356 lines, holding only the checks |
| What a check receives | `dir`, so it could open anything | a snapshot it declared its reads from |
| Cross-check decisions | inside whichever check got there first | one policy pass over the findings |
| Result shape | whatever each check returned | one documented shape, built in one place |
| Exit code | computed inline in `cli.js` | `verdict.js`, shared with `--json` |
| Remediation | one 200-line function returning strings | 8 rules returning actions |
| Output formats | text | text, `--json` |
| Tests | 23 | 206 |

The through-line: in v0.2 every module could do anything, so a rule like "never open a
`.env`" or "report each path once" could only be a convention. Each v0.3 release moved one
such rule into a place where it is the only way the code can work — and three of them were
moved *because* a bug proved the convention had already been broken.

### The five open gaps, closed (1 Nov 2026)

Each was a problem *a user would hit*, found while testing rather than reported, and each
had a test pinning the wrong behaviour so that fixing it would be a visible change.

**1 & 2 — committed dependency trees, and the CA bundle inside them.** `node_modules`
failed the run while a committed Python virtualenv passed clean, so a beginner who
committed their venv — the exact mistake the `messy-python` scenario is about — got exit 0.
Worse, `*.pem` matched `certifi/cacert.pem` inside that venv, so the one thing they *were*
told was to rotate a key and rewrite history over a **public** certificate anyone can
download.

Both come from the same hole, so one fix closes both. `patterns.js` gained `vendoredOf()`,
which recognises a committed dependency tree by **marker, not folder name**:

| Ecosystem | Marker | Not matched |
|---|---|---|
| npm | a `node_modules/` segment | |
| Python | `pyvenv.cfg`, or a `site-packages/` segment | |
| Composer | `vendor/autoload.php` | a bare `vendor/` (Go vendoring is deliberate) |
| Bundler | `vendor/bundle/` | |
| .NET | `bin/Debug`, `bin/Release`, `obj/Debug`, `obj/project.assets.json` | a hand-written `bin/script.sh` |

The check is now `dependencies-tracked` (was `node-modules-tracked`, renamed because the id
had become a lie; nothing is published, so nothing depends on the old name). It names the
*root folder* and its file count — `venv (1,203 files) is committed — an installed Python
environment` — and gives one `git rm -r --cached` for all of them.

Files inside such a tree are no longer matched individually, and the fix line says so:
*"Files inside are not checked one by one: untrack the folder, then run pushready again."*
CA bundles (`cacert.pem`, `ca-bundle.crt`, Java's `cacerts`) are never flagged anywhere.
A real `server.key` sitting next to a `cacert.pem` still is.

**3 — a bare repository.** `pushready repo.git` reported "No README found", "No LICENSE
file" and exited 1. None of that is about the project; a bare repo has no working tree.
Now the CLI refuses it: *"repo.git is a bare repository, which has no working tree. Run
pushready on a clone of it instead."*, exit 64, nothing printed to stdout — so a CI step
cannot read a green run as a check that happened. The library skips every check with the
same reason instead of crashing.

Detection is a filesystem test (`HEAD` + `objects/` + `refs/`, no `.git`), not
`git rev-parse`, because the three file-only checks ask it before deciding whether they
apply and must not spawn git to find out. Getting that wrong is what broke the "no git
process for `--only readme`" guarantee halfway through this change; the test caught it.

**4 — "deleted" for a file that was never here.** A key on a colleague's branch, fetched
but not checked out, was printed as `their.pem — deleted, on origin/their-feature, pushed`.
"Deleted" reads as *dealt with*, and it is the opposite: the file is alive on their branch
and already on the remote. Items now carry `onCurrentBranch`, and the line reads
`not in your checkout`. Free — it reuses refs already read, with no extra git call.

**5 — `ENOBUFS` on a very large repository.** `execFileSync` buffers a command's whole
output, and past 64 MB threw a Node stack trace that said nothing about which repository or
why. `git()` now throws `GitOutputTooLarge`, the snapshot catches it around the two reads
that can overflow, and the run reports a limit — so the category checks say *"0 private key
files found, but the history is incomplete"* rather than the dangerous *"No private key
files in git history"*. `PUSHREADY_MAX_BUFFER` exists so this is tested at 256 bytes
instead of by building a 64 MB repository.

### Portability: the suite ran on one platform and one Node (1 Nov 2026)

Everything here had been developed on **Linux with Node 18**, while CI claimed Windows,
macOS and Node 20/24. That is not a difference of degree: **CI would have failed on every
Node 20+ runner**, and nobody would have known until the first push.

| Problem | Why it breaks elsewhere |
|---|---|
| `JSON.parse`'s error text was passed through into the report, and recorded in a scenario | Node 18 says *"Unexpected token ] in JSON at position 46"*; Node 20 says *"Expected ',' or ']' after array element…"*. The recording could only match on one |
| No `.gitattributes` | A Windows checkout rewrites the recordings to CRLF; every byte-for-byte comparison then fails |
| Golden normalisation replaced a literal `/tmp/...` | macOS uses `/var/folders/...`, Windows `C:\Users\…\Temp` |
| `dir.split('/').pop()`, `` `file://${path}` ``, `new URL(...).pathname` | All wrong on Windows, where a path has backslashes and a drive letter |
| Fixtures ran `git init` with no branch name | The branch is whatever the machine's `init.defaultBranch` says — this machine gives `master`; tests mentioning `main` passed only because a push helper happened to create it |
| `engines: ">=18"` but CI tested 20 and 24 only | A version claimed and never run |

**Fixed.** pushready now words its own JSON error (*"it is not valid JSON (at character
24)"*), which is both stable across Node versions and clearer than Node's. `.gitattributes`
pins LF, and recordings are normalised on read as well as write. Golden normalisation
replaces `os.tmpdir()` and collapses `\` after `<repo>`, so one recording is the truth on
all three platforms. Fixtures always `git init -b main`. Helpers clean up with
`maxRetries`, because Windows can hold a handle inside `.git` just after git exits. The CI
matrix is now 3 platforms × Node 18, 20, 22, 24, and runs `npm run golden -- --check` so a
platform difference in the output fails loudly on that platform.

**Verified on Windows, for real.** This machine is WSL, so Windows Node 24.11 and Git for
Windows 2.35 were reachable, and the whole suite was run under them from a copy of the tree
in the Windows temp folder. **First run: 227 of 230.** The three failures were each the
kind of thing only a different platform or Node shows:

| Failure | Cause | Fix |
|---|---|---|
| a fixture named `say "hi".pem` | Windows forbids `"` in a file name; the *test* could not build its own fixture | a backtick, which is also hard to quote and legal everywhere |
| `(at character 46)` missing from the JSON error | Node 24 words that error without a position at all, Node 18 with one — so the report depended on the Node version after all | the position is dropped; the message is `it is not valid JSON` on every Node |
| the `broken-config` recording | same cause | re-recorded |

**Second run: 230 of 230**, 19 recordings byte-identical to the ones made on Linux, in
7 min 10 s (Linux: 32 s — Windows process creation is slower, and a run is mostly git
processes). A runtime guard now refuses any fixture name Windows cannot create, on every
platform, so that first failure cannot come back; and the Node-message guard already in the
portability suite would have caught the second had it existed a day earlier.

**Simulated for the rest.** macOS has not been run. Its two mechanisms — a temp folder
under `/var/folders` and a symlinked `/tmp` — are the same code paths as Windows'
backslashes and `C:\Users\…\Temp`, which did run, and were also exercised here with
`TMPDIR` set to `/tmp/pr sim/témp dir` (a space and an accent) and `init.defaultBranch`
forced to `trunk` and to `master`: all green, recordings identical. The one mechanism
nothing local exercised is a git **checkout** converting the recordings to CRLF, because the
Windows copy was made with `rsync`, not `git clone`; `.gitattributes` and normalise-on-read
cover it twice, and CI's `actions/checkout` is where it will be seen.

**What "supported" means now.** The tool itself has no platform-specific code: every
question is asked of git, and paths are handled with `node:path`. The suite is portable by
test, not by assumption, and CI runs it on Linux, macOS and Windows with Node 18, 20, 22
and 24 — the oldest version `engines` claims and the newest current one. Until that CI run
has gone green, "all tests pass on macOS" is an expectation with good evidence, not a
result; "all tests pass on Windows" is a result.

**And guarded.** `test/portability.test.js` runs everywhere. It tests the behaviour
(a repo under an awkward path, CRLF `.gitignore` and README files, findings always using
forward slashes) and scans pushready's own source for each habit above — plus, after the
Windows run, fixture names Windows cannot create — so the same mistake fails on the
author's machine rather than on someone else's. One test reads the CI workflow and fails if
the matrix does not cover the oldest Node `engines` claims. 232 tests.

---

## In progress

**v0.4 — pre-push hook.** Not started. `pushready install-hook` / `uninstall-hook`, working
alongside existing hooks and Husky, checking only the commits being pushed so it stays
quick on a big repo. Done when a repo with a committed `.env` cannot be pushed to a local
remote while the hook is installed.

---

## Decisions

Two product decisions were made during v0.3 without being put to the project owner first,
and were put to them afterwards. Both were **confirmed, 1 Nov 2026**, and are recorded here
in the owner's terms:

**`.pushready.json` stays limited to `version` and `acknowledge`.** Check selection is done
with `--only` and `--skip`; there is no config-based severity override or check selection
for now. *Why:* a config that silences a check hides it from everyone reading the CI output,
while a flag is visible in the command that ran. The v1.0 config item is where this gets
reconsidered.

**The report keeps its existing organisation.** Findings are not regrouped into "Fix before
making public" and "Good practice". The distinctions that matter are **severity**, **status**
and **exposure**, each already on every finding, and the guidance stays as one clear ordered
set of steps.

**The rule for what counts as a risky file.** A filename commonly used for secrets or
personal data is flagged even though pushready can't confirm what's inside. Findings are
worded as a prompt to go and check, never as proof of a leak, and names that are public by
convention are excluded. *Why:* it keeps the check honest about working from names alone,
which is what the privacy boundary requires.

**Categories are separate checks, not labels on one check.** *Why:* they need different
severities. A leaked key is a blocker; a committed database needs judgement. One combined
check would have to collapse those into a single status. Separate ids are also what
`--only` / `--skip` select by.

**Database files warn rather than fail.** *Why:* unlike a key, leaked data can't be
rotated, so there's no standard fix to point at. It needs the user to look at what's in it.

**History checks cover files still in the repo, not just deleted ones.** *Why:* `git rm`
doesn't remove a file from history, so "still in the repo" is the worse case, not an
exemption. Reported as "still in the repo" on the item line. A tracked `.env` is reported
once, under `env-tracked`, with its history items; the policy pass is what stops
`history-credentials` repeating it.

**Rename detection is turned off, not followed.** `--no-renames`, rather than `--follow` or
a rename graph. *Why:* the question a history check asks is "what names has this repo ever
committed?", and a rename is two names. Following renames would merge them into one, which
is the opposite of what we want — and it's the merge that hid `deploy.pem` in the first
place. The cost is that we can't tell "renamed" from "deleted and a new file added", which
no finding currently depends on.

**Rename detection is used in exactly one place, and it is a deliberate exception to
principle 2.** Git pairs renames by comparing file contents, so asking it for a rename list
means git reads files pushready promises not to open. Only names and a similarity score
come back — no content reaches pushready, nothing is stored or sent — and the walk only
runs once something risky has already been found. *Why accept it:* the alternative is a
cleanup command that silently under-removes, which is the failure this whole check exists
to prevent. The stricter option is `-M100%`, which pairs only byte-identical files via
their blob hashes and so reads nothing; it was not taken because a secret that was renamed
*and* edited would then be missed, and missing an alias is the dangerous direction.
Recorded here because it is the one place the privacy boundary is delegated rather than
held directly.

**Exposure is a property of content, not of a name.** The union across every name in a
rename group, not just the one being reported. *Why:* the question is whether the bytes
left the machine. A file pushed as `notes.txt` and renamed to `deploy.pem` afterwards is
public, however local the rename commit was.

**The advice is chosen by what holds the commit, not by whether it is on a branch.**
Branch or tag → history → rewrite. Stash, leftover ref or detached HEAD → not history →
drop the holder. *Why:* "on no branch" used to be a dead end that fell through to the
rewrite advice, and a rewrite is the heaviest, most disruptive thing pushready ever
suggests. Suggesting it for a stash is not just wrong, it is wrong in the expensive
direction. A finding whose holder cannot be worked out is treated as history, so an
unknown still errs toward the thorough fix.

**A stash is "local only" even when a remote exists.** *Why:* the "not on a remote"
wording exists because remote-tracking refs can be stale, and `git fetch` could change
the answer. Nothing can push a stash, so for one the strong claim is simply true.

**Exposure for a tag-only file is hedged, not guessed.** *Why:* this clone cannot see
which tags were pushed, and the alternative is a network call. The reassurance "it
probably never left your machine" is withdrawn for that case, in favour of "treat it as
pushed if you ever ran `git push --tags`". Erring toward rotation is the safe direction.

**Stash findings still fail the run.** *Why:* the file is on the machine and one
`git stash pop` away from being committed. Exit 1 ("problems, nothing pushed") still
describes it exactly.

**Terraform state is a credential, not a data file.** *Why:* `*.tfstate` routinely records
provider credentials and generated passwords in plain text. The data category exists for
things that cannot be rotated, and tfstate secrets can be — so it belongs with the
failures, not the warnings.

**An unreachable commit is a finding, not a footnote.** *Why:* "I amended it away" and "I
deleted that branch" are things people genuinely believe fixed the problem. The object is
still on disk and `git fsck` still finds it, so a tool that reports a clean repo there is
telling the user something false.

**Unreachable findings are hedged about being pushed, unlike stashes.** A stash can never
have been pushed. An unreachable commit *could* have been, and then force-pushed away —
the remote-tracking ref would no longer contain it, so this clone cannot tell. The guide
says "probably never pushed" and names force-pushing as the case to think about.

**fsck failing is a limit, not a silent skip.** *Why:* the whole point of the scope check
is that a clean result you cannot trust is worse than no result. If the unreachable search
could not run, that is exactly such a case.

**The framework arrives in stages, and the first stage changes nothing.** *Why:* the three
v0.2 fix rounds each found advice that was confidently wrong, and the test suite is now the
record of every one of those cases. A big-bang rewrite risks re-breaking them silently. A
mechanical split first means every later stage is a reviewable diff against code that is
already in its final home, and "no behaviour change" is something that can be *checked*
(the side-by-side run) rather than asserted.

**`checks.js` keeps its name through the split.** *Why:* it is what `cli.js` and 47 tests
import. Renaming it to `index.js` now would make the split touch the tests, and the point
of stage 0 is that it does not. The rename happens in stage 1, when the import surface
genuinely changes.

**Severity and status are two axes.** `severity` (`blocker` / `warning` / `info`) is a
fixed property of a check; `status` (`pass` / `warn` / `fail` / `unknown` / `acknowledged` /
`skip`) is what happened on this run. Every finding carries both, so "this check is a
blocker, and it passed" is expressible — which `--strict`, `--json` and the verdict line
all rely on. *History:* until v0.3.1 the code had only one field, named `status` but used
as a severity; the conflation was easy to mistake for a naming quibble.

**The fence runs in tests, not in production.** *Why:* an undeclared read is a programming
error, and the right time to fail is when the suite runs, not when someone checks a repo
full of secrets. The trade-off is honest: a `reads` list can only drift along a code path
the tests exercise, so the fencing test deliberately uses a repo where every check does
real work.

**The snapshot decides what may be opened, not each check.** *Why:* "never open a file that
could hold a secret" was previously a promise kept by every check individually, and
checkable only by reading them all. One allowlist in one file turns it into something a
new check cannot get wrong by accident.

**First category to match wins.** Ordered list, so `.env` is a credential rather than a
data file. Simpler than multi-category matching and right in every case we have.

**The default line shows one branch, not all of them.** The branch you're on if it
contains the file, otherwise the first, with `+N` if there are more. *Why:* a long branch
list buries the part that matters. `--history` has the full list.

**Items 2 and 3 were built together.** *Why:* the default line has to say whether a file
left the machine, and that is item 3's question. Item 3 is now only about wording.

**Acknowledged findings stay on screen.** They keep their own status and icon, show the
reason, and are counted separately in the summary — they are not filtered out. *Why:* the
point is to record that someone decided, not to make the finding vanish. A hidden finding
is indistinguishable from a check that never ran.

**Acknowledgement is per exact path.** No globs. *Why:* a glob is easy to write too
broadly and would quietly cover files added later. Worth revisiting if it proves annoying.

**Exit code 2 is driven by failing checks only.** A pushed *database* is a warning, not a
failure, so it does not produce exit 2. *Why:* consistent with data findings needing
judgement rather than a standard fix. Revisit if it feels too quiet.

**Usage errors moved from exit 2 to 64.** *Why:* exit 2 now means "something was pushed",
and the two must not collide. 64 is the conventional `EX_USAGE`.

**The guide prints once, not per finding.** *Why:* repeating three steps under every
finding would bury the findings. Each finding gets one short line pointing at it.

**The guide is built in `guide.js`, not the CLI.** *Why:* which step applies is a
judgement about the findings, not about formatting, and it can be tested without
running the CLI. The CLI only decides indentation and colour.

**`unknown` doesn't change the exit code.** *Why:* making a shallow clone fail the run
would break every CI using a default `actions/checkout`. It's printed clearly instead, so
it can't be mistaken for a pass.

**Privacy boundary (24 Oct 2026).** Two changes, kept identical in README.md and ROADMAP.md:
- Commit hashes and ref names are read; commit authors, emails, messages and **dates** are
  not. v0.2 item 2 lost "when it was added" as a result.
- Ordinary project files may be opened when a check needs them (README, LICENSE,
  `.gitignore`, and metadata like `package.json`). Files that could hold secrets or
  personal data are never opened.

---

## Known gaps

What pushready knowingly does not do, as of 0.3.6. Each is a limit, not a bug: the ones
that were bugs are in the dated log above with their fixes.

- **Patterns match on the file name only**, not the path, so `.aws/credentials`,
  `.kube/config` and `.ssh/config` cannot be written as rules — the bare name `config` is
  far too common to match on. `kubeconfig` as a single file is covered; the directory
  forms are not. Extending `test` to take the path is small now that the check interface
  exists.
- **Tracked risky files are found only because the history checks include tracked files.**
  If that ever changed, a tracked `deploy.pem` would fall through: `env-tracked` only knows
  about `.env`.
- **A shallow clone prints three "could not be checked" lines**, one per category. Correct,
  but repetitive.
- **Locating a finding costs two git processes per risky path** (`for-each-ref --contains`
  and `merge-base --is-ancestor`), plus rename grouping when something was found. Measured
  1 Nov 2026: 1 finding is 17 processes, 100 findings is 215 and 3.2 s. It grows with
  findings, not repository size; `test/scale.test.js` pins both facts. Batching by commit
  is in ROADMAP's "Large repositories".
- **Copies are not followed, only renames.** `cp secret.pem backup.pem && git add` is two
  independent adds of the same content; git only reports that as a copy under `-C`, which
  is off by default and expensive. If the copy's name is risky it is found on its own; if it
  isn't, the content persists under it after a cleanup. The thorough fix is blob-level
  (`git rev-list --all --objects`), which would also catch the same secret committed twice.
- **A secret renamed *and* edited in the same commit is not linked.** Git's rename detection
  scores it below the default 50% similarity, so both names are found as separate findings
  (no under-detection) but the alias explanation won't connect them.
- **Only the first commit that added a path is looked at.** A file deleted and re-added on a
  different branch reports the earliest add. Correct for "is this in history", but
  `--history` could under-report branches in that case.
- **Files inside a committed dependency tree are not matched individually.** Deliberate: a
  `.pem` in `node_modules` or a venv is almost always a CA bundle or a test fixture, and the
  finding that matters is that the tree was committed. The fix text says so. The cost is
  that a real key hidden inside one would be reported only once the tree is untracked.
- **Deliberately left out:** `*.sql`, `*.bak`, `*.dump` (usually legitimate files),
  `.npmrc` and `.pypirc` (usually just registry config), a bare `vendor/` or `bin/` (often
  the project's own files; only marker files such as `vendor/autoload.php` count).
- **Already-collected commits cannot be found, and their absence proves nothing.** Once
  `git gc` has pruned an unreachable object it is gone from this clone — the desired
  outcome, but also why a clean run is not evidence that nothing was ever there. Stated in
  the README rather than reported.
- **`git fsck` cost is untested at scale.** 45 ms on 600 files with `--connectivity-only`,
  but it scales with total object count. A monorepo with millions of objects may make it
  the slowest part of a run; `--skip history-scope,history-keys,history-credentials,history-data`
  is the opt-out today.
- **A pushed tag cannot be detected, only hedged.** Nothing local records which tags were
  pushed, so a file only on a tag is reported "not on a remote" with the advice to treat it
  as pushed if `git push --tags` was ever run. The real answer needs `git ls-remote
  --tags`, a network call, and is out of scope.
- **Submodules are declared, not looked into.** A risky file inside one is invisible from
  the parent; the scope check says so and suggests running pushready inside each.
- **Acknowledgement matches exact paths only**, so a folder of fixtures has to be listed
  file by file. A deliberately committed dependency tree is the exception: it is
  acknowledged by its root folder, because that is what the finding names.
- **Very large repositories are tested by simulation, not by size.** Repository size is
  pinned not to change the process count up to 600 files, and the overflow path is tested
  by lowering `PUSHREADY_MAX_BUFFER` to 256 bytes rather than by building a 64 MB history.
  A real monorepo has not been run.
- **Windows console rendering.** The `✔ ✖ ! ? -` icons are UTF-8. In a `cmd.exe` window
  with a legacy code page they may show as `?`; Windows Terminal, PowerShell 7 and every CI
  log render them. `--json` sidesteps it entirely.
