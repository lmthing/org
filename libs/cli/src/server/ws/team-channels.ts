/**
 * Channel fan-out socket for a team pod.
 *
 * One hub per pod: every connected member receives every channel event, and the
 * client filters by the channel it is showing. A team is small and the frames
 * are tiny, so per-channel subscriptions would be bookkeeping without a payoff —
 * and a member switching channels then sees no gap.
 *
 * This carries no authorization of its own: the upgrade is gated by
 * `guardWebSocket` in serve.ts, which is the same Envoy-verified identity every
 * other request uses.
 */

import type { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { ChannelMessage } from '../team-channels.js';

/** Server → client frames. */
export type ChannelEvent =
  | { type: 'message'; message: ChannelMessage }
  | { type: 'thing_status'; channelId: string; threadId: string; status: 'running' | 'done' | 'error' }
  | { type: 'typing'; channelId: string; userId: string; email?: string };

const sockets = new Set<WebSocket>();

/** Attach a member's socket to the hub. */
export function registerChannelSocket(ws: WebSocket): void {
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
  ws.on('error', () => sockets.delete(ws));
  // The client sends nothing but keepalives today; messages are posted over
  // HTTP so they get the same role gating as everything else.
  ws.on('message', () => {});
}

/** Broadcast to every connected member. Best-effort: a dead socket is dropped. */
export function broadcastChannelEvent(event: ChannelEvent): void {
  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    try {
      // 1 === WebSocket.OPEN, without importing the value at runtime.
      if (ws.readyState === 1) ws.send(payload);
    } catch {
      sockets.delete(ws);
    }
  }
}

/** How many members are currently connected (used by tests and diagnostics). */
export function connectedChannelSockets(): number {
  return sockets.size;
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
  wss.handleUpgrade(req, socket, head, (ws) => {
    registerChannelSocket(ws);
  });
}
