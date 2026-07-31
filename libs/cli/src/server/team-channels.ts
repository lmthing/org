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
  /**
   * The message's position in its channel: 0 for the first message ever posted
   * there, +1 for every message after it. **This is the ordering key.**
   *
   * `ts` is not one. It is stamped from the wall clock just before an append, so
   * two messages written in the same millisecond tie with nothing to break them,
   * a clock adjustment can move it backwards, and until appends were serialized
   * ({@link appendMessageOnce}) the order the lines landed in the file could
   * differ from the order their timestamps claim. Two clients could therefore
   * render two different transcripts of the same conversation and a reload a
   * third.
   *
   * Minted under the same per-channel lock the append takes, so file order, seq
   * order and (clamped) `ts` order all agree. Absent on rows written before this
   * existed — {@link readMessages} falls back to `ts`, then to file order, so a
   * pre-existing log keeps exactly the order it always had.
   */
  seq?: number;
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
  /**
   * For a `thing` message THING wrote somewhere OTHER than as a direct reply —
   * the member whose request produced it. Rendered as "THING · for Ana".
   *
   * A message from an assistant appearing in a channel nobody asked in is
   * otherwise indistinguishable from a bug: the reader cannot tell whether the
   * agent decided to speak on its own, and cannot tell WHO to ask about it. It is
   * also the authority record — every such post was made under that member's
   * permissions ({@link isVisibleTo}, and the editor gate in `team-globals.ts`),
   * so the log should say whose.
   *
   * NOT set on THING's ordinary reply in the thread it was addressed in: there the
   * asker is the message directly above, and stamping every reply would be noise.
   */
  onBehalfOf?: { userId: string; label: string };
  /**
   * For the `system` RECEIPT posted back into the thread that made THING post
   * somewhere else — where the message went, so the conversation that caused it
   * records what happened and can link to it.
   *
   * The same shape as {@link app}: a typed field on the message, so a client
   * renders an affordance rather than parsing prose, and a reader scrolling back
   * still sees it. A write nobody in the originating thread can see is a write
   * nobody can audit.
   */
  postedTo?: { channelId: string; channelName: string; messageId: string };
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
  /**
   * The sender's own idempotency key for this message, echoed back so a client
   * can match a row to the send that produced it.
   *
   * A composer that posts, times out, and retries used to store the message
   * twice: the id was minted server-side per call, so nothing could tell a retry
   * from a second send. The key is the CLIENT's because only the client knows
   * which of its own attempts are the same intent.
   */
  clientId?: string;
  /**
   * For a `thing` message that is a QUESTION — `ask()` parked the turn on it.
   *
   * Without this a parked question is stored as an ordinary reply, so no client
   * can tell "THING answered you" from "THING is waiting on you" even in
   * principle, and the busy indicator keeps saying the agent is working while it
   * is in fact blocked on a human.
   *
   * `expiresAt` is when the pod stops holding the thread for it — see the ask
   * timeout in `routes/team-channels.ts`. It is on the ROW rather than only on
   * the socket frame so a member who scrolls back, or joins after the frame went
   * out, still sees a question rather than a statement.
   */
  ask?: { id: string; expiresAt: string };
  /**
   * The id of the {@link ask} this message resolved.
   *
   * Stamped on the reply that answered it and on the `system` receipt that
   * records the resolution, so the log says which words were submitted as the
   * answer. "Any reply in the thread is the answer" is a deliberate fallback; it
   * is only honest if the transcript admits it happened.
   */
  answersAsk?: string;
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
  const key = [...new Set(userIds)].sort().join('\0');
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

/**
 * What this pod knows about one channel's log without re-reading it: where the
 * log ends, and which sends it has already stored.
 *
 * Keyed by the log's PATH, not by channel id, so two runtime roots in one
 * process (every test file) cannot share a counter.
 *
 * The pod is the only writer of these files, so in-process state is authoritative
 * for as long as the pod lives — and `tail` makes it so, by serializing every
 * append on a channel behind the one before it. Unserialized `appendFile` calls
 * could interleave, which is what let file order and timestamp order disagree
 * with nothing to reconcile them.
 */
