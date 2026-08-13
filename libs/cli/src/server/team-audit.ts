/**
 * The team's agent-action audit log — "what did THING do, and who asked".
 *
 * Every consequential thing THING does in a team (post into a channel, pin an
 * app, create a channel, rewrite channel memory) appends one attributed row
 * here, so an editor can answer "who had THING announce that / make that channel"
 * after the fact. It is append-only JSONL at `<lmthingRoot>/.team/audit.jsonl`,
 * beside the other team logs.
 *
 * `actor` is a plain string, deliberately: today it is the userId of the member
 * whose message drove the turn (the caller the resolver is bound to — the same
 * identity every team write is already attributed to). When a real THING
 * principal exists, an ambient/scheduled action records `actor: 'thing'` here
 * with no change to readers.
 *
 * Parsing/serialization is pure and tolerant so a single corrupt line never
 * loses the rest of the log or throws — the same discipline as team-memory.ts.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { teamDir } from './team-channels.js';

/** One thing THING did, attributed to whoever asked. */
export interface AuditEntry {
  /** ISO timestamp of the action. */
  ts: string;
  /** Who drove the turn — a member's userId today, `'thing'` for a future ambient action. */
  actor: string;
  /** The directory label of the actor, denormalized so a reader need not re-resolve it. */
  actorLabel?: string;
  /** The channel the turn ran in. */
  channelId: string;
  /** What kind of action — `post` | `pinApp` | `createChannel` | `remember` | … */
  action: string;
  /** A short, human-readable specifics string (e.g. "to #design", "3 facts"). */
  detail?: string;
}

function auditPath(root: string): string {
  return join(teamDir(root), 'audit.jsonl');
}

/** Serialize one entry to its JSONL line (no trailing newline). Pure. */
export function serializeAudit(entry: AuditEntry): string {
  return JSON.stringify(entry);
}

/**
 * Parse a JSONL audit blob into entries, dropping any line that is blank or does
 * not parse into a well-formed entry. Tolerant: a corrupt line costs that line,
 * not the log.
 */
export function parseAuditLog(raw: string | undefined): AuditEntry[] {
  if (typeof raw !== 'string' || !raw) return [];
  const out: AuditEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Partial<AuditEntry>;
      if (
        obj &&
        typeof obj.ts === 'string' &&
        typeof obj.actor === 'string' &&
        typeof obj.channelId === 'string' &&
        typeof obj.action === 'string'
      ) {
        out.push({
          ts: obj.ts,
          actor: obj.actor,
          channelId: obj.channelId,
          action: obj.action,
          ...(typeof obj.actorLabel === 'string' ? { actorLabel: obj.actorLabel } : {}),
          ...(typeof obj.detail === 'string' ? { detail: obj.detail } : {}),
        });
      }
    } catch {
      // skip the corrupt line
    }
  }
  return out;
}

/** Append one audit row. Best-effort — an audit failure must never fail the action. */
export async function appendAudit(root: string, entry: AuditEntry): Promise<void> {
  await mkdir(teamDir(root), { recursive: true });
  await appendFile(auditPath(root), `${serializeAudit(entry)}\n`, 'utf8');
}

export interface AuditQuery {
  /** Only actions in this channel. */
  channelId?: string;
  /** Only actions by this actor (a userId, or `'thing'`). */
  actor?: string;
  /** Only this action kind. */
  action?: string;
  /** Cap the number returned (newest first). Default 200. */
  limit?: number;
}

/**
 * Read the audit log, newest first, filtered by `query`. Returns at most
 * `limit` entries (default 200). Tolerant of a missing file (returns `[]`).
 */
export async function readAudit(root: string, query: AuditQuery = {}): Promise<AuditEntry[]> {
  let raw: string | undefined;
  try {
    raw = await readFile(auditPath(root), 'utf8');
  } catch {
    return [];
  }
  const all = parseAuditLog(raw);
  const filtered = all.filter(
    (e) =>
      (query.channelId === undefined || e.channelId === query.channelId) &&
      (query.actor === undefined || e.actor === query.actor) &&
      (query.action === undefined || e.action === query.action),
  );
  // Newest first: the log is appended oldest-to-newest, so reverse, then cap.
  filtered.reverse();
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 1000);
  return filtered.slice(0, limit);
}
