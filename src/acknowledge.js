// Findings the user has looked at and accepted, from .pushready.json in the repo
// being checked. They stay visible; they just stop failing the run.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ACK_FILE = '.pushready.json';

export function readAcknowledgements(dir) {
  const path = join(dir, ACK_FILE);
  if (!existsSync(path)) return { map: new Map(), error: null };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const map = new Map();
    for (const entry of Array.isArray(parsed.acknowledge) ? parsed.acknowledge : []) {
      if (typeof entry === 'string') map.set(entry, '');
      else if (entry && typeof entry.path === 'string') map.set(entry.path, typeof entry.reason === 'string' ? entry.reason : '');
    }
    return { map, error: null };
  } catch (error) {
    return { map: new Map(), error: error.message };
  }
}
