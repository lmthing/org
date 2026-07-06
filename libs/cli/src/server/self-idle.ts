/**
 * Self-idle watchdog (pod → gateway) — the PRIMARY scale-to-zero trigger.
 *
 * A free pod that has been idle (no live/running sessions, no in-flight HTTP/WS,
 * no backup) for `idleMs` reports itself idle to the gateway, which scales its
 * Deployment to 0. While active it sends a throttled heartbeat so the gateway's
 * backstop sweep never reclaims a genuinely-busy pod. An optional per-tick hook
 * (used to republish the cron manifest) runs first so the gateway always has the
 * pod's freshest schedule before it might sleep.
 *
 * Entirely inert without gateway env: the caller only starts it when
 * `LMTHING_COMPUTE_JWT` is present (injected by the gateway in prod, absent under
 * `lmthing serve`). Every network call is best-effort and never throws into the
 * event loop.
 */

export interface SelfIdleOpts {
  /** In-cluster gateway base URL (LMTHING_GATEWAY_URL). */
  gatewayUrl: string;
  /** Scoped compute JWT (LMTHING_COMPUTE_JWT). */
  jwt: string;
  /** Idle threshold (ms) before the pod self-reports idle. */
  idleMs: number;
  /** True when a request/session/backup is in flight (never scale down then). */
  isBusy: () => boolean;
  /** Epoch-ms of the most recent activity (last request end or session activity). */
  lastActivityMs: () => number;
  /** Optional per-tick side effect (republish cron manifest). Best-effort. */
  onTick?: () => Promise<void>;
  /** Watchdog cadence (default 60s). */
  intervalMs?: number;
  /** Min spacing between active heartbeats (default 5min). */
  heartbeatMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

/** Report activity to the gateway. `idle:true` → scale to 0; `idle:false` → heartbeat. */
async function report(
  gatewayUrl: string,
  jwt: string,
  idle: boolean,
): Promise<void> {
  try {
    await fetch(`${gatewayUrl}/api/compute/self-idle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ idle }),
    });
  } catch (err) {
    console.warn(
      '[self-idle] report failed:',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Start the watchdog. Returns the interval handle (unref'd — never keeps the
 * process alive on its own). Call once at server start, gated on the compute JWT.
 */
export function startSelfIdleWatchdog(opts: SelfIdleOpts): NodeJS.Timeout {
  const intervalMs = opts.intervalMs ?? 60_000;
  const heartbeatMs = opts.heartbeatMs ?? 5 * 60_000;
  const now = opts.now ?? Date.now;
  let lastHeartbeatSent = 0;
  let reportingIdle = false; // avoid overlapping reports while a scale-down lands

  const maybeHeartbeat = (t: number): void => {
    if (t - lastHeartbeatSent >= heartbeatMs) {
      lastHeartbeatSent = t;
      void report(opts.gatewayUrl, opts.jwt, false);
    }
  };

  const timer = setInterval(() => {
    void (async () => {
      // Keep the gateway's schedule fresh before we might sleep.
      if (opts.onTick) {
        try {
          await opts.onTick();
        } catch {
          /* best-effort */
        }
      }
      const t = now();
      if (opts.isBusy()) {
        maybeHeartbeat(t);
        return;
      }
      const idleFor = t - opts.lastActivityMs();
      if (idleFor >= opts.idleMs) {
        if (reportingIdle) return;
        reportingIdle = true;
        await report(opts.gatewayUrl, opts.jwt, true);
        reportingIdle = false;
      } else {
        // Recently active (still within the idle window) — keep the clock warm.
        maybeHeartbeat(t);
      }
    })();
  }, intervalMs);
  timer.unref?.();
  console.log(`[self-idle] watchdog started (idle threshold ${Math.round(opts.idleMs / 60000)}m)`);
  return timer;
}
