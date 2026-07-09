import type { ConnectionResolver, ConnectionRequest, ConnectionResponse } from '@lmthing/core';

/**
 * Pod-side resolver for the agent/space `callConnection(provider, req)` global.
 *
 * The gateway is the sole custodian of the long-lived OAuth REFRESH token. This
 * resolver asks the gateway (`POST /api/connections/:provider/token`, authed with
 * the scoped `LMTHING_CONNECTIONS_JWT`) for a short-lived ACCESS token + the
 * provider `apiBase`, caches it until just before expiry, and makes the REST call
 * DIRECTLY to the provider — the raw request never round-trips through the
 * gateway. On a `401` (token revoked/expired early) it forces a fresh token from
 * the gateway (which refreshes via the stored refresh token) and retries once.
 *
 * Returns `undefined` when `LMTHING_CONNECTIONS_JWT` is unset (local dev, or a
 * pod with no connections yet) — the yield router then throws a clear, retryable
 * "no connections gateway configured" error rather than binding undefined.
 *
 * Uses non-blocking `fetch` with AbortSignal timeouts so a slow provider/gateway
 * can't stall the session server's event loop / trip the idle watchdog.
 */

const DEFAULT_GATEWAY_URL = 'http://gateway.lmthing.svc.cluster.local:3000';

const CALL_TIMEOUT_MS = 25_000;
/** Refresh a cached access token this many ms before its nominal expiry. */
const EXPIRY_SKEW_MS = 60_000;

interface CachedToken {
  accessToken: string;
  apiBase: string;
  /** Epoch-ms expiry, or null when the token doesn't expire. */
  expiresAt: number | null;
}

export function createConnectionResolver(): ConnectionResolver | undefined {
  const jwt = process.env.LMTHING_CONNECTIONS_JWT;
  if (!jwt) return undefined;
  const gatewayUrl = process.env.LMTHING_GATEWAY_URL || DEFAULT_GATEWAY_URL;

  // Per-provider access-token cache + in-flight de-dupe (so concurrent calls
  // don't each hit the gateway / double-spend a one-time refresh token).
  const cache = new Map<string, CachedToken>();
  const inflight = new Map<string, Promise<CachedToken>>();

  async function mintToken(provider: string, force: boolean): Promise<CachedToken> {
    const res = await fetch(`${gatewayUrl}/api/connections/${encodeURIComponent(provider)}/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh: force }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => '');
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const message =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : `gateway returned ${res.status}`;
      throw new Error(`callConnection("${provider}"): ${message}`);
    }
    const p = parsed as { accessToken?: unknown; apiBase?: unknown; expiresAt?: unknown };
    if (typeof p.accessToken !== 'string' || typeof p.apiBase !== 'string') {
      throw new Error(`callConnection("${provider}"): gateway token response missing accessToken/apiBase`);
    }
    const tok: CachedToken = {
      accessToken: p.accessToken,
      apiBase: p.apiBase,
      expiresAt: typeof p.expiresAt === 'number' ? p.expiresAt : null,
    };
    cache.set(provider, tok);
    return tok;
  }

  async function getToken(provider: string, force: boolean): Promise<CachedToken> {
    if (force) {
      cache.delete(provider);
    } else {
      const cached = cache.get(provider);
      if (cached && (cached.expiresAt === null || cached.expiresAt - EXPIRY_SKEW_MS > Date.now())) {
        return cached;
      }
    }
    const key = `${provider}:${force}`;
    let p = inflight.get(key);
    if (!p) {
      p = mintToken(provider, force).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  }

  async function callProvider(tok: CachedToken, req: ConnectionRequest): Promise<Response> {
    const path = req.path ?? '';
    // Host-pinning: `path` is sandbox-supplied, so it MUST be relative to the
    // provider apiBase — reject absolute URLs / scheme / protocol-relative so an
    // agent can't redirect the bearer token to an attacker-controlled host.
    if (/^https?:\/\//i.test(path) || path.includes('://') || path.startsWith('//')) {
      throw new Error('callConnection: path must be relative to the provider apiBase');
    }
    const base = tok.apiBase.replace(/\/+$/, '');
    const rel = path.startsWith('/') ? path : `/${path}`;
    let url = `${base}${rel}`;
    if (req.query && Object.keys(req.query).length > 0) {
      url += (url.includes('?') ? '&' : '?') + new URLSearchParams(req.query).toString();
    }

    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'lmthing-pod' };
    if (req.headers) {
      for (const [k, v] of Object.entries(req.headers)) {
        const lk = k.toLowerCase();
        if (lk === 'authorization' || lk === 'host') continue;
        headers[k] = v;
      }
    }
    headers['Authorization'] = `Bearer ${tok.accessToken}`;

    const method = (req.method || 'GET').toUpperCase();
    let body: string | undefined;
    if (req.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    }

    return fetch(url, { method, headers, body, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  }

  return async (provider: string, req: ConnectionRequest): Promise<ConnectionResponse> => {
    let tok = await getToken(provider, false);
    let res: Response;
    try {
      res = await callProvider(tok, req);
      // A 401 means the access token was rejected (revoked / expired early). Ask
      // the gateway to refresh (via the refresh token it holds) and retry once.
      if (res.status === 401) {
        tok = await getToken(provider, true);
        res = await callProvider(tok, req);
      }
    } catch (err) {
      throw new Error(`callConnection("${provider}"): request failed: ${String((err as Error)?.message ?? err)}`);
    }

    const text = await res.text().catch(() => '');
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data };
  };
}
