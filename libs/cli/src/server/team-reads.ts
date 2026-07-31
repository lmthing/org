/**
 * What each member has read, and how much is waiting for them.
 *
 * `<lmthingRoot>/.team/reads.json`:
 *
 *   { "<userId>": { "<channelId>": { readAt: iso, mentions: number } } }
 *
 * Two numbers, deliberately different in kind:
 *
 *  - **unread** is a BOOLEAN, derived — from a POSITION in the channel, not from
 *    a clock. "Is there anything here I have not seen" is `readSeq < lastSeq`,
 *    where `lastSeq` is where the log currently ends
 *    ({@link import('./team-channels.js').lastMessageOf}).
 *
 *    It used to be `lastActivityAt(channel) > readAt` against the log file's
 *    MTIME, and that is wrong in the ordinary case: a member marks a channel read
 *    when they OPEN it, and every message that arrives while they sit there
 *    watching moves the mtime past their `readAt`, so the channel is unread again
 *    on their next visit and on every other device. Their own posts were exempt
 *    only because posting marks read — which is exactly why it survived testing:
 *    it needs somebody ELSE to be talking. Comparing positions also gives the
 *    client a real "new messages since" mark ({@link ChannelUnread.readMessageId})
 *    instead of a timestamp it has to guess a boundary from.
 *
 *    Still O(1) on the hot path: the position of the end of a channel is
 *    in-process state the writer maintains, so this is not a scan.
 *
 *  - **mentions** is a COUNTER, maintained. It has to be exact — a badge that
 *    says "2" when three people asked you something is worse than no badge — and
 *    it has to survive being asked for by a client that has read no history. So
 *    it is incremented at WRITE time, once, for the members a message actually
 *    names, and zeroed when they read the channel. O(1) both ways.
 *
 * A DM counts every message in it as a mention of the other participant: a
 * direct message IS addressed to you, and requiring `@you` inside one would be
 * asking someone to address a conversation that is already addressed.
 *
 * This is also the gate on PUSH. A notification is only worth sending for
 * something the member has not already seen, so the same read state that dims a
 * badge is what stops a phone buzzing about a message that is on screen.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  lastMessageOf,
  messagePosition,
  teamDir,
  type Channel,
} from './team-channels.js';

export interface ChannelReadState {
  /** ISO timestamp of the last time this member read this channel. */
  readAt: string;
  /** Messages naming this member since `readAt`. */
  mentions: number;
  /**
   * The position ({@link import('./team-channels.js').ChannelMessage.seq}) this
   * member has read up to. Absent on state written before read position existed,
   * which falls back to the old mtime comparison exactly once — until their next
   * read records a position.
   */
  readSeq?: number;
  /**
   * The id of that message, so a client can draw the "new messages since" line
   * in the right place rather than inferring it from a timestamp.
   */
  readMessageId?: string;
}

/** userId → channelId → state. */
export type ReadState = Record<string, Record<string, ChannelReadState>>;

export interface ChannelUnread {
  channelId: string;
  hasUnread: boolean;
  mentions: number;
  /** The last message this member has read, if one is recorded — the divider. */
  readMessageId?: string;
}

function readsFile(root: string): string {
  return join(teamDir(root), 'reads.json');
}

