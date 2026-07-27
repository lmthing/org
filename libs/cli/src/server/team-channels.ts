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
 *   .team/channels.json                 [{ id, name, createdBy, createdAt, … }]
 *   .team/categories.json               [{ id, name, order }]
 *   .team/members.json                  the directory — see ./team-members.ts
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
 *
 * A **direct message is a channel too** — same record, same log file, same
 * socket, distinguished only by `kind:'dm'` and the `members` it is visible to.
 * Giving DMs their own storage and transport would have duplicated history
 * paging, THING threading and the fan-out socket for no behavioural difference;
 * what genuinely differs is who may see it, and that is one predicate
 * ({@link isVisibleTo}) rather than a second implementation.
 */

import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export const TEAM_DIR = '.team';
/** Seeded on first use so a new team has somewhere to talk immediately. */
export const DEFAULT_CHANNEL = { id: 'general', name: 'general' };

/** A named channel everyone can see, or a private conversation between members. */
export type ChannelKind = 'channel' | 'dm';

export interface Channel {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  /** Absent on records written before DMs existed — read as `'channel'`. */
  kind?: ChannelKind;
  /**
   * For a DM: exactly the user ids that may see it. Absent on a named channel,
   * which every member of the team can see.
   */
  members?: string[];
  /** The category this channel is filed under, if any. See {@link Category}. */
  categoryId?: string;
  /**
   * Project ids whose app is pinned to this channel, so it can be opened beside
   * the conversation that produced it. Ids, not copies: the app is the project's,
   * and a channel only records that it is worth having open here.
   */
  apps?: string[];
}

/** A collapsible group of channels in the sidebar. */
export interface Category {
  id: string;
  name: string;
  /** Ascending; ties break on name so the order is always total. */
  order: number;
}

/** Who or what produced a message. */
export type MessageKind = 'user' | 'thing' | 'system';

export interface ChannelMessage {
  id: string;
  ts: string;
  channelId: string;
  kind: MessageKind;
  /**
   * The message body as plain text. For a `thing` message that answered with
   * JSX this is the flattened fallback — what a client that cannot draw
   * components shows, and what a search or a notification reads.
   */
  text: string;
  /**
   * For `thing` messages that answered with JSX: the `display()` descriptors of
   * the turn, in order, already reduced to allowed components.
   *
   * The reply is STORED as structure, not as the string it flattens to.
   * `JSON.stringify`ing the descriptor into `text` was the whole bug — the log
   * is the only record of the answer, so a channel that stores braces can only
   * ever render braces, no matter what the client does later.
   */
  blocks?: unknown[];
  /** The member who sent it (absent for `thing`/`system`). */
  userId?: string;
  email?: string;
  /** The id of the message that opened this thread; absent for a channel-level post. */
  threadId?: string;
  /**
   * The user ids of members this message named with `@handle`, resolved against
   * the directory at post time.
   *
   * Resolved when the message is WRITTEN, not when it is read: a handle can be
   * given up and claimed by somebody else, and a message must keep naming the
   * person it named, not whoever holds the handle today.
   */
  mentions?: string[];
  /**
   * For the `system` card posted when THING finishes building an app: which app,
   * so the card renders as an "open it beside the channel" affordance rather than
   * a sentence about something that happened.
   *
   * In the LOG, not only on the socket: a member who was away when it was built
   * scrolls back to a card they can still open, and the record of which
   * conversation produced which app survives a reload.
   */
  app?: { projectId: string; name: string };
  /** For `thing` messages: the session the reply came from. */
  sessionId?: string;
}

