/**
 * Team channels — the Slack-like chat surface a team talks in (design/teams.md).
 *
 * Channels live on the TEAM's own pod, next to the projects and spaces THING
 * works on, so calling THING in a thread needs no cross-service hop: it is the
 * same `runHeadlessThreaded` the inbound-webhook dispatcher already uses, keyed
 * by (channel, thread). That is what makes THING remember a thread across
 * messages — and across members, since the thread, not the person, owns the
 * session.
 *
 * On disk, under `<lmthingRoot>/.team/`:
 *
 *   .team/channels.json                 [{ id, name, createdBy, createdAt }]
 *   .team/channels/<channelId>.jsonl    one message per line, append-only
 *   .team/.data/webhook-threads.json    threadRootId → THING's sessionId
 *
 * A dot-directory, so it is never mistaken for a project (`listProjects` only
 * accepts a dir containing `project.json`). It rides along in GitHub workspace
 * backups for free, since the backup work-tree is the whole runtime root.
 *
 * Append-only JSONL rather than a database: a channel is a log, reads are
 * overwhelmingly "the last N", and a partially-written trailing line can be
 * dropped without losing history.
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export const TEAM_DIR = '.team';
/** Seeded on first use so a new team has somewhere to talk immediately. */
export const DEFAULT_CHANNEL = { id: 'general', name: 'general' };

export interface Channel {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

/** Who or what produced a message. */
export type MessageKind = 'user' | 'thing' | 'system';

export interface ChannelMessage {
  id: string;
  ts: string;
  channelId: string;
  kind: MessageKind;
  text: string;
  /** The member who sent it (absent for `thing`/`system`). */
  userId?: string;
  email?: string;
  /** The id of the message that opened this thread; absent for a channel-level post. */
  threadId?: string;
  /** For `thing` messages: the session the reply came from. */
  sessionId?: string;
}

export function teamDir(root: string): string {
  return join(root, TEAM_DIR);
}
function channelsFile(root: string): string {
  return join(teamDir(root), 'channels.json');
}
function channelLog(root: string, channelId: string): string {
  return join(teamDir(root), 'channels', `${channelId}.jsonl`);
}

/** Channel ids appear in a file path, so keep them to a safe, stable shape. */
export function isValidChannelId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

/** Derive a channel id from a display name (`Product Design` → `product-design`). */
export function channelIdFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

// ─── Channels ────────────────────────────────────────────────────────────────

export async function listChannels(root: string): Promise<Channel[]> {
  let text: string;
  try {
    text = await readFile(channelsFile(root), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (c): c is Channel =>
        !!c && typeof c === 'object' && typeof (c as Channel).id === 'string',
    );
  } catch {
    return [];
  }
}

async function saveChannels(root: string, channels: Channel[]): Promise<void> {
  await mkdir(teamDir(root), { recursive: true });
  await writeFile(channelsFile(root), JSON.stringify(channels, null, 2), 'utf8');
}

/**
 * Ensure the team has at least one channel. Called on first read so a fresh
 * team pod is immediately usable rather than showing an empty shell.
 */
export async function ensureDefaultChannel(root: string): Promise<Channel[]> {
  const existing = await listChannels(root);
  if (existing.length > 0) return existing;
  const channel: Channel = {
    ...DEFAULT_CHANNEL,
    createdBy: 'system',
    createdAt: new Date().toISOString(),
  };
  await saveChannels(root, [channel]);
  return [channel];
}

/** Create a channel. Returns the existing one if the id is already taken. */
export async function createChannel(
  root: string,
  name: string,
  createdBy: string,
): Promise<{ channel: Channel; created: boolean }> {
  const id = channelIdFromName(name);
  if (!isValidChannelId(id)) {
    throw new Error(`invalid channel name: ${JSON.stringify(name)}`);
  }
  const channels = await listChannels(root);
  const existing = channels.find((c) => c.id === id);
  if (existing) return { channel: existing, created: false };

  const channel: Channel = {
    id,
    name: name.trim(),
    createdBy,
    createdAt: new Date().toISOString(),
  };
  await saveChannels(root, [...channels, channel]);
  return { channel, created: true };
}

// ─── Messages ────────────────────────────────────────────────────────────────

export async function appendMessage(
  root: string,
  message: Omit<ChannelMessage, 'id' | 'ts'> & { id?: string; ts?: string },
): Promise<ChannelMessage> {
  const full: ChannelMessage = {
    ...message,
    id: message.id ?? randomUUID(),
    ts: message.ts ?? new Date().toISOString(),
  };
  const path = channelLog(root, full.channelId);
  await mkdir(join(teamDir(root), 'channels'), { recursive: true });
  await appendFile(path, JSON.stringify(full) + '\n', 'utf8');
  return full;
}

function parseLine(line: string): ChannelMessage | null {
  if (!line.trim()) return null;
  try {
    const raw: unknown = JSON.parse(line);
    if (!raw || typeof raw !== 'object') return null;
    const m = raw as ChannelMessage;
    return typeof m.id === 'string' && typeof m.text === 'string' ? m : null;
  } catch {
    // A truncated trailing line (killed mid-append) — drop it, keep the rest.
    return null;
  }
}

/**
 * Read a page of history, newest last. `before` pages backwards from a known
 * message id, which is stable under concurrent appends in a way an offset is
 * not.
 *
 * Reads the log line-by-line rather than slurping it, so a long-lived channel
 * doesn't pull its whole history into memory for a 50-message page.
 */
export async function readMessages(
  root: string,
  channelId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<{ messages: ChannelMessage[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const path = channelLog(root, channelId);

  const kept: ChannelMessage[] = [];
  let truncatedBefore = false;
  let reachedBefore = false;

  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(path, { encoding: 'utf8' });
  } catch {
    return { messages: [], hasMore: false };
  }

  try {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const m = parseLine(line);
      if (!m) continue;
      if (opts.before) {
        if (m.id === opts.before) {
          reachedBefore = true;
          break;
        }
      }
      kept.push(m);
      // Keep only the tail we might return, so memory stays bounded.
      if (kept.length > limit) {
        kept.shift();
        truncatedBefore = true;
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { messages: [], hasMore: false };
    }
    throw err;
  }

  // `before` was given but never found → treat as "from the end", which is what
  // a client with a stale cursor most usefully gets.
  void reachedBefore;
  return { messages: kept, hasMore: truncatedBefore };
}

// ─── THING in a thread ───────────────────────────────────────────────────────

/** A message addressed to THING, by an explicit `@thing` mention. */
export function mentionsThing(text: string): boolean {
  return /(^|\s)@thing\b/i.test(text);
}

/** Strip the mention so THING doesn't see its own handle as part of the ask. */
export function stripMention(text: string): string {
  return text.replace(/(^|\s)@thing\b/gi, '$1').trim();
}

/**
 * The thread a message belongs to: an explicit thread, else the message itself
 * opens one. Used as the thread key, so every reply in a thread continues the
 * same THING session.
 */
export function threadRootOf(message: ChannelMessage): string {
  return message.threadId ?? message.id;
}

/**
 * Render a channel message as the prompt THING sees. The sender is named so a
 * multi-person thread reads correctly to the agent — it is one conversation
 * with several people in it, not several conversations.
 */
export function promptFor(message: ChannelMessage): string {
  const who = message.email || message.userId || 'a team member';
  return `[${who} in #${message.channelId}] ${stripMention(message.text)}`;
}
