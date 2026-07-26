import { getSession } from '@lmthing/auth'
import { apiUrl } from '../../platform/api-base'

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

/**
 * Append the auth token as an `access_token` query param to a same-origin
 * `/api/*` URL used by an element that can't send an Authorization header —
 * `<img src>` / `<audio src>` / `<a href>` for a stored upload. In production
 * Envoy's `chat-jwt` SecurityPolicy validates `/api/*` from the header OR this
 * query param (there is no cookie source) and uses the `sub` claim to route to
 * the user's pod, so an unauthenticated `<img>` GET is 401'd before routing.
 * No-op (returns the url unchanged) in local/demo mode where no token exists.
 *
 * The url is resolved through {@link apiUrl} first — identity on web, absolute on native, where an
 * `<Image source>` has no origin to be relative to any more than a `fetch` does.
 */
export function withAuthToken(url: string): string {
  const resolved = apiUrl(url)
  const token = getAccessToken()
  if (!token) return resolved
  const sep = resolved.includes('?') ? '&' : '?'
  return `${resolved}${sep}access_token=${encodeURIComponent(token)}`
}
