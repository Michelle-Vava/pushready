// The one shape every check's result has. Documented here, built here, and held
// to by the test suite ("every finding has exactly these keys"), so that --json
// consumers and the text renderer are reading the same thing.
//
//   {
//     id:       'history-keys'            which check, stable across releases
//     title:    'Private keys in history' for headings and --only / --skip help
//     severity: 'blocker' | 'warning' | 'info'
//                                         how bad the check is when it fires;
//                                         fixed per check, never changes per run
//     status:   'pass' | 'warn' | 'fail' | 'unknown' | 'acknowledged' | 'skip'
//                                         what happened on this run
//     message:  'No private key files in git history'
//     fix:      'Run "git rm --cached ..."' or null when there is nothing to do
//     items:    []                        one entry per risky path, see ITEM_KEYS;
//                                         empty for checks that have no paths
//   }
//
// severity and status are two axes on purpose: "a blocker that passed" is
// { severity: 'blocker', status: 'pass' }. See patterns.js.
export const SEVERITIES = ['blocker', 'warning', 'info'];
export const STATUSES = ['pass', 'warn', 'fail', 'unknown', 'acknowledged', 'skip'];
export const FINDING_KEYS = ['id', 'title', 'severity', 'status', 'message', 'fix', 'items'];

// One risky path: where it lives, how exposed it is, and what the user said
// about it. Built by snapshot.describe plus the policy pass; never partial.
export const ITEM_KEYS = [
  'path', // repository-relative
  'present', // still in the working tree
  'commit', // the commit that first added this name, '' when unknown
  'branch', // the one branch named in the short output
  'branches',
  'remotes',
  'tags',
  'refs', // refs other than branches, tags and stashes that hold it
  'stashes', // 'stash@{n}' entries, when nothing else holds it
  'place', // 'branch' | 'tag' | 'ref' | 'head' | 'stash' | 'unreachable' | 'unknown'
  'onCurrentBranch', // the checked-out branch is one of those holding it, so
  //                    "not in the working tree" means deleted rather than elsewhere
  'exposure', // 'local only' | 'not on a remote' | 'pushed'
  'aliases', // other names the same content was committed under
  'kind', // 'credential' | 'data', what the guide groups by
  'ignored', // listed in .gitignore
  'acknowledged',
  'reason', // from .pushready.json, '' when none given
];

/** A complete finding for `check` from whatever partial result it produced. */
export function finding(check, partial) {
  return {
    id: check.id,
    title: check.title,
    severity: check.severity,
    status: partial.status,
    message: partial.message,
    fix: partial.fix ?? null,
    items: partial.items ?? [],
  };
}
