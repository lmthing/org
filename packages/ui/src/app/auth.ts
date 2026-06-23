/**
 * Auth token access for the served web UI.
 *
 * The pod's bootstrap HTML may inject the gateway JWT on
 * `window.__LM_ACCESS_TOKEN__` (when served behind Envoy, e.g. lmthing.chat).
 * In local/demo (no-auth) mode it is absent and callers behave as before.
 */
export function getAccessToken(): string | undefined {
  return (window as unknown as { __LM_ACCESS_TOKEN__?: string }).__LM_ACCESS_TOKEN__;
}

/** Authorization header for same-origin `/api/*` fetches, or empty when no token. */
export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** WS query-param suffix carrying the token (e.g. `&access_token=…`), or empty. */
export function wsTokenSuffix(): string {
  const token = getAccessToken();
  return token ? `&access_token=${encodeURIComponent(token)}` : '';
}
