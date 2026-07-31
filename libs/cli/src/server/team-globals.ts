/**
 * The HOST side of THING's team globals — `@lmthing/core`'s {@link TeamResolver},
 * built fresh for one agent turn and closed over the member who started it.
 *
 * The problem this solves is that an agent turn has no request. A channel message
 * arrives on an HTTP request whose Envoy-projected headers carry the verified
 * caller (`team-guard.ts#readCaller`); the turn it starts runs headless, minutes
 * later, on a session shared by everyone in the thread. So the identity is
 * captured where it is trustworthy — in the route, from the request — and threaded
 * as a VALUE into the resolver the sandbox reaches through. There is no ambient
 * "current caller" anywhere, and nothing the model can write names one: every
 * method below reads `turn.caller`, never an argument.
 *
 * Four rules the resolver enforces, none of them expressible in the sandbox:
 *
 *  1. **A DM the caller is not in does not exist.** `channels()` filters on
 *     {@link isVisibleTo} and `history()`/`post()` reject with the same message an
 *     unknown channel id gets — "not visible" and "not there" must be
 *     indistinguishable, or the error itself discloses the conversation.
 *
 *  2. **A viewer cannot write through the agent.** `team-guard.ts` keeps viewers
 *     out of the mutating REST surface; a viewer who could say "THING, announce
 *     this in #general" would have walked around it. Viewers keep every reader.
 *
 *  3. **THING speaks as THING, for somebody.** Every message this module appends
 *     is `kind: 'thing'` with no `userId`, so an agent post can never be read as a
 *     member's own words — and it carries `onBehalfOf`, so a reader in a channel
 *     nobody asked in can tell whose request produced it and whose permissions it
 *     was made under.
 *
 *  4. **A write elsewhere leaves a receipt here.** Posting into another channel
 *     appends a `system` message to the thread that caused it, carrying `postedTo`
 *     — the same typed-field pattern as the app card. A write the originating
 *     conversation cannot see is a write nobody can audit.
 *
 * There is deliberately **no DM writer**. A `thing` message has no `userId` and
 * `dmChannelId` hashes a set of USER ids, so THING cannot be a participant in a
 * direct message: "THING DMs Bo" is either an impersonation of the asker or an
 * invented identity the addressing scheme has no room for. Reaching one person is
 * a `teamPost` with an `@handle`, which rides the mention/badge/push path that
 * already exists.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  TeamChannelInfo,
  TeamCreateChannelResult,
  TeamHistoryPage,
  TeamMemberInfo,
  TeamMessageInfo,
  TeamPinResult,
  TeamPostResult,
  TeamResolver,
  TeamTurnInfo,
} from '@lmthing/core';
import {
  appendMessage,
  channelIdFromName,
  createChannel,
  ensureDefaultChannel,
  isValidChannelId,
  isVisibleTo,
  patchChannel,
  readMessages,
  type Channel,
  type ChannelMessage,
} from './team-channels.js';
import { listMembers, memberLabel, resolveMentions } from './team-members.js';
import type { TeamCaller } from './team-guard.js';

/**
 * Everything about the turn that the message which started it decided: who asked,
 * where, and in which thread. Built by the channel route from `readCaller(req)` +
 * the stored message, and never assembled from anything the agent said.
 */
export interface TeamTurnContext {
  /** The verified caller, straight from the Envoy-projected headers. */
  caller: TeamCaller;
  /** The channel the message landed in. */
  channel: Channel;
  /** The thread the turn is answering in ({@link threadRootOf} of the message). */
  threadId?: string;
}

/**
 * Side effects the resolver cannot own but must not skip: a message THING posts
 * has to reach the sockets watching that channel and raise the badges of the
 * people it names, exactly as a member's message does.
 *
 * Injected rather than imported because the broadcast + delivery machinery lives
 * in the route module (it owns the socket registry), and because a unit test wants
 * to assert what WOULD have been broadcast without standing one up.
 */
