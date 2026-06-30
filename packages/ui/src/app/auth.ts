import { getSession } from '@lmthing/auth'

/**
 * Auth token access for the served web UI.
 *
 * The token comes from the @lmthing/auth session (OAuth → localStorage), shared
 * with the rest of the unified app. Callers (ChatShell / Sidebar / shell /
 * ProjectSettings) run only after AuthGate has established an authenticated
 * session, so it is present in production; absent in local/demo (no-auth) mode,
 * where the header/suffix are empty and callers behave as before.
 */
export function getAccessToken(): string | undefined {
  return getSession()?.accessToken
}

/** Authorization header for same-origin `/api/*` fetches, or empty when no token. */
export function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

/** WS query-param suffix carrying the token (e.g. `&access_token=…`), or empty. */
export function wsTokenSuffix(): string {
  const token = getAccessToken()
  return token ? `&access_token=${encodeURIComponent(token)}` : ''
}