export function teamDir(root: string): string {
  return join(root, TEAM_DIR);
}
function channelsFile(root: string): string {
  return join(teamDir(root), 'channels.json');
}
function categoriesFile(root: string): string {
  return join(teamDir(root), 'categories.json');
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
 * Give a fresh team its #general, so the chat surface is usable the moment the
 * pod boots rather than showing an empty shell.
 *
 * The trigger is the channels FILE not existing yet — not the list being empty.
 * Keying off emptiness meant whichever entry point ran first decided: create a
 * channel before anyone listed, and the file was written without #general and
 * the team never got one. It also means a team that deliberately deletes every
 * channel stays deleted instead of having #general resurrected under it.
 */
export async function ensureDefaultChannel(root: string): Promise<Channel[]> {
  try {
    await stat(channelsFile(root));
    return await listChannels(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
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
  categoryId?: string,
): Promise<{ channel: Channel; created: boolean }> {
  const id = channelIdFromName(name);
  if (!isValidChannelId(id)) {
    throw new Error(`invalid channel name: ${JSON.stringify(name)}`);
  }
  // Seed first, so a team whose very first act is creating a channel still ends
  // up with its #general alongside it.
  const channels = await ensureDefaultChannel(root);
  const existing = channels.find((c) => c.id === id);
  if (existing) return { channel: existing, created: false };

  const channel: Channel = {
    id,
    name: name.trim(),
    createdBy,
    createdAt: new Date().toISOString(),
    kind: 'channel',
    ...(categoryId ? { categoryId } : {}),
  };
  await saveChannels(root, [...channels, channel]);
  return { channel, created: true };
}

/**
 * Apply a partial update to a channel. Only the fields a member can meaningfully
 * change are reachable — the id never moves (it is the log's filename), and
 * neither `kind` nor `members` is editable, because turning a DM into a public
 * channel would retroactively expose a private log.
 */
export async function patchChannel(
  root: string,
  channelId: string,
  patch: { name?: string; categoryId?: string | null; apps?: string[] },
): Promise<Channel> {
  const channels = await ensureDefaultChannel(root);
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) throw new Error(`no such channel: ${channelId}`);

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('name cannot be empty');
    channel.name = name.slice(0, 80);
  }
  if (patch.categoryId !== undefined) {
    if (patch.categoryId === null || patch.categoryId === '') delete channel.categoryId;
    else channel.categoryId = patch.categoryId;
  }
  if (patch.apps !== undefined) {
    // Deduplicated and order-preserving: the sidebar renders them in this order,
    // and a project pinned twice would render twice.
    const seen = new Set<string>();
    const apps = patch.apps.filter((id) => typeof id === 'string' && id && !seen.has(id) && seen.add(id));
    if (apps.length) channel.apps = apps;
    else delete channel.apps;
  }
  await saveChannels(root, channels);
  return channel;
}

/** Whether `userId` may see this channel at all. A DM is visible only to its participants. */
export function isVisibleTo(channel: Channel, userId: string): boolean {
  if (channel.kind !== 'dm') return true;
  return (channel.members ?? []).includes(userId);
}

/**
 * The channel id for a direct conversation between a set of members.
 *
 * Derived from the sorted participant ids, so the two people who open a DM with
 * each other from opposite ends land in the SAME channel rather than each
 * creating their own half of the conversation. Hashed rather than concatenated
 * because a raw user id is not constrained to {@link isValidChannelId}'s
 * alphabet and a pair of them would blow the 64-character budget.
 */
export function dmChannelId(userIds: readonly string[]): string {
  const key = [...new Set(userIds)].sort().join(' ');
  return `dm-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

/**
 * Get (or create) the direct-message channel between exactly these members.
 *
 * `name` is the fallback label only; a DM is named by who is in it, so clients
 * render the other participant's own name rather than anything stored here.
 */
export async function ensureDmChannel(
  root: string,
  userIds: readonly string[],
  createdBy: string,
): Promise<{ channel: Channel; created: boolean }> {
  const members = [...new Set(userIds)].filter(Boolean).sort();
  if (members.length < 2) throw new Error('a direct message needs two members');
  const id = dmChannelId(members);
  const channels = await ensureDefaultChannel(root);
  const existing = channels.find((c) => c.id === id);
  if (existing) return { channel: existing, created: false };

  const channel: Channel = {
    id,
    name: 'Direct message',
    createdBy,
    createdAt: new Date().toISOString(),
    kind: 'dm',
    members,
  };
  await saveChannels(root, [...channels, channel]);
  return { channel, created: true };
}

// ─── Categories ──────────────────────────────────────────────────────────────

export async function listCategories(root: string): Promise<Category[]> {
  let text: string;
  try {
    text = await readFile(categoriesFile(root), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    const list = raw.filter(
      (c): c is Category =>
        !!c && typeof c === 'object' && typeof (c as Category).id === 'string',
    );
    return list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function saveCategories(root: string, categories: Category[]): Promise<void> {
  await mkdir(teamDir(root), { recursive: true });
  await writeFile(categoriesFile(root), JSON.stringify(categories, null, 2), 'utf8');
}

/** Create a category. Returns the existing one if the name is already used. */
export async function createCategory(
  root: string,
  name: string,
): Promise<{ category: Category; created: boolean }> {
  const id = channelIdFromName(name);
  if (!isValidChannelId(id)) {
    throw new Error(`invalid category name: ${JSON.stringify(name)}`);
  }
  const categories = await listCategories(root);
  const existing = categories.find((c) => c.id === id);
  if (existing) return { category: existing, created: false };
  const order = categories.reduce((max, c) => Math.max(max, c.order), -1) + 1;
  const category: Category = { id, name: name.trim().slice(0, 60), order };
  await saveCategories(root, [...categories, category]);
  return { category, created: true };
}

export async function patchCategory(
  root: string,
  categoryId: string,
  patch: { name?: string; order?: number },
): Promise<Category> {
  const categories = await listCategories(root);
  const category = categories.find((c) => c.id === categoryId);
  if (!category) throw new Error(`no such category: ${categoryId}`);
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('name cannot be empty');
    category.name = name.slice(0, 60);
  }
  if (patch.order !== undefined && Number.isFinite(patch.order)) category.order = patch.order;
  await saveCategories(root, categories);
  return category;
}

/**
 * Delete a category. Its channels are NOT deleted — they fall back to
 * uncategorized, which is the only non-destructive reading of "remove this
 * group" and the one a misclick can be undone from.
 */
export async function deleteCategory(root: string, categoryId: string): Promise<Channel[]> {
  const categories = await listCategories(root);
  await saveCategories(
    root,
    categories.filter((c) => c.id !== categoryId),
  );
  const channels = await ensureDefaultChannel(root);
  const orphaned = channels.filter((c) => c.categoryId === categoryId);
  if (orphaned.length) {
    for (const channel of orphaned) delete channel.categoryId;
    await saveChannels(root, channels);
  }
  return orphaned;
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
