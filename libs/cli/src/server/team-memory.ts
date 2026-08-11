/**
 * Durable, per-channel memory for THING — the "learns the channel over time"
 * half of the team surface.
 *
 * Distinct from a thread's session snapshot, which is ephemeral and dies with the
 * conversation: this is a small, channel-scoped note THING keeps and re-reads at
 * the start of a later turn in the SAME channel, so a fact stated on Monday is
 * still known on Friday without anyone restating it. It lives beside the other
 * team logs at `<lmthingRoot>/.team/memory/<channelId>.json`.
 *
 * The shape is deliberately the simplest thing that accumulates: a flat list of
 * short fact strings, rewritten whole (the `todoWrite` model — add/remove/reword
 * is one write of the full list), and BOUNDED. Unbounded memory is a slow leak
 * that eventually eats the turn's context and the disk; the cap is enforced here,
 * in {@link sanitizeFacts}, not left to the agent's good behaviour.
 *
 * Pure logic (parse, sanitize, cap) is separated from the two fs calls so the
 * bounds are unit-tested without a pod — the same split that makes
 * `libs/core/src/session/plan-reminders.ts` testable.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { teamDir } from './team-channels.js';

/** What THING durably knows about one channel. */
export interface ChannelMemory {
  /** Short notes, most-recent-intent last. Bounded by {@link MAX_FACTS}. */
  facts: string[];
  /** ISO time of the last write, for the admin/audit surface. Absent until first write. */
  updatedAt?: string;
}

/** At most this many facts survive a write — the rest are dropped, newest kept. */
export const MAX_FACTS = 50;
/** A single fact longer than this is truncated: a "fact" that is a document is a bug. */
export const MAX_FACT_LEN = 500;

/**
 * The stored, bounded fact list for a proposed write. Pure: filters to non-empty
 * trimmed strings, truncates each to {@link MAX_FACT_LEN}, de-duplicates
 * (order-preserving), and keeps only the LAST {@link MAX_FACTS} — the newest,
 * since the agent appends as it learns. Tolerates junk (`undefined`, a non-array,
 * non-string entries) by dropping it, so a malformed model write can never throw
 * or persist garbage.
 */
export function sanitizeFacts(facts: unknown): string[] {
  if (!Array.isArray(facts)) return [];
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const f of facts) {
    if (typeof f !== 'string') continue;
    const trimmed = f.trim().slice(0, MAX_FACT_LEN);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    clean.push(trimmed);
  }
  // Keep the newest when over budget: the agent appends what it just learned, so
  // the tail is the freshest context.
  return clean.length > MAX_FACTS ? clean.slice(clean.length - MAX_FACTS) : clean;
}

/** Parse persisted memory, tolerating a missing file, bad JSON, or a junk shape. */
export function parseChannelMemory(raw: string | undefined): ChannelMemory {
  if (typeof raw !== 'string') return { facts: [] };
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object') return { facts: [] };
    const facts = sanitizeFacts((obj as { facts?: unknown }).facts);
    const updatedAt = (obj as { updatedAt?: unknown }).updatedAt;
    return typeof updatedAt === 'string' ? { facts, updatedAt } : { facts };
  } catch {
    return { facts: [] };
  }
}

/**
 * A channel id, guarded against escaping the memory directory. Channel ids are
 * already validated where they enter the system (`isValidChannelId`), but this
 * function is the one that turns an id into a filesystem path, so it refuses a
 * separator or a dotted segment rather than trust its caller.
 */
function memoryPath(root: string, channelId: string): string {
  if (!channelId || channelId.includes('/') || channelId.includes('\\') || channelId.includes('..')) {
    throw new Error(`invalid channel id for memory: ${channelId}`);
  }
  return join(teamDir(root), 'memory', `${channelId}.json`);
}

/** This channel's durable memory, or an empty one when nothing has been stored yet. */
export async function readChannelMemory(root: string, channelId: string): Promise<ChannelMemory> {
  // Resolve the path FIRST, outside the catch: a traversal attempt is a hard error
  // on read exactly as on write, not a swallowed "no memory here".
  const path = memoryPath(root, channelId);
  let raw: string | undefined;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    raw = undefined;
  }
  return parseChannelMemory(raw);
}

/**
 * Replace this channel's memory with `facts` (sanitized + bounded) and stamp
 * `updatedAt`. Whole-list rewrite; returns what was actually persisted so the
 * caller can report the real count after capping/dedup.
 */
export async function writeChannelMemory(
  root: string,
  channelId: string,
  facts: string[],
  nowIso: string,
): Promise<ChannelMemory> {
  const path = memoryPath(root, channelId);
  await mkdir(join(teamDir(root), 'memory'), { recursive: true });
  const mem: ChannelMemory = { facts: sanitizeFacts(facts), updatedAt: nowIso };
  await writeFile(path, JSON.stringify(mem, null, 2), 'utf8');
  return mem;
}
