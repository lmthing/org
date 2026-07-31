import type { AuthConfig, AuthSession } from '../types'
import { getDesktopBridge } from '../env'
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
 *
 * The desktop shell takes the branch below instead, and it is not an optimisation — on web the page
 * unloading is the mechanism, but a Tauri webview has nowhere to come back FROM. Assigning
 * `location.href` there navigates the single window off the bundle to lmthing.com and the app is
 * simply gone; the user has to force-quit. So desktop hands the URL to the SYSTEM browser and waits
 * for the `lmthing://` deep link, which is the same shape native already uses.
 */
export function startLogin(config: AuthConfig, state: string): Promise<AuthSession | null> {
  sessionStorage.setItem(STATE_KEY, state)

  const desktop = getDesktopBridge()
  const redirectUri =
    desktop?.startSso && desktop.ssoRedirectUri ? desktop.ssoRedirectUri : callbackUrl(config)

  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    app: config.appName,
    state,
  })
  const authUrl = `${config.comUrl}/auth/sso?${params.toString()}`

  if (desktop?.startSso && desktop.ssoRedirectUri) {
    return startDesktopLogin(config, state, authUrl, desktop.startSso, desktop.ssoRedirectUri)
  }

  window.location.href = authUrl
  return new Promise(() => {
    /* the page is unloading; resolving would be a lie */
  })
}

/**
 * The desktop half of {@link startLogin}: open the system browser, await the deep-link callback,
 * then hand off to the SHARED {@link exchangeSsoCode}. Resolves with the session (like native)
 * rather than never resolving (like web), which is why `redirectToLogin` stores the result.
 *
 * This needs no gateway change. `/sso/create` stores `redirect_uri` verbatim and the exchange
 * requires an exact match against it with no allowlist — the same property `sso.native.ts` relies
 * on and documents — so a custom scheme round-trips byte-identically.
 */
async function startDesktopLogin(
  config: AuthConfig,
  state: string,
  authUrl: string,
  startSso: (url: string, redirectUri: string) => Promise<string>,
  redirectUri: string,
): Promise<AuthSession | null> {
  const callback = await startSso(authUrl, redirectUri)

  const url = new URL(callback)
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')

  // The shell resolves only on a matching deep link, but the URL still crosses a process boundary
  // via the OS, so the CSRF check is made here rather than assumed.
  if (returnedState !== state) throw new Error('Invalid state parameter — possible CSRF attack')
  if (!code) throw new Error('SSO callback carried no code')

  const session = await exchangeSsoCode(config, code, redirectUri)
  sessionStorage.removeItem(STATE_KEY)
  return session
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
