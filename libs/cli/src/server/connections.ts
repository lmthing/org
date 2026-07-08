import type { ConnectionResolver, ConnectionRequest, ConnectionResponse } from '@lmthing/core';

/**
 * Pod-side resolver for the agent/space `callConnection(provider, req)` global.
 *
 * The pod NEVER holds a provider OAuth token. For each call it forwards the
 * request to the gateway's egress proxy (`POST /api/connections/:provider/proxy`),
 * authenticated only with the scoped connections JWT (`LMTHING_CONNECTIONS_JWT`,
 * `aud:"connections"`) injected into the pod's env on first connect. The gateway
 * attaches the user's token, pins the outbound host to the provider's API base,
 * and returns `{ ok, status, data }`.
 *
 * Returns `undefined` when `LMTHING_CONNECTIONS_JWT` is unset (local dev, or a
 * pod with no connections yet) — the yield router then throws a clear, retryable
 * "no connections gateway configured" error rather than binding undefined.
 *
 * Uses a non-blocking `fetch` with an AbortSignal timeout so a slow provider
 * can't stall the session server's event loop / trip the idle watchdog.
 */

const GATEWAY_URL =
  process.env.LMTHING_GATEWAY_URL || 'http://gateway.lmthing.svc.cluster.local:3000';

const PROXY_TIMEOUT_MS = 25_000;

export function createConnectionResolver(): ConnectionResolver | undefined {
  const jwt = process.env.LMTHING_CONNECTIONS_JWT;
  if (!jwt) return undefined;

  return async (provider: string, req: ConnectionRequest): Promise<ConnectionResponse> => {
    let r: Response;
    try {
      r = await fetch(`${GATEWAY_URL}/api/connections/${encodeURIComponent(provider)}/proxy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          method: req.method,
          path: req.path,
          query: req.query,
          body: req.body,
          headers: req.headers,
        }),
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`callConnection("${provider}"): could not reach connections gateway: ${String((err as Error)?.message ?? err)}`);
    }

    const text = await r.text().catch(() => '');
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    // Gateway-level errors (unknown provider, not connected, expired-and-unrefreshable,
    // refresh/proxy failure) come back non-2xx as `{ error }`. Surface them as a clear,
    // retryable yield error rather than a misleading { ok:false } payload.
    if (!r.ok) {
      const message =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : `gateway returned ${r.status}`;
      throw new Error(`callConnection("${provider}") failed: ${message}`);
    }

    // Success envelope from the proxy: `{ ok, status, data }` (the provider's own
    // status, distinct from the gateway HTTP status which is 200 on a delivered call).
    if (parsed && typeof parsed === 'object' && 'ok' in parsed && 'status' in parsed && 'data' in parsed) {
      return parsed as ConnectionResponse;
    }
    // Defensive fallback: the proxy always returns the envelope, but if it ever
    // doesn't, wrap the body so callers still get a well-typed response.
    return { ok: true, status: r.status, data: parsed };
  };
}
