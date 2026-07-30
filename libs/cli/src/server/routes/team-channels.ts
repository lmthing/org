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
import { stat } from 'node:fs/promises';
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
    await markRead(root, caller.userId, channelId);
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
    const { messages, hasMore } = await readMessages(root, channelId, {
      ...(Number.isFinite(limitRaw) && limitRaw > 0 ? { limit: limitRaw } : {}),
      ...(before ? { before } : {}),
    });
    sendJson(res, 200, { messages, hasMore });
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

    const parsed = await parseJsonBody<{ text?: unknown; threadId?: unknown }>(req, res);
    if (!parsed) return;
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    if (!text) {
      sendJson(res, 400, { error: 'text is required' });
      return;
    }

    // A message must land in a channel that exists and that this member can see.
    // Without the existence half, a typo'd id silently created an invisible
    // channel: the transcript accumulated, the socket broadcast it, and nothing
    // ever listed it.
    const caller = readCaller(req);
    const channel = await requireVisibleChannel(root, channelId, caller, res);
    if (!channel) return;

    if (caller) await touchMember(root, caller.userId, caller.email);
    const mentioned = resolveMentions(text, await listMembers(root));

    const message = await appendMessage(root, {
      channelId,
      kind: 'user',
      text,
      ...(caller ? { userId: caller.userId, email: caller.email } : {}),
      ...(typeof parsed.threadId === 'string' && parsed.threadId
        ? { threadId: parsed.threadId }
        : {}),
      ...(mentioned.length ? { mentions: mentioned.map((m) => m.userId) } : {}),
    });
    broadcastChannelEvent({ type: 'message', message }, audienceFor(channel));

    // Answer now; THING (if addressed) replies onto the socket in its own time.
    sendJson(res, 201, { message });

    // Bookkeeping the sender should never wait on, and whose failure must not
    // turn a delivered message into an error the composer reports.
    track(deliver(root, channel, message).catch(() => {}));

    if (await addressesThing(root, message)) {
      track(runThingReply(manager, root, message, channel));
    }
  };
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
  // Posting IS reading: without this, your own message leaves the channel it
  // landed in looking unread to you, because unread is derived from the log's
  // mtime and you just moved it.
  if (message.userId) await markRead(root, message.userId, channel.id);

  const targets = await pushAudience(root, channel, message, connectedUserIds());
  if (!targets.length) return;

  // The gateway addresses devices, not people-by-name, so the pod supplies the
  // name: it is the only side that knows this team's directory.
  const members = await listMembers(root);
  const sender =
    message.kind === 'thing'
      ? 'THING'
      : memberLabel(
          members.find((m) => m.userId === message.userId),
          message.email ?? 'Someone',
        );
  const teamId = process.env['LMTHING_TEAM_ID'] ?? '';
  await sendPushRequest({ ...pushPayload(channel, message, sender, teamId), userIds: targets });
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
): Promise<void> {
  const threadId = threadRootOf(message);
  const to = audienceFor(channel);
  broadcastChannelEvent(
    { type: 'thing_status', channelId: message.channelId, threadId, status: 'running' },
    to,
  );

  // What the team already had an app for, so anything new is attributable to
  // this turn. Snapshotted before the run, not diffed against a stored list,
  // because a project can also gain an app from Studio while nobody is watching.
  const appsBefore = await projectsWithApps(root);

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
    });

    const answer = result.ok
      ? renderResult(result)
      : { text: `THING could not answer: ${result.error ?? 'unknown error'}` };

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

    if (result.ok) await announceNewApps(root, message, threadId, appsBefore, to);
  } catch (err) {
    const reply = await appendMessage(root, {
      channelId: message.channelId,
      kind: 'system',
      text: `THING could not answer: ${err instanceof Error ? err.message : String(err)}`,
      threadId,
    });
    broadcastChannelEvent({ type: 'message', message: reply }, to);
    broadcastChannelEvent(
      { type: 'thing_status', channelId: message.channelId, threadId, status: 'error' },
      to,
    );
  }
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
): Promise<void> {
  try {
    const after = await projectsWithApps(root);
    const fresh = [...after].filter((id) => !before.has(id));
    if (!fresh.length) return;

    const projects = await listProjects(root);
    const nameOf = new Map(projects.map((p) => [p.id, p.name]));
    const channels = await ensureDefaultChannel(root);
    const current = channels.find((c) => c.id === ask.channelId)?.apps ?? [];
    const channel = await patchChannel(root, ask.channelId, { apps: [...current, ...fresh] });
    broadcastChannelEvent({ type: 'channel', channel }, to);

    for (const projectId of fresh) {
      const name = nameOf.get(projectId) ?? projectId;
      const card = await appendMessage(root, {
        channelId: ask.channelId,
        kind: 'system',
        text: `${name} is ready.`,
        threadId,
        app: { projectId, name },
      });
      broadcastChannelEvent({ type: 'message', message: card }, to);
      broadcastChannelEvent(
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
