// The policy pass: what applies across checks, after they have run and before
// anything is reported.
//
// Two rules live here, and only here.
//
// Dedupe: a path is reported once, by the first check (in registration order)
// that found it. A committed .env is found by env-tracked and would be found
// again by history-credentials; the second report is dropped, and the check it
// was dropped from says so ("No other credential files"). Doing this here rather
// than inside a check means a check that is not run — `--skip env-tracked`, in
// v0.3.2 — leaves its finding to the next one instead of hiding it.
//
// Acknowledgement: .pushready.json applies to every check with items, so a
// fixture .env or a vendored node_modules can be accepted, not just a file in
// history. The pass marks items; each check's `summarise` decides what that
// means for its own status and heading.
import { finding } from './finding.js';

export function applyPolicy(results, snap, checks) {
  const acks = snap.acks().map;
  const byId = new Map(checks.map((c) => [c.id, c]));
  const reported = new Set();
  return results.map((r) => {
    const check = byId.get(r.id);
    // A skipped check never ran, so there is nothing to re-summarise — and its
    // summarise() would ask the snapshot questions a non-repository cannot answer.
    if (r.status === 'skip' || !check?.summarise) return r;
    const items = r.items
      .filter((i) => !reported.has(i.path))
      .map((i) => ({ ...i, acknowledged: acks.has(i.path), reason: acks.get(i.path) ?? '' }));
    for (const i of r.items) reported.add(i.path);
    const deferred = r.items.length - items.length;
    return finding(check, check.summarise(items, snap, { acks, deferred }));
  });
}
