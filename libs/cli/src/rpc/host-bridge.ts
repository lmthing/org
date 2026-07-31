import { randomUUID } from 'node:crypto';
import type {
  HostClientMessage,
  HostGrants,
  HostRequestInit,
  HostServerEvent,
} from './host-events.js';
import { HOST_PROTOCOL_VERSION } from './host-events.js';

/**
 * Reverse RPC to the attached desktop shell.
 *
 * ## Derived from `WebRenderHost.ask`, with two deliberate differences
 *
 * `rpc/server.ts#WebRenderHost` already does the hard part: the server initiates a request, carries
 * a correlation id, and awaits a client reply on a promise that **suspends the agent's VM turn**.
 * Its docstring says outright that `ask`/`submitForm` were always transport-agnostic. So the shape
 * is borrowed rather than reinvented.
 *
 * Two of its properties are correct for an `ask` and catastrophic for a host call:
 *
 * 1. **`emit()` broadcasts to every connected client.** Any human may answer an ask; only ONE
 *    machine may execute `localWrite`. Broadcasting a filesystem write to every attached desktop
 *    would run it more than once, on more than one computer.
 * 2. **`submitForm` is first-reply-wins.** For an ask that is a race between people, which is fine.
 *    For a host call it means a stale desktop — an old laptop that never disconnected cleanly —
 *    could answer for the one the person is actually using.
 *
 * Hence: exactly one attached client, and a new attach **evicts** the old one explicitly rather
 * than silently joining it. Someone launching the app on a second machine is a normal thing to do;
 * they should be told which one is live, not have their file operations land somewhere unpredictable.
 */

/** A socket, structurally — so this module does not depend on a particular `ws` version. */
export interface HostSocket {
  send(data: string): void;
  close(): void;
  readyState: number;
}

/** `ws`'s OPEN. Named here so the check reads as intent rather than as a magic number. */
const OPEN = 1;

export interface HostBridgeOptions {
  /** Identifies this pod in `hello`, so a desktop can notice it reconnected somewhere else. */
  podId?: string;
  /**
   * Default deadline for a request. Follows `resolveFetchYield`'s 25s precedent: a desktop that
   * vanished mid-turn must not hang the turn forever, and an agent waiting on a machine that has
   * gone to sleep is exactly that.
   */
  timeoutMs?: number;
  log?: (message: string) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class HostBridge {
  private socket: HostSocket | null = null;
  private pending = new Map<string, Pending>();
  private grantList: HostGrants['roots'] = [];
  private cdpListeners = new Set<(method: string, params: unknown) => void>();
  private readonly podId: string;
  private readonly timeoutMs: number;
  private readonly log: (message: string) => void;

  constructor(opts: HostBridgeOptions = {}) {
    this.podId = opts.podId ?? randomUUID();
    this.timeoutMs = opts.timeoutMs ?? 25_000;
    this.log = opts.log ?? (() => {});
  }

  /**
   * Attach a desktop. Any previously attached one is evicted first.
   *
   * The eviction is announced rather than silent: the old shell shows "this workspace is now
   * connected on another computer" instead of appearing to work while its requests go nowhere.
   */
  attach(socket: HostSocket): void {
    if (this.socket && this.socket !== socket) {
      this.send(this.socket, {
        type: 'evicted',
        reason: 'This workspace is now connected from another computer.',
      });
      try {
        this.socket.close();
      } catch {
        /* already gone */
      }
    }
    this.socket = socket;
    // A reconnect invalidates the previous grant list — the person may have changed it while
    // disconnected, and serving a stale one would describe folders that are no longer granted.
    this.grantList = [];
    this.send(socket, { type: 'hello', protocolVersion: HOST_PROTOCOL_VERSION, podId: this.podId });
    this.log('[host-bridge] desktop attached');
  }

  /**
   * Detach, failing every in-flight request immediately.
   *
   * Letting them run to their timeouts would leave an agent blocked for 25 seconds on a machine
   * that is already known to be gone — and, worse, would make a deliberate "disconnect" click feel
   * like it did nothing.
   */
  detach(socket: HostSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.grantList = [];
    const err = new Error('The LMThing desktop disconnected.');
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.log('[host-bridge] desktop detached');
  }

  attached(): boolean {
    return this.socket !== null && this.socket.readyState === OPEN;
  }

  /** The last pushed grant list. For descriptive errors and for `localRoots`. */
  grants(): HostGrants['roots'] {
    return this.grantList;
  }

  onCdpEvent(listener: (method: string, params: unknown) => void): () => void {
    this.cdpListeners.add(listener);
    return () => this.cdpListeners.delete(listener);
  }

  /**
   * Send a request and await the desktop's reply.
   *
   * Rejects immediately when nothing is attached, rather than waiting out the timeout. "No desktop
   * is connected" is a condition the person can act on the moment they read it; making them wait
   * 25 seconds to be told so is strictly worse than telling them now.
   */
  request<T = unknown>(event: HostRequestInit, opts: { timeoutMs?: number } = {}): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) {
      return Promise.reject(
        new Error('No LMThing desktop is connected to this workspace.'),
      );
    }

    const id = event.id ?? randomUUID();
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The desktop did not answer within ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      this.send(socket, { ...event, id } as HostServerEvent);
    });
  }

  /** Route one frame from the desktop. Unknown frames are ignored, never fatal. */
  handleMessage(raw: string): void {
    let msg: HostClientMessage;
    try {
      msg = JSON.parse(raw) as HostClientMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'result': {
        const p = this.pending.get(msg.id);
        // A reply with no pending entry is normal, not an error: it is the answer to a request
        // that already timed out. Dropping it silently is correct — resolving it would hand a
        // stale value to a caller that has already been told the call failed.
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.value);
        else p.reject(new Error(msg.error ?? 'The desktop refused the request.'));
        return;
      }
      case 'grants': {
        this.grantList = msg.roots;
        return;
      }
      case 'cdp.event': {
        for (const l of this.cdpListeners) {
          try {
            l(msg.method, msg.params);
          } catch {
            /* a listener's failure is not the bridge's problem */
          }
        }
        return;
      }
    }
  }

  private send(socket: HostSocket, event: HostServerEvent): void {
    if (socket.readyState !== OPEN) return;
    try {
      socket.send(JSON.stringify(event));
    } catch {
      /* the socket died between the check and the write; the timeout will settle the caller */
    }
  }
}
