# Progress

Working log for pushready, updated as we go. [ROADMAP.md](ROADMAP.md) is the plan;
this file is where we are in it, and why things were decided the way they were.

**Now working on:** v0.3, as point releases. **v0.3.0 is cut** (module split + shared
snapshot, no behaviour change). **v0.3.1 is next:** fix the gaps a review of v0.3.0 found,
before any new feature is built on top of them. ROADMAP.md has each release's criteria.

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

---

## In progress

**v0.3.1 — close the gaps.** Not started. Eleven items, listed above and in ROADMAP.md,
each needing a test that fails first. No new flag, check or output format. The
side-by-side comparison against v0.3.0 is the acceptance test: it should differ only in
the lines the fixes intentionally change, and that list goes here when the work is done.

---

## Pending

v0.3.2 (registry metadata, finding schema, `--only` / `--skip`, the exit-code contract,
versioned `.pushready.json`), v0.3.3 (`--json`, `--quiet`, `--strict`, verdict), v0.3.4
(remedies as rules), v0.3.5 (fix plans as data). Each has its own "Done when" in ROADMAP.md,
and v0.3 as a whole has one at the end of that section.

---

## Decisions

**The rule for what counts as a risky file.** A filename commonly used for secrets or
personal data is flagged even though pushready can't confirm what's inside. Findings are
worded as a prompt to go and check, never as proof of a leak, and names that are public by
convention are excluded. *Why:* it keeps the check honest about working from names alone,
which is what the privacy boundary requires.

**Categories are separate checks, not labels on one check.** *Why:* they need different
severities. A leaked key is a blocker; a committed database needs judgement. One combined
check would have to collapse those into a single status. Separate ids also make them
individually skippable when v0.3 adds `--only` / `--skip`.

**Database files warn rather than fail.** *Why:* unlike a key, leaked data can't be
rotated, so there's no standard fix to point at. It needs the user to look at what's in it.

**History checks cover files still in the repo, not just deleted ones.** *Why:* `git rm`
doesn't remove a file from history, so "still in the repo" is the worse case, not an
exemption. Reported with a `(still in the repo)` marker. The one exception is a tracked
`.env`, which `env-tracked` already reports — it isn't repeated.

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

**Severity and status are two axes, and the code currently has only one.**
`RISKY_CATEGORIES[].status` is `'fail'` or `'warn'` — that is *severity*, a fixed property
of the check, but it is named and used as *status*, which is what happened on this run.
The six statuses the CLI renders (`pass` / `warn` / `fail` / `unknown` / `acknowledged` /
`skip`) are the second axis. *Why it matters now:* there is no way to express "this check
is a blocker, and it passed", which `--strict`, the JSON schema and the verdict line all
need. Splitting them is stage 2 work, recorded here because the conflation is easy to
mistake for a naming quibble.

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

- **Tracked risky files outside history.** Covered, but only because the history checks
  include tracked files. If that ever changes, a tracked `deploy.pem` would fall through:
  `env-tracked` only knows about `.env`.
- **Patterns match on the file name only**, not the path, so a rule like `.aws/credentials`
  isn't expressible yet. The matcher needs extending when we want one.
- **A shallow clone prints three "could not be checked" lines**, one per category. Correct,
  but repetitive. Worth revisiting if more categories are added.
- **Two git calls per risky file** (the adding commit, then one `for-each-ref --contains` for everything holding it — down from three), plus one `merge-base` per stash entry when nothing else holds it.
  Fine at current sizes — the `large` scenario checks in about 300 ms — but it grows with
  the number of findings, not the size of the repo. Revisit if a repo ever reports dozens.
- **Copies are not followed, only renames.** `git cp` isn't a thing, but `cp secret.pem
  backup.pem && git add` produces two independent adds of the same content, and git only
  reports that as a copy under `-C`, which is off by default and expensive. If the copy's
  name is risky it is still found on its own; if it isn't, the content persists under it
  after a cleanup. Same failure shape as the rename bug, narrower trigger. The thorough
  fix for both is blob-level: `git rev-list --all --objects` maps every object to the paths
  it appears under, which would catch copies, renames and the same secret committed twice
  in unrelated places — at the cost of walking every object in the repo.
- **A secret renamed *and* edited in the same commit is not linked.** Git's rename
  detection scores it below the default 50% similarity and reports an add plus a delete, so
  both names are found as separate findings (no under-detection) but they are not known to
  be the same file, and the alias explanation won't mention them.
- **Rename grouping costs extra git calls.** One history walk with detection on, plus one
  `branch -r --contains` per alias for the exposure union. Only paid when something risky
  was found, but it compounds the per-finding cost noted below.
- **Only the first commit that added a path is looked at.** A file deleted and re-added on
  a different branch reports the earliest add. Correct for "is this in history", but
  `--history` could under-report branches in that case.
- **Deliberately left out for now:** `*.sql`, `*.bak`, `*.dump` (usually legitimate files),
  `.npmrc` and `.pypirc` (usually just registry config).
- **Path-based patterns are still not expressible.** The matcher sees the file name only,
  so `.aws/credentials`, `.kube/config` and `.ssh/config` cannot be written as rules — the
  bare name `config` is far too common to match on. `kubeconfig` as a single file is
  covered; the directory forms are not. Extending `test` to take the path as well as the
  name is small, and worth doing with the v0.3 check interface rather than before it.
- **Already-collected commits cannot be found, and their absence proves nothing.** Once
  `git gc` has pruned an unreachable object it is genuinely gone from this clone, which is
  the desired outcome — but it also means a clean run is not evidence that nothing was
  ever there. Not reportable: there is nothing left to detect. Stated in the README
  instead.
- **`git fsck` cost is untested at scale.** 45 ms on the `large` scenario (600 files, 40
  commits) with `--connectivity-only`, but it scales with total object count, not with
  history depth. A monorepo with millions of objects may make it the slowest part of a
  run. No timeout or opt-out yet; `--skip history-*` in v0.3 would be the natural place.
- **A pushed tag cannot be detected, only hedged.** Remote-tracking branches record what
  was pushed; nothing local records which tags were. So a file only on a tag is reported
  as "not on a remote" with a warning that this clone cannot know, and advice to treat it
  as pushed if `git push --tags` was ever run. The real answer needs `git ls-remote
  --tags`, which is a network call and out of scope.
- **Submodules are still not looked into**, only declared. `git ls-files` and `git log`
  stop at the boundary, so a risky file inside one is invisible from the parent; the scope
  check now says so and suggests running pushready inside each submodule. Recursing would
  mean treating each as its own repo with its own findings and exit code.
- **Acknowledgement matches exact paths only**, so a folder of fixtures has to be listed
  file by file.
- **"Big repo" is only tested to 600 files over 40 commits.** Real monorepos are orders of
  magnitude larger, and the history walk grows with commits × changed files.
