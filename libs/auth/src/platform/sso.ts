import type { AuthConfig, AuthSession } from '../types'
import { exchangeSsoCode } from '../sso-exchange'

/**
 * Interactive SSO login — WEB implementation (a full-page redirect).
 *
 * Behaviour is the previous `redirectToLogin` / `handleAuthCallback` verbatim, moved behind the seam
 * so the native fork can differ in the only place the targets genuinely diverge: **how the user is
 * sent to the identity provider and how the code comes back.** Everything after the code arrives is
 * `exchangeSsoCode`, shared.
 *
 * The shape is asymmetric because the platforms are. Web leaves the page: {@link startLogin} does
 * not resolve, the browser navigates, and the app is re-entered at `config.callbackPath`, where
 * {@link completeRedirect} finishes the job. Native never leaves the app, so its `startLogin`
 * resolves with the session and its `completeRedirect` has nothing to do.
 */
const STATE_KEY = 'sso_state'

/** The callback URL this app is reachable at — also the exact string the gateway will match. */
function callbackUrl(config: AuthConfig): string {
  return `${window.location.origin}${config.callbackPath}`
}

/**
 * Send the user to the SSO page. Does not resolve on web: the browser navigates away and the app is
 * re-entered through {@link completeRedirect}.
 */
export function startLogin(config: AuthConfig, state: string): Promise<AuthSession | null> {
  sessionStorage.setItem(STATE_KEY, state)

  const params = new URLSearchParams({
    redirect_uri: callbackUrl(config),
    app: config.appName,
    state,
  })

  window.location.href = `${config.comUrl}/auth/sso?${params.toString()}`
  return new Promise(() => {
    /* the page is unloading; resolving would be a lie */
  })
}

/** Finish a login that the redirect handed back in the URL. Null when there is no code to consume. */
export async function completeRedirect(config: AuthConfig): Promise<AuthSession | null> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (!code) return null

  // Verify state to prevent CSRF. Don't remove it from sessionStorage until the exchange succeeds,
  // because React StrictMode double-invokes effects in dev.
  const savedState = sessionStorage.getItem(STATE_KEY)
  if (state !== savedState) {
    // Missing entirely is most likely a StrictMode re-run after a successful exchange already
    // cleared it — the caller treats null as "nothing to do" and keeps the session it has.
    if (!savedState) return null
    throw new Error('Invalid state parameter — possible CSRF attack')
  }

  const session = await exchangeSsoCode(config, code, callbackUrl(config))
  sessionStorage.removeItem(STATE_KEY)
  return session
}
