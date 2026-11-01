// Findings the user has looked at and accepted, from .pushready.json in the repo
// being checked. They stay visible; they just stop failing the run.
//
// The file, in full:
//
//   { "version": 1, "acknowledge": [ "path", { "path": "path", "reason": "why" } ] }
//
// `version` is optional and means 1 when absent. A file written for a newer
// pushready says so in `version`; this one still applies what it understands and
// warns. Nothing else lives here in v0.3: turning checks off, changing a
// severity or ignoring paths are per-run flags (--only, --skip, --strict), not
// config, because a config that silences a check hides it from everyone who
// reads the CI output, while a flag is visible in the command that ran.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ACK_FILE = '.pushready.json';
export const CONFIG_VERSION = 1;

const empty = (error = null, version = CONFIG_VERSION) => ({ map: new Map(), error, version });

export function readAcknowledgements(dir) {
  const path = join(dir, ACK_FILE);
  if (!existsSync(path)) return empty();
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Our own wording, not the one JSON.parse produced. Node changed that text in
    // v20 and again in v24, and only some versions include a position, so a
    // message built from it read differently depending on which Node someone
    // had installed. The Windows run on Node 24 is what caught this.
    return empty('it is not valid JSON');
  }
  // Valid JSON of the wrong shape used to parse, acknowledge nothing and say
  // nothing, so a failing run gave no hint that the file was the reason.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return empty(`expected an object like { "acknowledge": [ ... ] }, got ${Array.isArray(parsed) ? 'a list' : JSON.stringify(parsed)}`);
  }
  const version = parsed.version === undefined ? CONFIG_VERSION : parsed.version;
  if (parsed.acknowledge !== undefined && !Array.isArray(parsed.acknowledge)) {
    return empty(`"acknowledge" should be a list of paths, got ${JSON.stringify(parsed.acknowledge)}`, version);
  }
  const map = new Map();
  for (const entry of parsed.acknowledge ?? []) {
    if (typeof entry === 'string') map.set(entry, '');
    else if (entry && typeof entry.path === 'string') map.set(entry.path, typeof entry.reason === 'string' ? entry.reason : '');
  }
  return { map, error: null, version };
}