interface ChannelState {
  /** Highest `seq` in the log; -1 for a channel nobody has spoken in. */
  lastSeq: number;
  /** The id of the last message, for "have I read to the end of this channel". */
  lastId: string | null;
  /** The last `ts` written, so a clock that steps backwards cannot un-order a log. */
  lastTs: string;
  /** `clientId` → the row it produced. The dedupe window for retries. */
  byClientId: Map<string, ChannelMessage>;
  /** The append lock: every write on this channel chains onto the previous one. */
  tail: Promise<unknown>;
  loaded: boolean;
}

/**
 * How many recent `clientId`s a channel remembers.
 *
 * A retry follows its timed-out send by seconds, so the window only has to
 * outlive a request. Bounded because the map would otherwise grow with the
 * channel forever, and an unbounded cache on a long-lived pod is a leak with a
 * politer name.
 */
const DEDUPE_WINDOW = 500;

const channelStates = new Map<string, ChannelState>();

function stateFor(path: string): ChannelState {
  let state = channelStates.get(path);
  if (!state) {
    state = {
      lastSeq: -1,
      lastId: null,
      lastTs: '',
      byClientId: new Map(),
      tail: Promise.resolve(),
      loaded: false,
    };
    channelStates.set(path, state);
  }
  return state;
}

function remember(state: ChannelState, clientId: string, message: ChannelMessage): void {
  state.byClientId.set(clientId, message);
  // Map iterates in insertion order, so the first key is the oldest.
  while (state.byClientId.size > DEDUPE_WINDOW) {
    const oldest = state.byClientId.keys().next();
    if (oldest.done) break;
    state.byClientId.delete(oldest.value);
  }
}

/**
 * Recover a channel's write state from its log, once per pod per channel.
 *
 * One streaming pass, taken lazily on the first append or read-to-the-end, not
 * on every one: the alternative is a second file recording where each log ends,
 * which is a thing that can disagree with the log.
 *
 * A row written before `seq` existed counts as its line INDEX, so numbering
 * continues from the end of an existing log rather than restarting at 0 and
 * colliding with history.
 */
async function loadChannelState(path: string, state: ChannelState): Promise<void> {
  if (state.loaded) return;
  state.loaded = true;
  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(path, { encoding: 'utf8' });
  } catch {
    return;
  }
  try {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let index = 0;
    for await (const line of rl) {
      const m = parseLine(line);
      if (!m) continue;
      state.lastSeq = Math.max(state.lastSeq, typeof m.seq === 'number' ? m.seq : index);
      state.lastId = m.id;
      if (m.ts > state.lastTs) state.lastTs = m.ts;
      if (m.clientId) remember(state, m.clientId, m);
      index++;
    }
  } catch {
    // ENOENT — a channel nobody has spoken in yet. -1 is the right answer.
  }
}

/**
 * Append a message, or return the one an identical earlier send already stored.
 *
 * `created:false` means this exact `clientId` has been seen on this channel
 * before, so the caller must NOT broadcast, badge or push again — a retry is one
 * message, and announcing it twice is how a duplicate becomes visible even when
 * the log holds one row.
 */
