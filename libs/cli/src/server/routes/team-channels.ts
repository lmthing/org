/**
 * Team channel REST routes. Registered only on a team pod (serve.ts gates on
 * `isTeamMode()`), so a personal pod's API surface is unchanged.
 *
 * Posting a message is the interesting one: if it addresses THING, the reply is
 * produced by the SAME threaded-session machinery the inbound-webhook
 * dispatcher uses, keyed by (channel, thread). The HTTP call returns as soon as
 * the member's own message is stored — THING's answer arrives over the channel
 * socket whenever it is ready, so a slow agent turn never blocks the composer.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteHandler } from '../router.js';
import type { SessionManager } from '../session-manager.js';
import { readBody, sendJson } from './utils.js';
import { readCaller } from '../team-guard.js';
import { getOrCreateThreadSession } from '../webhook-threads.js';
import { broadcastChannelEvent } from '../ws/team-channels.js';
import {
  appendMessage,
  createChannel,
  ensureDefaultChannel,
  isValidChannelId,
  mentionsThing,
  promptFor,
  readMessages,
  teamDir,
  threadRootOf,
  type ChannelMessage,
} from '../team-channels.js';

/** The agent a channel mention reaches, matching the chat surface's default. */
const THING_AGENT = 'thing';

/**
 * THING replies that have been kicked off but not yet posted. A mention is
 * answered out-of-band so the composer never waits on an agent turn, which
 * leaves work in flight that nothing is awaiting — this is the handle onto it,
 * for a shutdown that would rather not drop a half-finished answer, and for
 * tests that need to know when the reply has landed.
 */
const inFlightReplies = new Set<Promise<void>>();

function trackReply(p: Promise<void>): void {
  inFlightReplies.add(p);
  void p.finally(() => inFlightReplies.delete(p));
}

/** Resolve once every in-flight THING reply has been posted (or failed). */
export async function settleThingReplies(): Promise<void> {
  while (inFlightReplies.size > 0) {
    await Promise.allSettled([...inFlightReplies]);
  }
}

function requireRoot(root: string | undefined, res: ServerResponse): root is string {
  if (!root) {
    sendJson(res, 500, { error: 'team channels need a project runtime root' });
    return false;
  }
  return true;
}

export function handleListChannels(root: string | undefined): RouteHandler {
  return async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireRoot(root, res)) return;
    const channels = await ensureDefaultChannel(root);
    sendJson(res, 200, { channels });
  };
}

export function handleCreateChannel(root: string | undefined): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireRoot(root, res)) return;
    let parsed: { name?: unknown };
    try {
      parsed = JSON.parse((await readBody(req)) || '{}') as { name?: unknown };
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!name) {
      sendJson(res, 400, { error: 'name is required' });
      return;
    }
    const caller = readCaller(req);
    try {
      const { channel, created } = await createChannel(root, name, caller?.userId ?? 'unknown');
      sendJson(res, created ? 201 : 200, { channel, created });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

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

    let parsed: { text?: unknown; threadId?: unknown };
    try {
      parsed = JSON.parse((await readBody(req)) || '{}') as {
        text?: unknown;
        threadId?: unknown;
      };
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    if (!text) {
      sendJson(res, 400, { error: 'text is required' });
      return;
    }

    const caller = readCaller(req);
    const message = await appendMessage(root, {
      channelId,
      kind: 'user',
      text,
      ...(caller ? { userId: caller.userId, email: caller.email } : {}),
      ...(typeof parsed.threadId === 'string' && parsed.threadId
        ? { threadId: parsed.threadId }
        : {}),
    });
    broadcastChannelEvent({ type: 'message', message });

    // Answer now; THING (if addressed) replies onto the socket in its own time.
    sendJson(res, 201, { message });

    if (mentionsThing(text)) {
      trackReply(runThingReply(manager, root, message));
    }
  };
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
): Promise<void> {
  const threadId = threadRootOf(message);
  broadcastChannelEvent({
    type: 'thing_status',
    channelId: message.channelId,
    threadId,
    status: 'running',
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
    });

    const text = result.ok
      ? renderResult(result.result)
      : `THING could not answer: ${result.error ?? 'unknown error'}`;

    const reply = await appendMessage(root, {
      channelId: message.channelId,
      kind: result.ok ? 'thing' : 'system',
      text,
      threadId,
      sessionId,
    });
    broadcastChannelEvent({ type: 'message', message: reply });
    broadcastChannelEvent({
      type: 'thing_status',
      channelId: message.channelId,
      threadId,
      status: result.ok ? 'done' : 'error',
    });
  } catch (err) {
    const reply = await appendMessage(root, {
      channelId: message.channelId,
      kind: 'system',
      text: `THING could not answer: ${err instanceof Error ? err.message : String(err)}`,
      threadId,
    });
    broadcastChannelEvent({ type: 'message', message: reply });
    broadcastChannelEvent({
      type: 'thing_status',
      channelId: message.channelId,
      threadId,
      status: 'error',
    });
  }
}

/** Flatten whatever the agent returned into channel text. */
function renderResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result === undefined || result === null) return '(no answer)';
  if (typeof result === 'object') {
    const descriptor = result as { text?: unknown; content?: unknown };
    if (typeof descriptor.text === 'string') return descriptor.text;
    if (typeof descriptor.content === 'string') return descriptor.content;
  }
  return JSON.stringify(result);
}