export async function loadReads(root: string): Promise<ReadState> {
  let text: string;
  try {
    text = await readFile(readsFile(root), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  try {
    const raw: unknown = JSON.parse(text);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as ReadState) : {};
  } catch {
    return {};
  }
}

async function saveReads(root: string, state: ReadState): Promise<void> {
  await mkdir(teamDir(root), { recursive: true });
  await writeFile(readsFile(root), JSON.stringify(state, null, 2), 'utf8');
}

/**
 * When a channel last had a message appended, from its log's mtime.
 *
 * Retained only as the fallback for a member whose recorded read state predates
 * {@link ChannelReadState.readSeq}; nothing new should reach for it. Epoch 0 for
 * a channel nobody has spoken in — which reads as "no activity", so an untouched
 * channel is never unread.
 */
export async function lastActivityAt(root: string, channelId: string): Promise<number> {
  try {
    const path = join(teamDir(root), 'channels', `${channelId}.jsonl`);
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Mark a channel read for a member: clears the badge and the mention counter,
 * and records WHERE they read to.
 *
 * The position defaults to the end of the channel — "I opened it, I have seen
 * everything in it" — but a caller that knows the exact message says so. The
 * delivery path does, and must: marking the SENDER read to the end of the
 * channel would also mark them read on messages other people posted in the same
 * instant, which they have not seen.
 */
export async function markRead(
  root: string,
  userId: string,
  channelId: string,
  opts: { at?: Date; messageId?: string; seq?: number } = {},
): Promise<void> {
  if (!userId || !channelId) return;
  const at = opts.at ?? new Date();
  const upTo =
    opts.messageId && typeof opts.seq === 'number'
      ? { id: opts.messageId, seq: opts.seq }
      : // An id the channel does not hold is not a position; read to the end
        // rather than refusing, since the member did open the channel.
        (opts.messageId ? await messagePosition(root, channelId, opts.messageId) : null) ??
        (await lastMessageOf(root, channelId));
  const state = await loadReads(root);
  const forUser = state[userId] ?? (state[userId] = {});
  forUser[channelId] = {
    readAt: at.toISOString(),
    mentions: 0,
    ...(upTo ? { readSeq: upTo.seq, readMessageId: upTo.id } : {}),
  };
  await saveReads(root, state);
}

/**
 * Record that a message named these members.
 *
 * Called once, on the write path, with the audience already resolved — this
 * module does not decide who a message is for. `exclude` is the sender: your own
 * message is never a mention of you, and a DM would otherwise notify the person
 * who just sent it.
 */
export async function addMentions(
  root: string,
  channelId: string,
  userIds: readonly string[],
  exclude?: string,
): Promise<void> {
  const targets = [...new Set(userIds)].filter((id) => id && id !== exclude);
  if (!targets.length) return;
  const state = await loadReads(root);
  for (const userId of targets) {
    const forUser = state[userId] ?? (state[userId] = {});
    const current = forUser[channelId];
    forUser[channelId] = {
      readAt: current?.readAt ?? new Date(0).toISOString(),
      mentions: (current?.mentions ?? 0) + 1,
    };
  }
  await saveReads(root, state);
}

/**
 * Who a message should count as a mention for.
 *
 * A DM names everyone in it; a named channel names only the members the sender
 * actually wrote an `@handle` for. The sender is excluded by {@link addMentions}.
 */
export function mentionAudience(
  channel: Channel,
  message: { mentions?: string[]; userId?: string },
): string[] {
  if (channel.kind === 'dm') return channel.members ?? [];
  return message.mentions ?? [];
}

/**
 * The unread state of every visible channel for one member, in one pass.
 *
 * A member with no recorded read state has seen nothing — but a channel with no
 * activity is still not unread, so a fresh member does not open the surface to
 * every channel shouting at them.
 */
export async function unreadFor(
  root: string,
  userId: string,
  channels: readonly Channel[],
): Promise<ChannelUnread[]> {
  const state = await loadReads(root);
  const forUser = state[userId] ?? {};
  return Promise.all(
    channels.map(async (channel) => {
      const entry = forUser[channel.id];
      const end = await lastMessageOf(root, channel.id);
      let hasUnread: boolean;
      if (!end) {
        // Nobody has ever spoken here, so there is nothing to have missed.
        hasUnread = false;
      } else if (typeof entry?.readSeq === 'number') {
        hasUnread = entry.readSeq < end.seq;
      } else {
        // No recorded position: either a member who has read nothing (unread, if
        // anything is here) or state written before positions existed, which gets
        // the old mtime reading one last time.
        const readAt = entry ? Date.parse(entry.readAt) : 0;
        hasUnread = (await lastActivityAt(root, channel.id)) > readAt;
      }
      return {
        channelId: channel.id,
        hasUnread,
        mentions: entry?.mentions ?? 0,
        ...(entry?.readMessageId ? { readMessageId: entry.readMessageId } : {}),
      };
    }),
  );
}

/**
 * Members who should be TOLD about a message out of band (a push notification),
 * as opposed to merely having a badge updated.
 *
 * The rule is deliberately narrow: only people the message actually names, and
 * only those who are not already looking at it. Everything else — a busy channel
 * you are in, a thread you once replied to — is what the badge is for. A
 * notification that fires for anything less than "somebody addressed me" trains
 * people to turn notifications off.
 */
export async function pushAudience(
  root: string,
  channel: Channel,
  message: { mentions?: string[]; userId?: string; ts?: string; seq?: number },
  connectedUserIds: ReadonlySet<string>,
): Promise<string[]> {
  const named = mentionAudience(channel, message).filter(
    (id) => id && id !== message.userId && !connectedUserIds.has(id),
  );
  if (!named.length) return [];
  const state = await loadReads(root);
  const sentAt = message.ts ? Date.parse(message.ts) : Date.now();
  return named.filter((userId) => {
    const entry = state[userId]?.[channel.id];
    if (!entry) return true;
    // Already read PAST this message — they have seen it on another device.
    // By position where both sides have one; by clock only for state written
    // before positions existed.
    if (typeof entry.readSeq === 'number' && typeof message.seq === 'number') {
      return entry.readSeq < message.seq;
    }
    return Date.parse(entry.readAt) < sentAt;
  });
}