export async function appendMessageOnce(
  root: string,
  message: Omit<ChannelMessage, 'id' | 'ts' | 'seq'> & { id?: string; ts?: string },
): Promise<{ message: ChannelMessage; created: boolean }> {
  const path = channelLog(root, message.channelId);
  const state = stateFor(path);
  const run = state.tail.then(async () => {
    await loadChannelState(path, state);
    if (message.clientId) {
      const existing = state.byClientId.get(message.clientId);
      if (existing) return { message: existing, created: false };
    }
    const stamped = message.ts ?? new Date().toISOString();
    const seq = state.lastSeq + 1;
    const full: ChannelMessage = {
      ...message,
      id: message.id ?? randomUUID(),
      // Never earlier than the message before it. `seq` is what reads sort on,
      // but a transcript whose visible times run backwards reads as broken.
      ts: stamped < state.lastTs ? state.lastTs : stamped,
      seq,
    };
    await mkdir(join(teamDir(root), 'channels'), { recursive: true });
    await appendFile(path, JSON.stringify(full) + '\n', 'utf8');
    state.lastSeq = seq;
    state.lastId = full.id;
    state.lastTs = full.ts;
    if (message.clientId) remember(state, message.clientId, full);
    return { message: full, created: true };
  });
  // The next append waits for this one however it ends — a failed write must not
  // wedge the channel's lock.
  state.tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function appendMessage(
  root: string,
  message: Omit<ChannelMessage, 'id' | 'ts' | 'seq'> & { id?: string; ts?: string },
): Promise<ChannelMessage> {
  return (await appendMessageOnce(root, message)).message;
}

/**
 * Where a channel's log currently ends — the message a member who has seen
 * everything has seen.
 *
 * This is what makes read state a POSITION rather than a timestamp compared
 * against a file's mtime. `null` for a channel nobody has spoken in.
 */
export async function lastMessageOf(
  root: string,
  channelId: string,
): Promise<{ id: string; seq: number } | null> {
  const path = channelLog(root, channelId);
  const state = stateFor(path);
  // Don't answer from the middle of an append that is already under way.
  await state.tail;
  await loadChannelState(path, state);
  return state.lastId ? { id: state.lastId, seq: state.lastSeq } : null;
}

/**
 * Find one message's position, for "I have read up to HERE" from a client that
 * knows an id and not a sequence. `null` if the id is not in this channel.
 */
export async function messagePosition(
  root: string,
  channelId: string,
  messageId: string,
): Promise<{ id: string; seq: number } | null> {
  const path = channelLog(root, channelId);
  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(path, { encoding: 'utf8' });
  } catch {
    return null;
  }
  try {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let index = 0;
    for await (const line of rl) {
      const m = parseLine(line);
      if (!m) continue;
      const seq = typeof m.seq === 'number' ? m.seq : index;
      if (m.id === messageId) {
        rl.close();
        stream.destroy();
        return { id: m.id, seq };
      }
      index++;
    }
  } catch {
    return null;
  }
  return null;
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
): Promise<{ messages: ChannelMessage[]; hasMore: boolean; staleCursor?: boolean }> {
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

  // `before` was given but never found. The log is append-only and read whole,
  // so an id that is not in it is not "old" — it is not this channel's. Falling
  // through to the newest window silently teleported a paginating client to the
  // top of the conversation AND told it `hasMore: true`, so it would page
  // forever over the same messages. Say so instead, and let the caller decide to
  // reset rather than guessing on its behalf.
  if (opts.before && !reachedBefore) {
    return { messages: [], hasMore: false, staleCursor: true };
  }
  return { messages: sortByPosition(kept), hasMore: truncatedBefore };
}

/**
 * Put a page in the one order every reader must agree on.
 *
 * Reads used to return raw file order, which is only the right order because
 * appends are now serialized — it was not for anything written before they were,
 * and the client compounded it by appending socket frames as they arrived and
 * never sorting. Two clients could render two different transcripts of the same
 * conversation, and a reload a third.
 *
 * `seq` first; `ts` for rows written before `seq` existed; and 0 — meaning
 * "leave them as they lie", since `Array.sort` is stable — when neither can
 * separate them. A log with no `seq` anywhere therefore keeps exactly the order
 * it has always had.
 */
function sortByPosition(messages: ChannelMessage[]): ChannelMessage[] {
  return messages.sort((a, b) => {
    if (typeof a.seq === 'number' && typeof b.seq === 'number') return a.seq - b.seq;
    const at = Date.parse(a.ts);
    const bt = Date.parse(b.ts);
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
    return 0;
  });
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
