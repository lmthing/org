/**
 * Team channel REST routes. Registered only on a team pod (serve.ts gates on
 * `isTeamMode()`), so a personal pod's API surface is unchanged.
 *
 * Posting a message is the interesting one: if it addresses THING, the reply is
 * produced by the SAME threaded-session machinery the inbound-webhook
 * dispatcher uses, keyed by (channel, thread). The HTTP call returns as soon as
 * the member's own message is stored — THING's answer arrives over the channel
 * socket whenever it is ready, so a slow agent turn never blocks the composer.
 *
 * Everything here is written to hold for a DM as well as a named channel. The
 * one thing a DM changes is who may see it, and that is enforced in exactly two
 * places: {@link requireVisibleChannel} for requests, and `audienceFor` for the
 * socket fan-out. Nothing else in this file needs to know the difference.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  descriptorToText,
  isJsxDescriptor,
  parseDescriptorPayload,
  sanitizeDescriptor,
} from '@lmthing/core/ui';
import type { RouteHandler } from '../router.js';
import type { HeadlessRunResult, SessionManager } from '../session-manager.js';
import { readBody, sendJson } from './utils.js';
import { readCaller, type TeamCaller } from '../team-guard.js';
import { listProjects } from '../projects.js';
import { getOrCreateThreadSession, getThreadSession } from '../webhook-threads.js';
import { WebRenderHost } from '../../rpc/server.js';
import { audienceFor, broadcastChannelEvent, connectedUserIds } from '../ws/team-channels.js';
import {
  addMentions,
  markRead,
  mentionAudience,
  pushAudience,
  unreadFor,
} from '../team-reads.js';
import { pushPayload, sendPushRequest } from '../team-push.js';
import {
  appendMessage,
  appendMessageOnce,
  createCategory,
  createChannel,
  deleteCategory,
  ensureDefaultChannel,
  ensureDmChannel,
  isValidChannelId,
  isVisibleTo,
  listCategories,
  mentionsThing,
  patchCategory,
  patchChannel,
  promptFor,
  readMessages,
  teamDir,
  threadRootOf,
  type Channel,
  type ChannelMessage,
} from '../team-channels.js';
import {
  HandleError,
  getMember,
  listMembers,
  memberLabel,
  resolveMentions,
  setProfile,
  touchMember,
} from '../team-members.js';
import { createTeamResolver } from '../team-globals.js';

/** The agent a channel mention reaches, matching the chat surface's default. */
const THING_AGENT = 'thing';

/**
 * Work a POST kicked off but deliberately did not wait for: THING's answer to a
 * mention, and the delivery bookkeeping (badges, push) for a stored message.
 *
 * Both are out-of-band on purpose — the composer must not wait on an agent turn,
 * and the poster has no business waiting for somebody else's badge to go up. That
 * leaves real work in flight that nothing is awaiting, which is a problem for a
 * shutdown that would rather not drop a half-finished answer, and for any test
 * that needs to know the work has landed.
 *
 * So it is all tracked in one place and drainable. Nothing outside this module
 * gets to start untracked background work on the channel path.
 */
const inFlight = new Set<Promise<void>>();

function track(p: Promise<void>): void {
  inFlight.add(p);
  void p.finally(() => inFlight.delete(p));
}

/**
 * Resolve once every background channel task has finished (or failed).
 *
 * The loop re-checks rather than awaiting one snapshot: a delivery can start
 * another task (THING's reply delivers in turn), so a single `allSettled` would
 * return with work still outstanding.
 */
export async function settleChannelWork(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}

/**
 * A THING turn this pod is running right now, in a shape a client that just
 * arrived can render.
 *
 * `thing_status` is a socket frame and nothing else: it is sent once when a turn
 * starts, re-sent on each activity change, and then forgotten. A member who
 * opens the channel one minute into a seventeen-minute build receives none of
 * them and sees a thread that looks finished and empty — which is the COMMON
 * case for a long build, not an edge one.
 *
 * So the live state is also readable. It is deliberately in memory and not on
 * the message row: a turn in flight is a property of this process, it must not
 * outlive a restart (a "running" turn recovered from disk after a crash is a
 * lie), and appending a placeholder row to an append-only log would need a
 * message-update frame that does not exist yet.
 */
export interface ThingTurn {
  channelId: string;
  threadId: string;
  /** `waiting` = parked on an `ask()`; see {@link answerPendingAsk}. */
  status: 'running' | 'waiting';
  /** ISO — what makes an elapsed time renderable for somebody who just arrived. */
  startedAt: string;
  /** The last `setActivity()` label, so a joiner learns WHAT it is doing. */
  activity?: string;
  /** While `waiting`: the ask, matching the question row's `ask.id`. */
  askId?: string;
}

const liveTurns = new Map<string, ThingTurn>();

/** The turns in flight in one channel, for a client that has just opened it. */
export function runningTurns(channelId: string): ThingTurn[] {
  return [...liveTurns.values()].filter((t) => t.channelId === channelId);
}

function requireRoot(root: string | undefined, res: ServerResponse): root is string {
  if (!root) {
    sendJson(res, 500, { error: 'team channels need a project runtime root' });
    return false;
  }
  return true;
}

/**
 * Resolve the channel a request names, refusing one the caller may not see.
 *
 * A DM the caller is not in answers **404**, not 403: "you may not read this"
 * and "this does not exist" are the same fact to someone who should not know it
 * exists, and a 403 would confirm that two named people have a conversation.
 */
async function requireVisibleChannel(
  root: string,
  channelId: string,
  caller: TeamCaller | null,
  res: ServerResponse,
): Promise<Channel | null> {
  const channels = await ensureDefaultChannel(root);
  const channel = channels.find((c) => c.id === channelId);
  if (!channel || !isVisibleTo(channel, caller?.userId ?? '')) {
    sendJson(res, 404, { error: `no such channel: ${channelId}` });
    return null;
  }
  return channel;
}

async function parseJsonBody<T>(req: IncomingMessage, res: ServerResponse): Promise<T | null> {
  try {
    return JSON.parse((await readBody(req)) || '{}') as T;
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' });
    return null;
  }
}

// ─── Channels ────────────────────────────────────────────────────────────────

/**
 * `GET /api/team/channels` — the sidebar's whole payload: the channels this
 * caller can see and the categories they are filed under.
 *
 * Categories ride along rather than living behind their own request because
 * neither is renderable without the other — a sidebar with channels but no
 * groups draws the wrong shape for the moment between the two responses.
 */
