import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocket, WebSocketServer } from 'ws';
import type { HostBridge } from '../../rpc/host-bridge.js';

/**
 * `/api/host/ws` — where the LMThing desktop shell attaches.
 *
 * One socket per pod, held open by the desktop for as long as the app is running. Everything
 * flowing over it is a *reverse* RPC: the pod asks, the desktop answers. See
 * `rpc/host-events.ts` for why the direction is fixed (a cloud pod cannot dial a machine behind
 * NAT) and `rpc/host-bridge.ts` for why exactly one client may be attached.
 *
 * Auth is the `?access_token=` query param that every other socket here uses, validated by Envoy
 * before the request reaches this process — browsers cannot set WebSocket headers, and the desktop
 * follows the same convention rather than inventing a second one.
 */
export function handleHostWsUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  wss: WebSocketServer,
  bridge: HostBridge,
): void {
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    bridge.attach(ws as unknown as Parameters<HostBridge['attach']>[0]);

    ws.on('message', (data: Buffer) => bridge.handleMessage(data.toString()));
    // Both, because a half-open socket is still gone: `close` covers the orderly case and `error`
    // the abrupt one (a laptop lid closing mid-request). Detaching fails every in-flight request
    // straight away rather than leaving an agent blocked until its timeout.
    ws.on('close', () => bridge.detach(ws as unknown as Parameters<HostBridge['detach']>[0]));
    ws.on('error', () => bridge.detach(ws as unknown as Parameters<HostBridge['detach']>[0]));
  });
}
