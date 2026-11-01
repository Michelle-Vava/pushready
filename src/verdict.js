// The exit code and the one-line verdict, decided in one place so the text
// report, --json and the tests cannot disagree.
//
// The contract (also in --help):
//
//   0   nothing to fix, or everything found was acknowledged
//   1   problems found, but nothing has been pushed from this clone
//   2   problems found, and at least one was already pushed — rotate first
//   64  pushready was used wrongly; decided in cli.js before any check runs
//
//   --strict   a warning, or a check that could not run ("unknown"), is enough
//              for exit 1. Without it they never change the code, because
//              "could not check" is not "found a problem".
//   --skip     a skipped check is not run, so it cannot affect the code. The
//              policy pass still runs, so skipping the check that would have
//              reported a path hands that path to the next check that saw it.
//   --only     the same, for every check not named.
//   --json     never changes the code; it changes only how the result is shown.
//
// The verdict line agrees with the code by construction: "yes" is exit 0.
export function verdict(results, { strict = false } = {}) {
  const count = (status) => results.filter((r) => r.status === status).length;
  const blockers = count('fail');
  const warnings = count('warn');
  const unknown = count('unknown');
  const acknowledged = count('acknowledged');
  const skipped = count('skip');
  const pushed = results.some((r) => r.status === 'fail' && r.items.some((i) => i.exposure === 'pushed' && !i.acknowledged));
  const exit = blockers ? (pushed ? 2 : 1) : strict && (warnings || unknown) ? 1 : 0;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  let line;
  if (exit === 0) {
    line = 'Ready to make public: yes';
    const qualifiers = [];
    if (acknowledged) qualifiers.push(`${acknowledged} acknowledged`);
    if (unknown) qualifiers.push(`${unknown} could not be checked`);
    if (qualifiers.length) line += unknown ? `, as far as could be checked (${qualifiers.join(', ')})` : ` (${qualifiers.join(', ')})`;
  } else {
    const reasons = [];
    if (blockers) reasons.push(plural(blockers, 'blocker'));
    if (strict && warnings) reasons.push(plural(warnings, 'warning'));
    if (strict && unknown) reasons.push(`${unknown} could not be checked`);
    line = `Ready to make public: no (${reasons.join(', ')}${strict && !blockers ? ', --strict' : ''})`;
    if (pushed) line += ' — something was pushed, rotate first';
  }
  return { ready: exit === 0, exit, blockers, warnings, unknown, acknowledged, skipped, pushed, strict, line };
}