export function handleListChannels(root: string | undefined): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const caller = readCaller(req);
    if (caller) await touchMember(root, caller.userId, caller.email);
    const [all, categories] = await Promise.all([
      ensureDefaultChannel(root),
      listCategories(root),
    ]);
    const channels = all.filter((c) => isVisibleTo(c, caller?.userId ?? ''));
    // Unread rides along for the same reason categories do: a sidebar that draws
    // its channels and then re-draws them a moment later with badges on is a
    // worse thing to look at than one that waits for both.
    const unread = caller ? await unreadFor(root, caller.userId, channels) : [];
    sendJson(res, 200, { channels, categories, unread });
  };
}

/**
 * `POST /api/team/channels/:channelId/read` — "I have seen this channel."
 *
 * Viewer-allowed, and has been in team-guard's allowlist since teams shipped;
 * this is the handler that was missing behind it.
 */
export function handleMarkRead(root: string | undefined): RouteHandler {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const caller = readCaller(req);
    if (!caller) {
      sendJson(res, 401, { error: 'marking a channel read needs a verified caller' });
      return;
    }
    const channelId = params['channelId'] ?? '';
    if (!isValidChannelId(channelId)) {
      sendJson(res, 400, { error: 'invalid channel id' });
      return;
    }
    if (!(await requireVisibleChannel(root, channelId, caller, res))) return;
    // A client that knows how far it has actually rendered says so; one that does
    // not is read to the end of the channel, which is what opening it means.
    const body = await parseJsonBody<{ messageId?: unknown }>(req, res);
    if (!body) return;
    await markRead(root, caller.userId, channelId, {
      ...(typeof body.messageId === 'string' && body.messageId
        ? { messageId: body.messageId }
        : {}),
    });
    sendJson(res, 200, { ok: true });
  };
}