export interface TeamGlobalsHooks {
  /** A message THING just appended, with the channel it landed in. */
  onPost?: (message: ChannelMessage, channel: Channel) => void;
  /**
   * A channel record THING just wrote — a pin, or a channel it just CREATED.
   *
   * One hook for both because the announcement is the same one either way: the
   * route turns it into `broadcastChannelEvent({ type:'channel', channel })`,
   * which is exactly what `handleCreateChannel` sends when a person makes a
   * channel from the UI. Without it the channel exists on disk and appears in
   * nobody's sidebar until they happen to reload — an answer only the asker can
   * see is not an answer in a shared workspace.
   */
  onChannelChanged?: (channel: Channel) => void;
}

/** Refusals the model should read and relay, not retry blindly. */
class TeamGlobalError extends Error {}

/** A viewer reached a writer. Same line for both, naming the reason. */
function refuseViewer(what: string): never {
  throw new TeamGlobalError(
    `${what} is not permitted: the member who asked is a viewer of this team, and a viewer ` +
      `cannot change the workspace — through you or otherwise. Tell them an editor has to do it.`,
  );
}

/**
 * Resolve a channel id to a channel the CALLER may see, or refuse.
 *
 * One message for "no such channel" and "a DM you are not in", deliberately: the
 * distinction is exactly the private information the check exists to protect.
 */
async function visibleChannel(
  root: string,
  caller: TeamCaller,
  channelId: string,
): Promise<Channel> {
  if (!isValidChannelId(channelId)) {
    throw new TeamGlobalError(`no such channel: ${channelId}`);
  }
  const channels = await ensureDefaultChannel(root);
  const channel = channels.find((c) => c.id === channelId);
  if (!channel || !isVisibleTo(channel, caller.userId)) {
    throw new TeamGlobalError(`no such channel: ${channelId}`);
  }
  return channel;
}

/** Flatten a stored message into the reading shape, naming its author. */
function messageInfo(
  message: ChannelMessage,
  label: (userId: string | undefined, fallback: string) => string,
): TeamMessageInfo {
  return {
    id: message.id,
    ts: message.ts,
    channelId: message.channelId,
    kind: message.kind,
    text: message.text,
    author:
      message.kind === 'thing'
        ? 'THING'
        : message.kind === 'system'
          ? 'system'
          : label(message.userId, message.email ?? 'someone'),
    ...(message.userId ? { userId: message.userId } : {}),
    ...(message.threadId ? { threadId: message.threadId } : {}),
  };
}

/**
 * How much history one call may pull back.
 *
 * `readMessages` allows up to 200 (`team-channels.ts#readMessages`), which is a
 * fine ceiling for a UI that pages on scroll and a bad one for an agent: 200
 * messages is most of a turn's context window spent on a channel nobody asked it
 * to summarize, and the model has no way to know it overspent. 30 answers "what
 * did we decide" and 100 is the most a single call can cost; more than that is a
 * deliberate walk backwards through `before`, one page at a time.
 */
const HISTORY_DEFAULT_LIMIT = 30;
const HISTORY_MAX_LIMIT = 100;

/**
 * Build the per-turn team resolver.
 *
 * `root` is the pod's lmthing root (the `.team/` dir hangs off it); `turn` is the
 * verified context captured in the route. Everything the six globals can do is
 * decided by those two values plus the caller's role — nothing is re-read from the
 * environment, and nothing is taken from the agent.
 */
