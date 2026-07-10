import type { ConnectionResolver, ConnectionRequest, ConnectionResponse } from '@lmthing/core';

/**
 * Pod-side resolver for the agent/space `callConnection(provider, req)` global.
 *
 * BRING-YOUR-OWN-TOKEN model: the user configures their OWN provider token in
 * the pod env (Settings → Integrations) — lmthing does NOT broker OAuth or store
 * refresh tokens. This resolver looks the token up in `process.env` by the
 * provider's `tokenEnv`, host-pins the request to the provider `apiBase`, and
 * makes the REST call DIRECTLY. No gateway round-trip.
 *
 * Errors are thrown (never silently binding undefined) so the yield router
 * surfaces them to the agent: an unknown provider, or a provider whose token env
 * var is unset ("not configured — set <TOKEN_ENV> in Settings → Integrations").
 *
 * Uses non-blocking `fetch` with an AbortSignal timeout so a slow provider can't
 * stall the session server's event loop / trip the idle watchdog.
 */

const CALL_TIMEOUT_MS = 25_000;

/** One BYO provider: where its REST API lives (`apiBase`, used to host-pin the
 *  sandbox-supplied path) and which env var holds the user's own token. */
interface ProviderConfig {
  apiBase: string;
  tokenEnv: string;
}

/**
 * The providers `callConnection` supports and where each reads its token from.
 * `apiBase` mirrors the old gateway connections-registry so existing
 * `integration-*` spaces (which build relative paths like `/chat.postMessage`)
 * keep working unchanged.
 */
const PROVIDERS: Record<string, ProviderConfig> = {
  slack: { apiBase: 'https://slack.com/api', tokenEnv: 'SLACK_BOT_TOKEN' },
  github: { apiBase: 'https://api.github.com', tokenEnv: 'GITHUB_TOKEN' },
  google: { apiBase: 'https://www.googleapis.com', tokenEnv: 'GOOGLE_ACCESS_TOKEN' },
};

/** Exposed for tests / the Integrations UI contract. */
export const SUPPORTED_CONNECTION_PROVIDERS = Object.keys(PROVIDERS);

async function callProvider(apiBase: string, token: string, req: ConnectionRequest): Promise<Response> {
  const path = req.path ?? '';
  // Host-pinning: `path` is sandbox-supplied, so it MUST be relative to the
  // provider apiBase — reject absolute URLs / scheme / protocol-relative so an
  // agent can't redirect the bearer token to an attacker-controlled host.
  if (/^https?:\/\//i.test(path) || path.includes('://') || path.startsWith('//')) {
    throw new Error('callConnection: path must be relative to the provider apiBase');
  }
  const base = apiBase.replace(/\/+$/, '');
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
  headers['Authorization'] = `Bearer ${token}`;

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

export function createConnectionResolver(): ConnectionResolver | undefined {
  return async (provider: string, req: ConnectionRequest): Promise<ConnectionResponse> => {
    const cfg = PROVIDERS[provider];
    if (!cfg) {
      throw new Error(
        `callConnection("${provider}"): unknown provider (supported: ${SUPPORTED_CONNECTION_PROVIDERS.join(', ')})`,
      );
    }
    const token = process.env[cfg.tokenEnv];
    if (!token) {
      throw new Error(
        `callConnection("${provider}"): not configured — set ${cfg.tokenEnv} in Settings → Integrations`,
      );
    }

    let res: Response;
    try {
      res = await callProvider(cfg.apiBase, token, req);
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
