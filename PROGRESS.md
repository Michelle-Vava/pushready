# Progress

Working log for pushready, updated as we go. [ROADMAP.md](ROADMAP.md) is the plan;
this file is where we are in it, and why things were decided the way they were.

**Now working on:** v0.2, Git-history exposure — one roadmap item at a time.

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

---

## In progress

Nothing — v0.2 is finished and waiting on review.

---

## Pending

Next version is **v0.3: check framework and structured findings**. See ROADMAP.md.

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

**The guide is built in `checks.js`, not the CLI.** *Why:* which step applies is a
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
- **Three git calls per risky file** (the adding commit, local branches, remote branches).
  Fine at current sizes — the `large` scenario checks in about 300 ms — but it grows with
  the number of findings, not the size of the repo. Revisit if a repo ever reports dozens.
- **Only the first commit that added a path is looked at.** A file deleted and re-added on
  a different branch reports the earliest add. Correct for "is this in history", but
  `--history` could under-report branches in that case.
- **Deliberately left out for now:** `*.sql`, `*.bak`, `*.dump` (usually legitimate files),
  `.npmrc` and `.pypirc` (usually just registry config). `kubeconfig`, `terraform.tfstate`,
  `*.jks`, `*.keystore`, `*.ppk` and `.pgpass` are good candidates when we expand.
- **`.ENV` in capitals is missed.** The category patterns are case-insensitive, but
  `isEnvFile` is not, so an uppercase `.ENV` escapes both `env-tracked` and
  `history-credentials`. Matters on Windows and macOS. Small fix, not yet made.
- **Stashes are included, and the advice for them is wrong.** `git log --all` covers
  `refs/stash`, so a stashed secret is found — useful — but it reports as
  "on no branch" and the guide suggests `git filter-repo` when `git stash drop` is
  the right answer.
- **Unreachable commits are invisible.** A secret in a commit that was amended away or
  on a deleted branch is still in the object store and still recoverable, but it is not
  reachable from any ref, so `git log --all` never sees it. `git fsck --unreachable`
  would find these.
- **Acknowledgement matches exact paths only**, so a folder of fixtures has to be listed
  file by file.
- **"Big repo" is only tested to 600 files over 40 commits.** Real monorepos are orders of
  magnitude larger, and the history walk grows with commits × changed files.
