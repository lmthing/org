/**
 * The wire between a pod and the LMThing **desktop shell**.
 *
 * ## Why the desktop dials the pod, and not the other way round
 *
 * A cloud pod cannot reach a desktop. The machine is behind NAT, has no stable address, and is
 * asleep half the time; there is no hole-punching infrastructure here and building some would be a
 * far larger project than the feature. So the direction is fixed: **the desktop opens a WebSocket to
 * the pod and holds it**, and every host operation is a *reverse* RPC over that already-open socket.
 *
 * That direction is free rather than merely acceptable. It is exactly how the browser chat client
 * already reaches the pod, so it reuses the same TLS, the same Envoy JWT-`sub` routing (the host
 * selects the route, the token selects the pod) and the same `?access_token=` query-param
 * convention that exists because browsers cannot set WebSocket headers. No new network primitive,
 * no new auth story, no relay to operate.
 *
 * The cost is **latency**: every host operation pays a WAN round trip. That is why the filesystem
 * surface is batch-shaped (`localTree` returns a subtree, `localSearch` returns many hits) rather
 * than POSIX-shaped — a naive per-file loop over 500 files would be 500 round trips.
 *
 * ## Why this is not in `./events.ts`
 *
 * `ServerEvent`/`ClientMessage` there are the *browser chat client's* type surface, switched on by
 * `server/ws/agent.ts`. Adding host-filesystem and CDP frames to those unions would put them in
 * every chat client's inference and invite an accidental cross-wire between two protocols that
 * share nothing but a transport. This mirrors their conventions — bare JSON, discriminated on
 * `type`, a `hello` carrying `protocolVersion` — without sharing the union.
 */

/** Bumped when a frame changes meaning or is removed. A mismatch is refused at connect. */
export const HOST_PROTOCOL_VERSION = 1;

/** What the pod can ask a desktop to do on its behalf. */
export type HostFsOp =
  | 'roots'
  | 'tree'
  | 'stat'
  | 'read'
  | 'write'
  | 'search';

/**
 * A filesystem request.
 *
 * **There is no absolute-path form, and that is the security design rather than an ergonomic
 * choice.** Every request names a `rootId` — an opaque handle for a folder the person granted —
 * plus a path relative to it. A path outside every grant is therefore not *rejected*, it is
 * *inexpressible*: the pod cannot even describe one. See `apps/desktop/src-tauri/src/grants.rs`.
 */
export interface HostFsRequest {
  type: 'fs.request';
  id: string;
  op: HostFsOp;
  /** Absent only for `roots`, which is the call that discovers them. */
  rootId?: string;
  /** Relative to the grant. Never absolute, never containing `..`. */
  path?: string;
  /** `read`: byte window, so a huge file cannot be pulled across the WAN in one frame. */
  offset?: number;
  limit?: number;
  /** `write`: the new contents. */
  content?: string;
  /** `search`: the query. */
  query?: string;
}

/** A JSON-RPC `tools/call` body, forwarded to the desktop's browser verbatim. */
export interface HostBrowserRequest {
  type: 'browser.request';
  id: string;
  /** The MCP body, untouched — see `libs/cli/src/host/browser-endpoint.ts`. */
  body: unknown;
}

/** A raw Chrome DevTools Protocol command. The sharpest capability in the system. */
export interface HostCdpRequest {
  type: 'cdp.request';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export type HostServerEvent =
  | { type: 'hello'; protocolVersion: number; podId: string }
  | { type: 'evicted'; reason: string }
  | { type: 'error'; message: string }
  | HostFsRequest
  | HostBrowserRequest
  | HostCdpRequest;

/** The frames that expect a `result` back, as opposed to the one-way notices above. */
export type HostRequestEvent = HostFsRequest | HostBrowserRequest | HostCdpRequest;

/**
 * A request with its correlation id left to the bridge to mint.
 *
 * Written as a distributive conditional rather than `Omit<HostRequestEvent, 'id'>`, which would
 * collapse the union into the intersection of its members and reject `op` outright — the members
 * do not share a field set, and that is the point.
 */
export type HostRequestInit<T = HostRequestEvent> = T extends { id: string }
  ? Omit<T, 'id'> & { id?: string }
  : never;

/**
 * The desktop's reply to any request, correlated by `id`.
 *
 * `ok: false` carries a human-readable `error`. A refusal by the grant jail is a normal, expected
 * result — it is what the agent is told when it asks for something outside the person's grants —
 * and must never look like a transport failure.
 */
export interface HostResult {
  type: 'result';
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * The grant list, pushed at connect and on every change.
 *
 * **Never carries the absolute path.** An agent that never learns `/home/someone/...` cannot leak
 * the directory layout either, and it has no use for it: every request is `rootId` + relative path.
 */
export interface HostGrants {
  type: 'grants';
  roots: Array<{ id: string; label: string; mode: 'ro' | 'rw' }>;
}

/** A CDP event the pod subscribed to. Unlike everything else here, unsolicited. */
export interface HostCdpEvent {
  type: 'cdp.event';
  method: string;
  params?: unknown;
}

export type HostClientMessage = HostResult | HostGrants | HostCdpEvent;
