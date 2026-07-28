/**
 * What each member has read, and how much is waiting for them.
 *
 * `<lmthingRoot>/.team/reads.json`:
 *
 *   { "<userId>": { "<channelId>": { readAt: iso, mentions: number } } }
 *
 * Two numbers, deliberately different in kind:
 *
 *  - **unread** is a BOOLEAN, derived. "Is there anything here I have not seen"
 *    is `lastActivityAt(channel) > readAt`, and the last activity is the log
 *    file's mtime — free, exact (nothing else writes those files), and needs no
 *    bookkeeping on the hot path. An exact unread COUNT would mean scanning
 *    every channel's log on every sidebar render, which is the one thing a
 *    channel list must not do.
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
import { teamDir, type Channel } from './team-channels.js';

export interface ChannelReadState {
  /** ISO timestamp of the last time this member read this channel. */
  readAt: string;
  /** Messages naming this member since `readAt`. */
  mentions: number;
}

/** userId → channelId → state. */
export type ReadState = Record<string, Record<string, ChannelReadState>>;

export interface ChannelUnread {
  channelId: string;
  hasUnread: boolean;
  mentions: number;
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
 * Epoch 0 for a channel nobody has spoken in — which reads as "no activity", so
 * an untouched channel is never unread.
 */
export async function lastActivityAt(root: string, channelId: string): Promise<number> {
  try {
    const path = join(teamDir(root), 'channels', `${channelId}.jsonl`);
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

/** Mark a channel read for a member: clears the badge and the mention counter. */
export async function markRead(
  root: string,
  userId: string,
  channelId: string,
  at: Date = new Date(),
): Promise<void> {
  if (!userId || !channelId) return;
  const state = await loadReads(root);
  const forUser = state[userId] ?? (state[userId] = {});
  forUser[channelId] = { readAt: at.toISOString(), mentions: 0 };
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
      const readAt = entry ? Date.parse(entry.readAt) : 0;
      const activity = await lastActivityAt(root, channel.id);
      return {
        channelId: channel.id,
        hasUnread: activity > 0 && activity > readAt,
        mentions: entry?.mentions ?? 0,
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
  message: { mentions?: string[]; userId?: string; ts?: string },
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
    // Read AFTER this message was written — they have seen it on another device.
    return !entry || Date.parse(entry.readAt) < sentAt;
  });
}