export function createTeamResolver(
  root: string,
  turn: TeamTurnContext,
  hooks: TeamGlobalsHooks = {},
): TeamResolver {
  const caller = turn.caller;

  /** The directory, once per call — used to name authors and to resolve mentions. */
  const directory = async (): Promise<
    (userId: string | undefined, fallback: string) => string
  > => {
    const members = await listMembers(root);
    const byId = new Map(members.map((m) => [m.userId, m]));
    return (userId, fallback) => memberLabel(userId ? byId.get(userId) : undefined, fallback);
  };

  /** How the caller is named in an attribution line ("THING · for Ana K"). */
  const callerLabel = async (): Promise<string> => {
    const own = (await listMembers(root)).find((m) => m.userId === caller.userId);
    return memberLabel(own, caller.email || caller.userId);
  };

  /**
   * Append a `thing` message, attributed, and run the route's broadcast/delivery
   * hook — which is what applies `audienceFor` (so a post into a DM reaches only
   * its participants) and `deliver` (badges + push). A write that skipped those
   * would broadcast a private channel's message to every connected socket.
   */
  const postAs = async (
    channel: Channel,
    text: string,
    threadId: string | undefined,
  ): Promise<TeamPostResult> => {
    const body = text.trim();
    if (!body) throw new TeamGlobalError('a message needs some text');
    // Mentions are resolved at WRITE time, like a member's message, so an
    // `@handle` THING types raises that person's badge instead of being inert text.
    const mentioned = resolveMentions(body, await listMembers(root));
    const message = await appendMessage(root, {
      channelId: channel.id,
      // Never `user`: an agent post that could carry a userId would be a way to put
      // words in a member's mouth.
      kind: 'thing',
      text: body,
      ...(threadId ? { threadId } : {}),
      ...(mentioned.length ? { mentions: mentioned.map((m) => m.userId) } : {}),
      onBehalfOf: { userId: caller.userId, label: await callerLabel() },
    });
    hooks.onPost?.(message, channel);

    // A post that landed somewhere else leaves a receipt where it was ASKED for.
    // Same shape as the app card: a `system` message with a typed field, so the
    // conversation that caused the write records it and a client can link to it.
    let receipt = false;
    if (channel.id !== turn.channel.id) {
      const note = await appendMessage(root, {
        channelId: turn.channel.id,
        kind: 'system',
        text: `Posted to #${channel.name}.`,
        ...(turn.threadId ? { threadId: turn.threadId } : {}),
        postedTo: { channelId: channel.id, channelName: channel.name, messageId: message.id },
      });
      hooks.onPost?.(note, turn.channel);
      receipt = true;
    }
    return { ok: true, channelId: channel.id, messageId: message.id, ...(receipt ? { receipt } : {}) };
  };

  return {
    async context(): Promise<TeamTurnInfo> {
      const own = (await listMembers(root)).find((m) => m.userId === caller.userId);
      return {
        teamId: caller.teamId,
        channelId: turn.channel.id,
        channelName: turn.channel.name,
        channelKind: turn.channel.kind === 'dm' ? 'dm' : 'channel',
        ...(turn.threadId ? { threadId: turn.threadId } : {}),
        caller: {
          userId: caller.userId,
          role: caller.role,
          ...(caller.email ? { email: caller.email } : {}),
          ...(own?.handle ? { handle: own.handle } : {}),
          ...(own?.displayName ? { displayName: own.displayName } : {}),
        },
      };
    },

    async members(): Promise<TeamMemberInfo[]> {
      // The whole directory: it is the same list the mention picker shows every
      // member, so there is nothing here a caller could not already read.
      return (await listMembers(root)).map((m) => ({
        userId: m.userId,
        label: memberLabel(m, m.email ?? m.userId),
        isCaller: m.userId === caller.userId,
        ...(m.handle ? { handle: m.handle } : {}),
        ...(m.displayName ? { displayName: m.displayName } : {}),
        ...(m.email ? { email: m.email } : {}),
      }));
    },

    async channels(): Promise<TeamChannelInfo[]> {
      const all = await ensureDefaultChannel(root);
      return all
        .filter((c) => isVisibleTo(c, caller.userId))
        .map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind === 'dm' ? ('dm' as const) : ('channel' as const),
          ...(c.categoryId ? { categoryId: c.categoryId } : {}),
          ...(c.apps?.length ? { apps: [...c.apps] } : {}),
        }));
    },

    async history(channelId, opts): Promise<TeamHistoryPage> {
      const channel = await visibleChannel(root, caller, channelId);
      const label = await directory();
      // The ceiling is OURS, not readMessages' 200 — and it is reported back, so a
      // turn that asked for more can see it was cut and say so.
      const limit = Math.min(Math.max(opts?.limit ?? HISTORY_DEFAULT_LIMIT, 1), HISTORY_MAX_LIMIT);
      const page = await readMessages(root, channelId, {
        limit,
        ...(opts?.before ? { before: opts.before } : {}),
      });
      const messages = page.messages.map((m) => messageInfo(m, label));
      return {
        messages,
        hasMore: page.hasMore,
        channelId,
        channelName: channel.name,
        returned: messages.length,
        limit,
      };
    },

    async post(channelId, text, opts): Promise<TeamPostResult> {
      if (caller.role !== 'editor') refuseViewer('posting to a channel');
      const channel = await visibleChannel(root, caller, channelId);
      return postAs(channel, text, opts?.threadId);
    },

    async pinApp(channelId, projectId): Promise<TeamPinResult> {
      if (caller.role !== 'editor') refuseViewer('pinning an app to a channel');
      const channel = await visibleChannel(root, caller, channelId);
      // A pin is a promise that something opens. Pinning a project that does not
      // exist would put a dead tile in the sidebar that nobody can clear from the
      // conversation that produced it.
      if (!projectId || !existsSync(join(root, projectId, 'project.json'))) {
        throw new TeamGlobalError(`no such project: ${projectId}`);
      }
      const updated = await patchChannel(root, channelId, {
        apps: [...(channel.apps ?? []), projectId],
      });
      hooks.onChannelChanged?.(updated);
      return { ok: true, channelId, apps: [...(updated.apps ?? [])] };
    },

    /**
     * Make a channel — the same {@link createChannel} the REST route calls, so
     * there is ONE creation path and an agent-made channel is byte-identical to a
     * person-made one (same slugified id, same `#general` seeding, same
     * get-or-create on a name already taken).
     *
     * Get-or-create rather than refuse-or-suffix: the request behind this is
     * always "put this subject somewhere of its own", and answering it with a
     * second channel of nearly the same name creates precisely the confusion it
     * was meant to end. `created` distinguishes the two outcomes so the turn can
     * say which happened instead of announcing a channel it did not make.
     *
     * No `members` parameter, deliberately. A named channel is visible to the
     * whole team ({@link isVisibleTo}), and a private conversation is a DM
     * addressed by the sorted set of its participants — a members list here would
     * be a third visibility model invented in a resolver.
     */
    async createChannel(name, opts): Promise<TeamCreateChannelResult> {
      if (caller.role !== 'editor') refuseViewer('creating a channel');
      const wanted = typeof name === 'string' ? name.trim() : '';
      if (!wanted) throw new TeamGlobalError('a channel needs a name');
      // Validate the name the way the store will derive the id, so a bad name is
      // refused with something the model can act on rather than surfacing as a
      // low-level throw from the writer.
      if (!isValidChannelId(channelIdFromName(wanted))) {
        throw new TeamGlobalError(
          `${JSON.stringify(wanted)} does not make a usable channel name — use letters and numbers`,
        );
      }
      const { channel, created } = await createChannel(
        root,
        wanted,
        caller.userId,
        opts?.categoryId,
      );
      // The invariant every other method here keeps: never hand back a channel the
      // caller cannot see. Only reachable if a name slugified onto a DM's id.
      if (!isVisibleTo(channel, caller.userId)) {
        throw new TeamGlobalError(`cannot create a channel called ${JSON.stringify(wanted)}`);
      }
      // Announce it exactly as the REST route does — and only when it is NEW, or a
      // second ask would redraw everyone's sidebar for nothing.
      if (created) hooks.onChannelChanged?.(channel);
      return { ok: true, channelId: channel.id, name: channel.name, created };
    },
  };
}
