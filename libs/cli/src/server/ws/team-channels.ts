/**
 * Channel fan-out socket for a team pod.
 *
 * One hub per pod. A named channel's events go to every connected member and the
 * client filters by the channel it is showing — a team is small and the frames
 * are tiny, so per-channel subscriptions would be bookkeeping without a payoff,
 * and a member switching channels then sees no gap.
 *
 * A **direct message is different**: fanning its events to everyone would leak a
 * private conversation to every open tab in the team, and "the client filters"
 * is not a boundary. So each socket records the identity it was opened with, and
 * an event may carry an `audience` — the only user ids allowed to receive it.
 * The audience is decided by the caller from the channel record, not inferred
 * here.
 *
 * Authorization to open the socket at all is `guardWebSocket` in serve.ts, the
 * same Envoy-verified identity every other request uses.
 */

import type { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Channel, ChannelMessage } from '../team-channels.js';
import type { Category } from '../team-channels.js';
import { readCaller } from '../team-guard.js';

/** Server → client frames. */
export type ChannelEvent =
  | { type: 'message'; message: ChannelMessage }
  | { type: 'thing_status'; channelId: string; threadId: string; status: 'running' | 'done' | 'error' }
  | { type: 'typing'; channelId: string; userId: string; email?: string }
  /** A channel was created, renamed, re-filed, or had its apps changed. */
  | { type: 'channel'; channel: Channel }
  | { type: 'categories'; categories: Category[] }
  /**
   * THING finished a turn that produced an app, and it has been pinned to the
   * channel the ask was made in — the signal a client uses to open it beside the
   * conversation instead of leaving it to be discovered.
   *
   * `requestedBy` is who asked for it. A client opens its rail automatically ONLY
   * for that member: everyone else gets the new tab in the channel header and the
   * card in the thread, which is an offer. Throwing a pane open over the work of
   * somebody who did not ask for it is not a notification, it is an interruption.
   */
  | {
      type: 'app_created';
      channelId: string;
      threadId: string;
      projectId: string;
      name: string;
      requestedBy?: string;
    };

/** Client → server frames. The only thing a client may push is that it is typing. */
type ClientFrame = { type: 'typing'; channelId: string };

interface Subscriber {
  ws: WebSocket;
  userId: string;
  email?: string;
}

const sockets = new Set<Subscriber>();

/**
 * Attach a member's socket to the hub.
 *
 * `identity` comes from the verified upgrade request. A socket with no identity
 * (a personal pod, where team mode is off) is still attached — it just cannot be
 * excluded from an audience, which is correct there: a personal pod has exactly
 * one user and no DMs.
 */
export function registerChannelSocket(
  ws: WebSocket,
  identity?: { userId: string; email?: string },
): void {
  const subscriber: Subscriber = {
    ws,
    userId: identity?.userId ?? '',
    ...(identity?.email ? { email: identity.email } : {}),
  };
  sockets.add(subscriber);
  ws.on('close', () => sockets.delete(subscriber));
  ws.on('error', () => sockets.delete(subscriber));

  // Typing is the one thing a client pushes. It is deliberately socket-only and
  // never persisted: it is stale within seconds, nobody can page back through
  // it, and routing it over HTTP would mean a request per keystroke-burst.
  //
  // The frame carries no identity — the SERVER stamps the one the upgrade was
  // verified with. A client-supplied userId here would let any member forge a
  // "so-and-so is typing" for anyone else.
  ws.on('message', (data: unknown) => {
    if (!subscriber.userId) return;
    let frame: ClientFrame;
    try {
      frame = JSON.parse(String(data)) as ClientFrame;
    } catch {
      return;
    }
    if (frame?.type !== 'typing' || typeof frame.channelId !== 'string') return;
    broadcastChannelEvent(
      {
        type: 'typing',
        channelId: frame.channelId,
        userId: subscriber.userId,
        ...(subscriber.email ? { email: subscriber.email } : {}),
      },
      // Everyone but the typist — a composer that told you about yourself would
      // be a bug, and filtering it here saves every client from doing so.
      { exclude: subscriber.userId },
    );
  });
}

export interface BroadcastOptions {
  /** When set, only these user ids receive the event (a DM's participants). */
  audience?: readonly string[];
  /** A user id that never receives this event (the member who caused it). */
  exclude?: string;
}

/** Broadcast to the connected members an event is for. Best-effort: a dead socket is dropped. */
export function broadcastChannelEvent(
  event: ChannelEvent,
  options: BroadcastOptions = {},
): void {
  const payload = JSON.stringify(event);
  const audience = options.audience ? new Set(options.audience) : null;
  for (const subscriber of sockets) {
    if (audience && !audience.has(subscriber.userId)) continue;
    if (options.exclude && subscriber.userId === options.exclude) continue;
    try {
      // 1 === WebSocket.OPEN, without importing the value at runtime.
      if (subscriber.ws.readyState === 1) subscriber.ws.send(payload);
    } catch {
      sockets.delete(subscriber);
    }
  }
}

/**
 * The audience for events about `channel` — every member for a named channel,
 * only the participants for a DM. Pass the result straight to
 * {@link broadcastChannelEvent}.
 */
export function audienceFor(channel: Channel | undefined): BroadcastOptions {
  return channel?.kind === 'dm' && channel.members ? { audience: channel.members } : {};
}

/** How many members are currently connected (used by tests and diagnostics). */
export function connectedChannelSockets(): number {
  return sockets.size;
}

/**
 * The user ids with a live socket right now.
 *
 * Used as the "do not push" set: somebody with the surface open is being told by
 * the socket already, and a phone that buzzes about a message visible on the
 * screen in front of you is the fastest way to get notifications turned off.
 *
 * An open socket is a weaker signal than an open EYE — a backgrounded tab still
 * holds one — which is why the client also marks a channel read when it is
 * actually on screen. This set only rules out the case where the message is
 * being delivered live anyway.
 */
export function connectedUserIds(): Set<string> {
  const ids = new Set<string>();
  for (const subscriber of sockets) if (subscriber.userId) ids.add(subscriber.userId);
  return ids;
}

/** Drop every socket — test teardown. */
export function resetChannelSockets(): void {
  sockets.clear();
}

export function handleChannelWsUpgrade(
  req: IncomingMessage,
  socket: import('node:stream').Duplex,
  head: Buffer,
  wss: WebSocketServer,
): void {
  const caller = readCaller(req);
  wss.handleUpgrade(req, socket, head, (ws) => {
    registerChannelSocket(
      ws,
      caller ? { userId: caller.userId, ...(caller.email ? { email: caller.email } : {}) } : undefined,
    );
  });
}