export function handleCreateChannel(root: string | undefined): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const parsed = await parseJsonBody<{ name?: unknown; categoryId?: unknown }>(req, res);
    if (!parsed) return;
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!name) {
      sendJson(res, 400, { error: 'name is required' });
      return;
    }
    const caller = readCaller(req);
    try {
      const { channel, created } = await createChannel(
        root,
        name,
        caller?.userId ?? 'unknown',
        typeof parsed.categoryId === 'string' ? parsed.categoryId : undefined,
      );
      if (created) broadcastChannelEvent({ type: 'channel', channel });
      sendJson(res, created ? 201 : 200, { channel, created });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

/**
 * `PATCH /api/team/channels/:channelId` — rename it, file it under a category,
 * or change which apps are pinned beside it. Editor-only, by team-guard's
 * default-deny.
 */
export function handlePatchChannel(root: string | undefined): RouteHandler {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const channelId = params['channelId'] ?? '';
    if (!isValidChannelId(channelId)) {
      sendJson(res, 400, { error: 'invalid channel id' });
      return;
    }
    const caller = readCaller(req);
    if (!(await requireVisibleChannel(root, channelId, caller, res))) return;

    const parsed = await parseJsonBody<{
      name?: unknown;
      categoryId?: unknown;
      apps?: unknown;
    }>(req, res);
    if (!parsed) return;

    try {
      const channel = await patchChannel(root, channelId, {
        ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
        ...('categoryId' in parsed
          ? {
              categoryId:
                typeof parsed.categoryId === 'string' && parsed.categoryId
                  ? parsed.categoryId
                  : null,
            }
          : {}),
        ...(Array.isArray(parsed.apps)
          ? { apps: parsed.apps.filter((a): a is string => typeof a === 'string') }
          : {}),
      });
      broadcastChannelEvent({ type: 'channel', channel }, audienceFor(channel));
      sendJson(res, 200, { channel });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

/**
 * `POST /api/team/dms { userId }` — open (or reopen) the direct conversation
 * with one other member. Idempotent: the id is derived from the participants, so
 * both ends resolve to the same channel however many times either asks.
 */
export function handleCreateDm(root: string | undefined): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const caller = readCaller(req);
    if (!caller) {
      sendJson(res, 401, { error: 'a direct message needs a verified caller' });
      return;
    }
    const parsed = await parseJsonBody<{ userId?: unknown }>(req, res);
    if (!parsed) return;
    const other = typeof parsed.userId === 'string' ? parsed.userId.trim() : '';
    if (!other) {
      sendJson(res, 400, { error: 'userId is required' });
      return;
    }
    if (other === caller.userId) {
      sendJson(res, 400, { error: 'you cannot open a direct message with yourself' });
      return;
    }
    try {
      const { channel, created } = await ensureDmChannel(
        root,
        [caller.userId, other],
        caller.userId,
      );
      // Both participants, so the other end's sidebar gains the conversation
      // without a reload — the whole point of opening one.
      if (created) broadcastChannelEvent({ type: 'channel', channel }, audienceFor(channel));
      sendJson(res, created ? 201 : 200, { channel, created });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

// ─── Categories ──────────────────────────────────────────────────────────────

export function handleListCategories(root: string | undefined): RouteHandler {
  return async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireRoot(root, res)) return;
    sendJson(res, 200, { categories: await listCategories(root) });
  };
}

export function handleCreateCategory(root: string | undefined): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const parsed = await parseJsonBody<{ name?: unknown }>(req, res);
    if (!parsed) return;
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!name) {
      sendJson(res, 400, { error: 'name is required' });
      return;
    }
    try {
      const { category, created } = await createCategory(root, name);
      broadcastChannelEvent({ type: 'categories', categories: await listCategories(root) });
      sendJson(res, created ? 201 : 200, { category, created });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

export function handlePatchCategory(root: string | undefined): RouteHandler {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const parsed = await parseJsonBody<{ name?: unknown; order?: unknown }>(req, res);
    if (!parsed) return;
    try {
      const category = await patchCategory(root, params['categoryId'] ?? '', {
        ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
        ...(typeof parsed.order === 'number' ? { order: parsed.order } : {}),
      });
      broadcastChannelEvent({ type: 'categories', categories: await listCategories(root) });
      sendJson(res, 200, { category });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

/**
 * `DELETE /api/team/categories/:categoryId` — remove the group. The channels in
 * it become uncategorized and are announced individually, so every open sidebar
 * re-files them rather than showing them under a heading that no longer exists.
 */
export function handleDeleteCategory(root: string | undefined): RouteHandler {
  return async (
    _req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): Promise<void> => {
    if (!requireRoot(root, res)) return;
    try {
      const orphaned = await deleteCategory(root, params['categoryId'] ?? '');
      broadcastChannelEvent({ type: 'categories', categories: await listCategories(root) });
      for (const channel of orphaned) {
        broadcastChannelEvent({ type: 'channel', channel }, audienceFor(channel));
      }
      sendJson(res, 200, { deleted: params['categoryId'] ?? '', uncategorized: orphaned.length });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

// ─── The directory ───────────────────────────────────────────────────────────

/**
 * `GET /api/team/directory` — everything the composer's `@` picker offers:
 * the members (with the handles they chose) and the team's projects.
 *
 * One route rather than two because it is read as one list. `@` does not mean
 * "a person" on this surface — it means "address something in this team", and
 * THING, a colleague and a project are three answers to the same question.
 */
export function handleDirectory(root: string | undefined): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const caller = readCaller(req);
    if (caller) await touchMember(root, caller.userId, caller.email);
    const [members, projects] = await Promise.all([
      listMembers(root),
      listProjects(root).catch(() => []),
    ]);
    const withApps = await Promise.all(
      projects.map(async (p) => ({
        id: p.id,
        name: p.name,
        hasApp: await projectHasApp(root, p.id),
      })),
    );
    sendJson(res, 200, { members, projects: withApps });
  };
}

/** `GET /api/team/profile` — the caller's own directory row. */
export function handleGetProfile(root: string | undefined): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const caller = readCaller(req);
    if (!caller) {
      sendJson(res, 401, { error: 'a profile needs a verified caller' });
      return;
    }
    await touchMember(root, caller.userId, caller.email);
    sendJson(res, 200, { profile: await getMember(root, caller.userId) });
  };
}

/**
 * `PUT /api/team/profile { handle?, displayName? }` — set what you are called.
 *
 * Viewer-allowed (team-guard): choosing your own name is not configuring the
 * team, and a viewer with no way to be addressed cannot be talked to.
 */
export function handlePutProfile(root: string | undefined): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const caller = readCaller(req);
    if (!caller) {
      sendJson(res, 401, { error: 'a profile needs a verified caller' });
      return;
    }
    const parsed = await parseJsonBody<{ handle?: unknown; displayName?: unknown }>(req, res);
    if (!parsed) return;
    try {
      const profile = await setProfile(root, caller.userId, {
        ...('handle' in parsed
          ? { handle: typeof parsed.handle === 'string' ? parsed.handle : null }
          : {}),
        ...('displayName' in parsed
          ? { displayName: typeof parsed.displayName === 'string' ? parsed.displayName : null }
          : {}),
        ...(caller.email ? { email: caller.email } : {}),
      });
      sendJson(res, 200, { profile });
    } catch (err) {
      // A taken or malformed handle is the user's to fix, not a server fault.
      const status = err instanceof HandleError ? 409 : 400;
      sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

// ─── Messages ────────────────────────────────────────────────────────────────

export function handleListMessages(root: string | undefined): RouteHandler {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const channelId = params['channelId'] ?? '';
    if (!isValidChannelId(channelId)) {
      sendJson(res, 400, { error: 'invalid channel id' });
      return;
    }
    if (!(await requireVisibleChannel(root, channelId, readCaller(req), res))) return;

    const url = new URL(req.url ?? '/', 'http://localhost');
    const limitRaw = Number(url.searchParams.get('limit'));
    const before = url.searchParams.get('before') ?? undefined;
    const { messages, hasMore, staleCursor } = await readMessages(root, channelId, {
      ...(Number.isFinite(limitRaw) && limitRaw > 0 ? { limit: limitRaw } : {}),
      ...(before ? { before } : {}),
    });
    // `turns` rides along for the same reason unread rides along with the channel
    // list: it is needed to draw the transcript correctly the FIRST time. Without
    // it a member who opens a channel mid-build sees a thread that looks finished.
    sendJson(res, 200, {
      messages,
      hasMore,
      ...(staleCursor ? { staleCursor } : {}),
      turns: runningTurns(channelId),
    });
  };
}

export function handlePostMessage(
  manager: SessionManager,
  root: string | undefined,
): RouteHandler {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const channelId = params['channelId'] ?? '';
    if (!isValidChannelId(channelId)) {
      sendJson(res, 400, { error: 'invalid channel id' });
      return;
    }

    const parsed = await parseJsonBody<{
      text?: unknown;
      threadId?: unknown;
      clientId?: unknown;
      answersAskId?: unknown;
    }>(req, res);
    if (!parsed) return;
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    if (!text) {
      sendJson(res, 400, { error: 'text is required' });
      return;
    }
    const threadId =
      typeof parsed.threadId === 'string' && parsed.threadId ? parsed.threadId : undefined;
    // Bounded: it is a key, not a payload, and it goes into every row of the log.
    const clientId =
      typeof parsed.clientId === 'string' && parsed.clientId
        ? parsed.clientId.slice(0, 200)
        : undefined;

    // A message must land in a channel that exists and that this member can see.
    // Without the existence half, a typo'd id silently created an invisible
    // channel: the transcript accumulated, the socket broadcast it, and nothing
    // ever listed it.
    const caller = readCaller(req);
    const channel = await requireVisibleChannel(root, channelId, caller, res);
    if (!channel) return;

    // Which question, if any, this message is about to resolve. Read BEFORE the
    // append so the row itself can say so.
    const pendingId = threadId ? pendingAskId(channelId, threadId) : null;

    // A client that knows about the ask names it. If it names one that is not the
    // one this thread is waiting on, its picture of the thread is stale — refuse
    // rather than submitting the words to whatever question happens to be open
    // now, and let it re-read. This is the whole difference between answering a
    // question and having a sentence taken as an answer to a different one.
    if (typeof parsed.answersAskId === 'string' && parsed.answersAskId) {
      if (parsed.answersAskId !== pendingId) {
        sendJson(res, 409, {
          error: 'that question is no longer open',
          ...(pendingId ? { pendingAskId: pendingId } : {}),
        });
        return;
      }
    }
    const explicitAnswer = parsed.answersAskId === pendingId && !!pendingId;

    if (caller) await touchMember(root, caller.userId, caller.email);
    const mentioned = resolveMentions(text, await listMembers(root));

    const { message, created } = await appendMessageOnce(root, {
      channelId,
      kind: 'user',
      text,
      ...(caller ? { userId: caller.userId, email: caller.email } : {}),
      ...(threadId ? { threadId } : {}),
      ...(clientId ? { clientId } : {}),
      ...(pendingId ? { answersAsk: pendingId } : {}),
      ...(mentioned.length ? { mentions: mentioned.map((m) => m.userId) } : {}),
    });

    // The same send, arriving twice. The row already exists, so everything that
    // ANNOUNCES it has already happened: re-broadcasting would put a second copy
    // in every open transcript, and re-delivering would badge and push twice for
    // one message. Hand back the row the first attempt stored.
    if (!created) {
      sendJson(res, 200, { message, deduplicated: true });
      return;
    }

    broadcastChannelEvent({ type: 'message', message }, audienceFor(channel));

    // Answer now; THING (if addressed) replies onto the socket in its own time.
    sendJson(res, 201, { message });

    // Bookkeeping the sender should never wait on, and whose failure must not
    // turn a delivered message into an error the composer reports.
    track(deliver(root, channel, message).catch(() => {}));

    // A thread waiting on a question takes this message as the ANSWER: the turn
    // that asked is still suspended, so starting a second one would leave the
    // first pinned forever and run two conversations over one session.
    const claimed = message.threadId ? takePendingAsk(channelId, message.threadId) : null;
    if (claimed) {
      track(
        (async () => {
          // Say so, unless the sender said it first. Without a receipt the
          // fallback is spooky: somebody types "brb" in a thread with an open
          // question and it is submitted as the answer with nothing anywhere
          // admitting it happened.
          if (!explicitAnswer) {
            await postAskReceipt(root, channel, message, claimed.askId).catch(() => {});
          }
          claimed.submit(text);
        })(),
      );
      return;
    }

    if (await addressesThing(root, message)) {
      // The caller travels with the turn as a VALUE. This is the only place it is
      // trustworthy — the request is here and its identity headers came from Envoy —
      // and the turn it starts runs headless, long after this handler returns, so
      // there is nothing for it to read the caller back OUT of. A turn with no
      // verified caller (only reachable off the edge) gets no team globals at all.
      track(beginThingReply(manager, root, message, channel, caller));
    }
  };
}

/**
 * Start a THING turn, and report it as finished for DRAINING purposes the moment
 * it either completes or parks on a question.
 *
 * A turn waiting for somebody to answer an `ask()` is not work in flight — it is
 * work waiting on a human, and it may wait forever by design. Tracking it as
 * in-flight made `settleChannelWork` never return, which is the shutdown drain:
 * one unanswered question would have hung the pod's graceful shutdown (and every
 * test that drains) indefinitely.
 *
 * The run itself continues untracked; when the answer arrives it finishes and
 * posts, exactly as before.
 */
function beginThingReply(
  manager: SessionManager,
  root: string,
  message: ChannelMessage,
  channel: Channel,
  caller: TeamCaller | null,
): Promise<void> {
  let release!: () => void;
  const untilParkedOrDone = new Promise<void>((resolve) => (release = resolve));
  let run: Promise<void> | undefined;
  let parked = false;
  run = runThingReply(
    manager,
    root,
    message,
    channel,
    caller,
    () => {
      parked = true;
      release();
    },
    // Answered. It is work in flight again — a shutdown, and a test's drain,
    // must wait for it. Only the WAITING is untrackable; without this the rest
    // of the turn (its answer, its app card, its badges) ran with nothing
    // holding the door, which showed up as a teardown deleting the runtime root
    // out from under a write.
    () => {
      if (!parked || !run) return;
      parked = false;
      track(run);
    },
  ).finally(release);
  return untilParkedOrDone;
}

/**
 * Whether this message is talking to THING.
 *
 * `@thing` addresses it anywhere. **Inside a thread THING is already in, every
 * reply addresses it** — having to re-@ the agent in a thread it is a
 * participant of is not how a conversation works, and the effect was that a
 * natural reply went nowhere and the thread looked dead.
 *
 * "Already in" is decided by the presence of a thread session rather than by
 * scanning the channel log for a `thing` message: the entry exists exactly when
 * THING has run in this thread, which is O(1) and — unlike any scan — cannot be
 * defeated by a busy channel pushing the thread's root out of the read window.
 * It is a read; a message that turns out not to be addressed must not mint a
 * session for a conversation that never happened.
 *
 * A channel-level post still needs the mention. Threads are the scope that makes
 * implicit addressing safe: you opt in by opening one with THING.
 */
async function addressesThing(root: string, message: ChannelMessage): Promise<boolean> {
  if (mentionsThing(message.text)) return true;
  if (!message.threadId) return false;
  const session = await getThreadSession(
    teamDir(root),
    `channel:${message.channelId}`,
    message.threadId,
  ).catch(() => null);
  return session !== null;
}

/**
 * Everything that happens to a message AFTER it is stored and broadcast:
 * badges for the people it names, and a push for those of them who are not here.
 *
 * Separated from the post handler because none of it is the poster's business —
 * they have already had their 201, and a failure to raise somebody else's badge
 * is not a failure to send.
 */
async function deliver(root: string, channel: Channel, message: ChannelMessage): Promise<void> {
  const named = mentionAudience(channel, message);
  await addMentions(root, channel.id, named, message.userId);
  // Posting IS reading — up to your own message and no further. Reading to the
  // END of the channel here would also mark the sender read on anything a
  // colleague posted in the same instant, which they have not seen.
  if (message.userId) {
    await markRead(root, message.userId, channel.id, {
      messageId: message.id,
      ...(typeof message.seq === 'number' ? { seq: message.seq } : {}),
    });
  }

  const targets = await pushAudience(root, channel, message, connectedUserIds());
  if (!targets.length) return;

  // The gateway addresses devices, not people-by-name, so the pod supplies the
  // name: it is the only side that knows this team's directory.
  const members = await listMembers(root);
  const sender =
    message.kind === 'thing'
      ? // A post THING made because somebody asked it to says so. Waking a phone
        // with a message from an assistant in a channel the reader never asked in
        // is only intelligible if it names whose request produced it — and that
        // member is also who to ask about it.
        message.onBehalfOf
        ? `THING (for ${message.onBehalfOf.label})`
        : 'THING'
      : memberLabel(
          members.find((m) => m.userId === message.userId),
          message.email ?? 'Someone',
        );
  const teamId = process.env['LMTHING_TEAM_ID'] ?? '';
  await sendPushRequest({ ...pushPayload(channel, message, sender, teamId), userIds: targets });
}

/**
 * What a channel says when a turn fails.
 *
 * A channel is shared and permanent, so its failure text is read by colleagues
 * who did not ask and is quoted by a push notification. It went out raw: a live
 * run posted **"THING could not answer: Lifetime not alive"** — QuickJS's wording
 * for an operation on a disposed handle — into a newsroom's channel.
 *
 * The rule is not "hide errors". A member needs to know it failed, and whether
 * trying again is worth anything. What they cannot use is the internals: a
 * sandbox lifetime string, a stack, a TypeScript diagnostic, an HTTP status from
 * something they have never heard of. Those go to the server log, which is where
 * somebody who can act on them will look.
 *
 * Kept deliberately small. Anything not recognised is reported as an unexpected
 * failure rather than passed through, because passing through is how the last one
 * reached a user.
 */
export function channelFailureText(raw: string): string {
  const e = raw.toLowerCase();
  if (/lifetime not alive|disposed|vm|sandbox/.test(e)) {
    return 'THING could not finish that — its workspace was restarted mid-answer. Ask again and it will pick up where the thread left off.';
  }
  if (/budget|quota|limit reached|429/.test(e)) {
    return "THING could not finish that — the team's usage limit was reached. It will work again once the limit resets.";
  }
  if (/timeout|timed out|etimedout|aborted/.test(e)) {
    return 'THING could not finish that — it ran out of time. Asking for a smaller piece of it usually works.';
  }
  if (/econnrefused|enotfound|econnreset|fetch failed|socket hang up|network/.test(e)) {
    return 'THING could not finish that — it could not reach a service it needed. Worth trying again shortly.';
  }
  return 'THING could not finish that. Trying again is worth a go; if it keeps happening, the workspace log has the detail.';
}

/**
 * Answer a mention in the thread it was asked in.
 *
 * The session id is stable per (channel, thread), so every message in a thread
 * resumes the same conversation — which is what "THING remembers the
 * conversation across messages" means, and why a colleague replying in the same
 * thread is talking to an agent that already has the context.
 * `runHeadlessThreaded` serializes concurrent turns on one session, so two
 * people mentioning THING at once queue rather than corrupt each other.
 */
async function runThingReply(
  manager: SessionManager,
  root: string,
  message: ChannelMessage,
  channel: Channel,
  /** The verified member whose message started this turn — the identity every
   *  team global answers for. `null` means no verified caller reached us, and the
   *  turn runs with no team globals rather than with a guessed identity. */
  caller: TeamCaller | null,
  /** Called when this turn parks on a question — see {@link beginThingReply}. */
  onParked: () => void = () => {},
  /** Called when that question is answered and the turn is running again. */
  onResumed: () => void = () => {},
): Promise<void> {
  const threadId = threadRootOf(message);
  const to = audienceFor(channel);
  const key = pendingKey(message.channelId, threadId);
  const startedAt = new Date().toISOString();
  const turn: ThingTurn = { channelId: message.channelId, threadId, status: 'running', startedAt };
  liveTurns.set(key, turn);
  broadcastChannelEvent(
    { type: 'thing_status', channelId: message.channelId, threadId, status: 'running', startedAt },
    to,
  );

  // What the team already had an app for, so anything new is attributable to
  // this turn. Snapshotted before the run, not diffed against a stored list,
  // because a project can also gain an app from Studio while nobody is watching.
  const appsBefore = await projectsWithApps(root);
  // Snapshotted alongside it, for the same reason: what the team had BEFORE this
  // turn, so a change is attributable to it rather than diffed against a stored
  // list a Studio edit could have moved while nobody was watching.
  const fingerprintsBefore = await appFingerprints(root);

  // The host is OURS, not a throwaway, so an `ask()` becomes a question in the
  // thread instead of a promise nobody can settle.
  const renderHost = new WebRenderHost();
  const stopWatching = renderHost.onEvent((event) => {
    if (event.type === 'ask_start') {
      const expiresAt = new Date(Date.now() + askTimeoutMs()).toISOString();
      pendingAsks.set(key, {
        renderHost,
        askId: event.id,
        expiresAt,
        timer: startAskTimer(root, message.channelId, threadId, channel, to),
      });
      // The busy indicator was the last thing a client heard, and it says
      // "working". It is not working — it is blocked on a person, and nothing
      // told them so.
      turn.status = 'waiting';
      turn.askId = event.id;
      delete turn.activity;
      broadcastChannelEvent(
        {
          type: 'thing_status',
          channelId: message.channelId,
          threadId,
          status: 'waiting',
          startedAt,
          askId: event.id,
        },
        to,
      );
      track(
        postAsk(root, message, channel, threadId, event.descriptor, event.id, expiresAt).catch(
          () => {},
        ),
      );
      // Parked on a human. Stop counting this run as work a drain should wait for.
      onParked();
    } else if (event.type === 'ask_end') {
      clearAsk(key);
      onResumed();
      // Answered: it is thinking again, and a client that dimmed the thread has
      // to be told, or the thread stays "waiting" for the rest of the turn.
      if (liveTurns.get(key) === turn) {
        turn.status = 'running';
        delete turn.askId;
        broadcastChannelEvent(
          {
            type: 'thing_status',
            channelId: message.channelId,
            threadId,
            status: 'running',
            startedAt,
          },
          to,
        );
      }
    }
  });

  try {
    const sessionId = await getOrCreateThreadSession(
      teamDir(root),
      `channel:${message.channelId}`,
      threadId,
    );
    const result = await manager.runHeadlessThreaded({
      sessionId,
      agentSlug: THING_AGENT,
      message: promptFor(message),
      // Name the turn in the pod's session ledger. A channel turn has no client
      // asking for it, so it is the one kind of run a member cannot see the cost
      // of anywhere else — and on a team pod the tokens are the TEAM's.
      origin: { source: 'team-channel' },
      // A viewer may talk to THING and may not change the workspace. Passing the
      // role withholds every write grant for this turn, so a write is a typecheck
      // error the model sees rather than a rule it may or may not follow — which
      // is what it was: the same request got a proper refusal in one live run and
      // was silently ignored in another.
      // `caller` is null only when no verified identity reached us, which the
      // guard should already have refused. Fail CLOSED on it rather than treating
      // "we don't know who this is" as permission to write.
      readOnly: caller?.role !== 'editor',
      // The team surface (`team:read`/`team:post`). Built here, per turn, closed
      // over THIS caller and channel — which is what makes "who asked?" answerable
      // inside a headless run without an ambient current-user. A post THING makes
      // reaches the same sockets and badges a member's would, via these hooks.
      ...(caller
        ? {
            team: createTeamResolver(
              root,
              { caller, channel, threadId },
              {
                onPost: (posted, into) => {
                  broadcastChannelEvent({ type: 'message', message: posted }, audienceFor(into));
                  track(deliver(root, into, posted).catch(() => {}));
                },
                onChannelChanged: (changed) =>
                  broadcastChannelEvent({ type: 'channel', channel: changed }, audienceFor(changed)),
              },
            ),
          }
        : {}),
      // People are watching this thread. Without it the turn loop's anti-silent
      // guard stays off — the guard is meant to skip forks, hooks and code-node
      // runs that nobody reads — so a turn that did work and displayed nothing
      // settled `done` in silence and the thread got no answer at all.
      // Deliberately NOT `interactive`: that also grants the consent prompter,
      // which needs somebody able to ANSWER, and a channel has no such client.
      visibleToUser: true,
      renderHost,
      // A build can run for minutes. Without this the thread shows nothing at all
      // until it finishes, which a reader cannot tell apart from a hang.
      onActivity: (activity) => {
        // Kept on the turn as well as broadcast, so a member who opens the
        // channel mid-build learns what it is doing rather than only that
        // something is.
        turn.activity = activity;
        broadcastChannelEvent(
          {
            type: 'thing_status',
            channelId: message.channelId,
            threadId,
            status: 'running',
            startedAt,
            activity,
          },
          to,
        );
      },
    });

    const answer = result.ok
      ? renderResult(result)
      : (() => {
          const raw = result.error ?? 'unknown error';
          console.error(`[team-channel] turn failed in #${message.channelId}: ${raw}`);
          return { text: channelFailureText(raw) };
        })();

    const reply = await appendMessage(root, {
      channelId: message.channelId,
      kind: result.ok ? 'thing' : 'system',
      ...answer,
      threadId,
      sessionId,
      // An answer is addressed to whoever asked. Stamping it as a mention is
      // what makes "you asked THING something and it finished while you were
      // away" reach you — an agent turn can take minutes, which is exactly the
      // span over which somebody closes the tab.
      ...(message.userId ? { mentions: [message.userId] } : {}),
    });
    broadcastChannelEvent({ type: 'message', message: reply }, to);
    track(deliver(root, channel, reply).catch(() => {}));
    broadcastChannelEvent(
      {
        type: 'thing_status',
        channelId: message.channelId,
        threadId,
        status: result.ok ? 'done' : 'error',
      },
      to,
    );

    if (result.ok) await announceNewApps(root, message, threadId, appsBefore, to, fingerprintsBefore);
  } catch (err) {
    console.error(`[team-channel] turn threw in #${message.channelId}:`, err);
    const reply = await appendMessage(root, {
      channelId: message.channelId,
      kind: 'system',
      text: channelFailureText(err instanceof Error ? err.message : String(err)),
      threadId,
      // Reach the asker on a FAILURE too. The success path stamps this and the
      // crash path did not, so the one outcome you most need to be told about was
      // the only one that never badged you or reached your phone — you asked,
      // closed the tab, and the thread quietly held a failure addressed to nobody.
      ...(message.userId ? { mentions: [message.userId] } : {}),
    });
    broadcastChannelEvent({ type: 'message', message: reply }, to);
    // Same reason: `deliver` is what raises the badge and sends the push. Without
    // it the message exists and nothing announces it.
    track(deliver(root, channel, reply).catch(() => {}));
    broadcastChannelEvent(
      { type: 'thing_status', channelId: message.channelId, threadId, status: 'error' },
      to,
    );
  } finally {
    // The turn is over either way, so nothing can answer an ask on this host any
    // more. Leaving the entry behind would swallow the NEXT message in the thread
    // as an answer to a question nobody is waiting on.
    stopWatching();
    if (pendingAsks.get(key)?.renderHost === renderHost) clearAsk(key);
    if (liveTurns.get(key) === turn) liveTurns.delete(key);
  }
}

// ─── THING asking the thread a question ──────────────────────────────────────
//
// `ask()` suspends the turn until somebody answers. In `/chat` a client renders
// the form and posts the value back; a channel has no such client, so the
// question becomes a message in the thread and the next reply is the answer.
//
// The turn is held for as long as that takes — the owner's call, over a flagged
// objection that an unanswered ask pins a session. In practice a thread heals
// itself: every reply in a THING thread addresses THING, so the first thing
// anybody says resolves it. Only a thread nobody returns to stays suspended, and
// a pod restart clears those.

interface PendingAsk {
  renderHost: WebRenderHost;
  askId: string;
  /** ISO — also stamped on the question row, so a client can show the deadline. */
  expiresAt: string;
  /** Fires {@link expireAsk}. Cleared on every path out of the ask. */
  timer: NodeJS.Timeout;
}

/** channel+thread → the ask that thread is waiting on. */
const pendingAsks = new Map<string, PendingAsk>();

function pendingKey(channelId: string, threadId: string): string {
  return `${channelId}::${threadId}`;
}

/**
 * How long a question stays open before the pod stops holding the thread for it.
 *
 * The TURN is still not killed — the owner's decision that a parked turn waits
 * indefinitely stands, and nothing here cancels a run. What is bounded is the
 * QUESTION: on expiry the ask is resolved with "nobody answered", the run
 * resumes and finishes normally, and the thread says so. That is the difference
 * between a turn that ends behind your back and one that stops waiting for you.
 *
 * Bounding it matters because an open ask is not passive: it holds the thread's
 * session lock, so every later message in that thread queues behind a question
 * nobody is going to answer — a thread that is not merely stuck but silently
 * stuck. One hour, because a question in a work channel that nobody has answered
 * in an hour has lost its moment, and because the alternative bound (a pod
 * restart) is not one anybody can predict.
 */
const DEFAULT_ASK_TIMEOUT_MS = 60 * 60 * 1000;

function askTimeoutMs(): number {
  const raw = Number(process.env['LMTHING_TEAM_ASK_TIMEOUT_MS']);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ASK_TIMEOUT_MS;
}

/** Drop a pending ask and its timer. Idempotent — several paths race to do it. */
function clearAsk(key: string): void {
  const pending = pendingAsks.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingAsks.delete(key);
}

function startAskTimer(
  root: string,
  channelId: string,
  threadId: string,
  channel: Channel,
  to: ReturnType<typeof audienceFor>,
): NodeJS.Timeout {
  const timer = setTimeout(() => {
    track(expireAsk(root, channelId, threadId, channel, to).catch(() => {}));
  }, askTimeoutMs());
  // A question waiting on a human must not be the reason a pod stays alive.
  timer.unref?.();
  return timer;
}

/**
 * Give up waiting: tell the agent nobody answered, and tell the thread that is
 * what happened.
 *
 * The value submitted is prose rather than an error, because `ask()`'s contract
 * is a value and an agent that receives one can decide for itself whether to
 * proceed or to stop and say what it still needs. Throwing into the turn would
 * turn "nobody was around" into a crash report.
 */
async function expireAsk(
  root: string,
  channelId: string,
  threadId: string,
  channel: Channel,
  to: ReturnType<typeof audienceFor>,
): Promise<void> {
  const key = pendingKey(channelId, threadId);
  const pending = pendingAsks.get(key);
  if (!pending) return;
  clearAsk(key);
  const minutes = Math.round(askTimeoutMs() / 60000);
  const note = await appendMessage(root, {
    channelId,
    kind: 'system',
    text: `Nobody answered THING’s question for ${minutes} minute${minutes === 1 ? '' : 's'}, so it has been told to carry on without an answer.`,
    threadId,
    answersAsk: pending.askId,
  });
  broadcastChannelEvent({ type: 'message', message: note }, to);
  track(deliver(root, channel, note).catch(() => {}));
  pending.renderHost.submitForm(
    pending.askId,
    'Nobody answered in the channel. Continue with your best judgement, or stop and say what you still need.',
  );
}

/**
 * Claim a thread's open question, so the caller can do something in between
 * taking it and submitting the answer.
 *
 * Claiming and submitting are separate because the receipt has to be in the log
 * BEFORE the agent is unblocked: the resumed turn posts its answer as soon as it
 * can, so appending "that reply was taken as the answer" afterwards races it and
 * the explanation lands under the thing it was explaining. Claiming is
 * synchronous either way, so the next message in the thread cannot slip in and
 * start a second turn while the receipt is being written.
 */
function takePendingAsk(
  channelId: string,
  threadId: string,
): { askId: string; submit: (text: string) => void } | null {
  const key = pendingKey(channelId, threadId);
  const pending = pendingAsks.get(key);
  if (!pending) return null;
  clearAsk(key);
  return {
    askId: pending.askId,
    submit: (text: string) => pending.renderHost.submitForm(pending.askId, text),
  };
}

/**
 * Answer a thread's open question with what somebody typed, if there is one.
 *
 * The value is the raw text rather than a filled form: a channel reply is prose,
 * and `ask()`'s contract is that it returns what the user supplied. An agent that
 * asked with structured options still gets the words back, which is the same
 * thing a person would say out loud.
 */
export function answerPendingAsk(channelId: string, threadId: string, text: string): boolean {
  const pending = takePendingAsk(channelId, threadId);
  if (!pending) return false;
  pending.submit(text);
  return true;
}

/** The id of the question this thread is waiting on, or `null`. */
export function pendingAskId(channelId: string, threadId: string): string | null {
  return pendingAsks.get(pendingKey(channelId, threadId))?.askId ?? null;
}

/** Whether this thread is waiting on an answer — exported for tests. */
export function hasPendingAsk(channelId: string, threadId: string): boolean {
  return pendingAsks.has(pendingKey(channelId, threadId));
}

/**
 * Put THING's question into the thread.
 *
 * Stored as `blocks` for the same reason a JSX answer is: the descriptor IS the
 * question, and a channel that stored its source could only ever render source.
 * `text` carries the flattened prose so a notification and a client that cannot
 * draw components both have something to read.
 *
 * `ask: {id, expiresAt}` is what makes it a QUESTION on the wire rather than
 * another paragraph from the agent. Without it a client cannot tell a question
 * from an answer even in principle — the row is byte-identical to a reply — so
 * it cannot draw a form, cannot say "answer this", and cannot name the ask when
 * it posts the answer back.
 */
async function postAsk(
  root: string,
  message: ChannelMessage,
  channel: Channel,
  threadId: string,
  descriptor: unknown,
  askId: string,
  expiresAt: string,
): Promise<void> {
  const rendered = renderResult({ ok: true, displays: [descriptor], sessionId: '' });
  const asked = await appendMessage(root, {
    channelId: message.channelId,
    kind: 'thing',
    ...rendered,
    threadId,
    ask: { id: askId, expiresAt },
    // The question is FOR whoever asked, and an agent turn can outlast their
    // attention — without the badge they never learn they are being waited on.
    ...(message.userId ? { mentions: [message.userId] } : {}),
  });
  broadcastChannelEvent({ type: 'message', message: asked }, audienceFor(channel));
  track(deliver(root, channel, asked).catch(() => {}));
}

/**
 * Record that somebody's ordinary reply was taken as the answer to a question.
 *
 * Only for the IMPLICIT case. "Any reply in the thread answers the open
 * question" is a deliberate fallback — it is the only way a client that knows
 * nothing about asks can answer one at all — but it is spooky rather than
 * helpful when it is silent: two people are in a thread, one of them types
 * "brb", and those words are submitted to the agent with nothing anywhere
 * admitting it. A client that named the ask in its POST is not told twice.
 */
async function postAskReceipt(
  root: string,
  channel: Channel,
  answer: ChannelMessage,
  askId: string,
): Promise<void> {
  const members = await listMembers(root);
  const who = memberLabel(
    members.find((m) => m.userId === answer.userId),
    answer.email ?? 'Someone',
  );
  const said = answer.text.length > 120 ? `${answer.text.slice(0, 117)}…` : answer.text;
  const receipt = await appendMessage(root, {
    channelId: channel.id,
    kind: 'system',
    text: `${who}’s reply was taken as the answer to THING’s question: “${said}”`,
    ...(answer.threadId ? { threadId: answer.threadId } : {}),
    ...(askId ? { answersAsk: askId } : {}),
  });
  broadcastChannelEvent({ type: 'message', message: receipt }, audienceFor(channel));
}

// ─── Apps beside a channel ───────────────────────────────────────────────────

/**
 * Whether a project has something openable beside a channel.
 *
 * The test is the `pages/` directory, not the loader's broader `hasApp` (which
 * is true for a project with only a database or an API). What gets pinned to a
 * channel is a thing a member can look at; an app with no pages has no URL to
 * put in the pane next to the conversation.
 *
 * A bare directory check rather than `loadProjectApp`: this runs once per
 * project on every directory read, and the loader parses every schema.
 */
async function projectHasApp(root: string, projectId: string): Promise<boolean> {
  try {
    return (await stat(join(root, projectId, 'pages'))).isDirectory();
  } catch {
    return false;
  }
}

async function projectsWithApps(root: string): Promise<Set<string>> {
  try {
    const projects = await listProjects(root);
    const flags = await Promise.all(projects.map((p) => projectHasApp(root, p.id)));
    return new Set(projects.filter((_, i) => flags[i]).map((p) => p.id));
  } catch {
    return new Set();
  }
}

/** The authored surface of an app — what a build reads, not what it emits. */
const APP_DIRS = ['database', 'api', 'pages', 'components'] as const;

/**
 * A cheap fingerprint of a project's authored files, for telling "this app
 * CHANGED" from "this app existed already".
 *
 * Membership of {@link projectsWithApps} can only answer "did a `pages/` dir
 * appear", which is true exactly once in an app's life. Every later turn — every
 * "add a column", "add a page", "sort it by deadline" — left the set identical,
 * so the channel said nothing at all about work it had just done.
 *
 * Name + mtime, not content: an authoring write always moves mtime, and hashing
 * bodies would make this cost scale with the app rather than with the number of
 * files. Only the four AUTHORED dirs are walked — build output lives under
 * `.data/`, so a rebuild alone cannot look like an edit.
 */
async function appFingerprints(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const projects = await listProjects(root);
    await Promise.all(
      projects.map(async (p) => {
        const parts: string[] = [];
        for (const dir of APP_DIRS) {
          const base = join(root, p.id, dir);
          let entries;
          try {
            entries = await readdir(base, { recursive: true, withFileTypes: true });
          } catch {
            continue;
          }
          for (const e of entries) {
            if (!e.isFile()) continue;
            try {
              const st = await stat(join(e.parentPath ?? base, e.name));
              parts.push(`${dir}/${e.name}:${st.mtimeMs}`);
            } catch {
              /* raced with a write — the next turn will see it */
            }
          }
        }
        if (parts.length) out.set(p.id, createHash('sha1').update(parts.sort().join('|')).digest('hex'));
      }),
    );
  } catch {
    /* no projects yet */
  }
  return out;
}

/**
 * Pin any app THING just built to the channel it was asked for in, and say so
 * three ways.
 *
 * "Ask for an app in a channel, get the app beside the channel" is the whole
 * point — a member who has to go and find what they just asked for in a
 * different surface has not been handed anything. So:
 *
 *   1. the app is PINNED to the channel, which is what makes it a tab in the
 *      channel header tomorrow as well as today;
 *   2. a `system` card is appended to the thread, so scrolling back through the
 *      conversation still shows what it produced and offers to open it;
 *   3. an `app_created` event goes out, which is what lets the member who asked
 *      have it open beside them without touching anything.
 *
 * All three are best-effort around an answer that has already been delivered.
 */
async function announceNewApps(
  root: string,
  ask: ChannelMessage,
  threadId: string,
  before: Set<string>,
  to: ReturnType<typeof audienceFor>,
  fingerprintsBefore: Map<string, string> = new Map(),
): Promise<void> {
  try {
    const after = await projectsWithApps(root);
    const fresh = [...after].filter((id) => !before.has(id));
    // An app the team ALREADY had, whose authored files this turn changed. Without
    // this the channel announced an app exactly once in its life and then went
    // silent for every later change — so "add a column for whether the pictures
    // are in" produced a reply saying it was done and no sign of it anywhere in
    // the surface the team actually looks at.
    const fingerprintsAfter = await appFingerprints(root);
    const updated = [...after].filter(
      (id) => before.has(id) && fingerprintsBefore.get(id) !== fingerprintsAfter.get(id),
    );
    if (!fresh.length && !updated.length) return;

    const projects = await listProjects(root);
    const nameOf = new Map(projects.map((p) => [p.id, p.name]));
    const channels = await ensureDefaultChannel(root);
    const current = channels.find((c) => c.id === ask.channelId)?.apps ?? [];
    // Pin anything this turn touched that this channel does not already carry —
    // an app the team built elsewhere and has now been working on HERE belongs in
    // this channel's header too.
    const pin = [...fresh, ...updated].filter((id) => !current.includes(id));
    const channel = await patchChannel(root, ask.channelId, { apps: [...current, ...pin] });
    broadcastChannelEvent({ type: 'channel', channel }, to);

    for (const projectId of [...fresh, ...updated]) {
      const isNew = fresh.includes(projectId);
      const name = nameOf.get(projectId) ?? projectId;
      const card = await appendMessage(root, {
        channelId: ask.channelId,
        kind: 'system',
        text: isNew ? `${name} is ready.` : `${name} was updated.`,
        threadId,
        app: { projectId, name },
      });
      broadcastChannelEvent({ type: 'message', message: card }, to);
      // Only a genuinely NEW app throws itself open beside the member. An update
      // to something they are already looking at must not seize the pane.
      if (isNew) broadcastChannelEvent(
        {
          type: 'app_created',
          channelId: ask.channelId,
          threadId,
          projectId,
          name,
          ...(ask.userId ? { requestedBy: ask.userId } : {}),
        },
        to,
      );
    }
  } catch {
    // The answer is already posted and the app is already built. Failing to
    // announce it costs a member one click, and is not worth turning a
    // successful turn into an error.
  }
}

/**
 * Turn what the agent returned into the fields of a channel message.
 *
 * THING answers in JSX far more often than in prose — `display(<Stack>…)` is
 * the house style — and a JSX answer is a `{type, props, children}` descriptor,
 * not a string. This used to end at `JSON.stringify(result)`, so the channel
 * stored the descriptor's source and the reader got a wall of braces where the
 * card should have been.
 *
 * So: descriptors are kept as `blocks` (reduced to allowed components, since a
 * channel is not the place to discover a component nobody ships), and `text`
 * carries the flattened prose for every client and index that wants a string.
 * A prose answer still stores just `text` — nothing changes for those.
 */
function renderResult(result: HeadlessRunResult): { text: string; blocks?: unknown[] } {
  // Prefer every display of the turn over the single `result`: an agent that
  // displayed a heading and then a table said both things, and the channel post
  // is the whole answer, not its last paragraph.
  const raw = result.displays?.length ? result.displays : [result.result];
  const blocks: unknown[] = [];
  const prose: string[] = [];

  for (const value of raw) {
    if (value === undefined || value === null) continue;
    // A descriptor may arrive already serialized (an older writer, a resumed
    // snapshot) — that is still a descriptor, not prose.
    const descriptor = typeof value === 'string' ? parseDescriptorPayload(value) : value;
    if (typeof value === 'string' && !descriptor) {
      prose.push(value);
      continue;
    }
    if (isJsxDescriptor(descriptor) || Array.isArray(descriptor)) {
      const clean = sanitizeDescriptor(descriptor);
      const asList = Array.isArray(clean) ? clean : [clean];
      for (const node of asList) {
        if (node === undefined || node === null) continue;
        // Unwrapping an unrecognised component can leave a bare string where a
        // node was. Keep it in place as a Paragraph so the answer stays a list
        // of components and the reading order survives.
        const block = typeof node === 'string' ? { type: 'Paragraph', props: {}, children: [node] } : node;
        blocks.push(block);
        prose.push(descriptorToText(block));
      }
      continue;
    }
    // Not a descriptor and not a string: an agent that returned data. Keep the
    // old string-ish reading before falling back to JSON — a `{text}` or
    // `{content}` envelope is prose someone wrapped.
    const envelope = value as { text?: unknown; content?: unknown };
    if (typeof envelope.text === 'string') prose.push(envelope.text);
    else if (typeof envelope.content === 'string') prose.push(envelope.content);
    else prose.push(JSON.stringify(value));
  }

  // A turn that displayed nothing has nothing to post. Say that, rather than
  // reaching for the turn's own source: what the agent WRITES is TypeScript, so
  // a "fallback to the last thing it produced" is a fallback to code, and the
  // channel showed a reader three comment lines and a `setActivity(...)` call.
  const text =
    prose.filter((p) => p.trim()).join('\n\n').trim() ||
    'THING finished without posting an answer.';
  return blocks.length ? { text, blocks } : { text };
}
