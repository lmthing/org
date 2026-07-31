import type { YieldRequest } from '../eval/yield.js';

/**
 * Raw Chrome DevTools Protocol against the browser the desktop app is showing.
 *
 * ## Why this exists alongside the 27 `system-browser` functions
 *
 * Those 27 are a curated catalog — `goto`, `click`, `fill`, `extract` — and they cover ordinary
 * browsing. This is the escape hatch for everything they do not name: intercepting a request,
 * reading the console of a page that has already loaded, driving an emulation mode, stepping the
 * debugger. An agent asked to *debug a web page* needs the protocol, not a subset of it.
 *
 * ## Why it is the most dangerous thing in the product
 *
 * `Runtime.evaluate` on an arbitrary target is script execution inside a browser that is signed
 * into the person's accounts — which is total account takeover, not "reading a page". `Network.*`
 * exposes every request body, including bearer tokens. `Page.navigate` plus `Runtime.evaluate` is
 * an exfiltration primitive on its own.
 *
 * Three things follow, and all three are enforced elsewhere rather than requested here:
 *
 * 1. **A capability that is not granted by default** — `browser:cdp`, absent from every shipped
 *    agent except the desktop-only one, and dropped entirely on a team pod.
 * 2. **Host-enforced consent**, because a capability is a build-time decision and this needs a
 *    person in the loop at runtime. `hostCdp` is in `CONSENT_MARKED_YIELD_KINDS`, so the router
 *    intercepts it BEFORE the resolver and **fails closed** where there is no prompter — which is
 *    every headless, fork, delegate and hook context.
 * 3. **Not kept for read-only fork roles.** Unlike `fs:local:read`, there is no read-only subset of
 *    a protocol whose first verb is "run this code".
 */

export interface CdpResult {
  ok: boolean;
  /** The CDP command's own result object, when it succeeded. */
  result?: unknown;
  error?: string;
}

export interface HostCdpGlobals {
  /**
   * Send one CDP command. `method` is a protocol method such as `Page.navigate` or
   * `Runtime.evaluate`; `params` is that method's parameter object.
   */
  cdp(method: string, params?: Record<string, unknown>): Promise<CdpResult>;
  /**
   * Subscribe to a CDP event domain (`Network`, `Console`, `Page`, …) so subsequent `cdpEvents`
   * calls return what has arrived. Separate from `cdp` because CDP events are unsolicited and the
   * yield protocol is request/response.
   */
  cdpSubscribe(domain: string): Promise<CdpResult>;
  /** Drain the events collected since the last call. */
  cdpEvents(): Promise<{ ok: boolean; events: Array<{ method: string; params?: unknown }>; error?: string }>;
}

export function createHostCdpGlobals(pushYield: (req: YieldRequest) => void): HostCdpGlobals {
  const call = <T>(op: string, args: unknown[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      pushYield({
        kind: 'hostCdp',
        args: [op, ...args],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });

  return {
    cdp: (method, params) => call<CdpResult>('command', [method, params]),
    cdpSubscribe: (domain) => call<CdpResult>('subscribe', [domain]),
    cdpEvents: () => call<{ ok: boolean; events: Array<{ method: string; params?: unknown }>; error?: string }>('events', []),
  };
}
