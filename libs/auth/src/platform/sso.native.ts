import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import type { AuthConfig, AuthSession } from '../types'
import { exchangeSsoCode } from '../sso-exchange'

/**
 * Interactive SSO login — NATIVE implementation (an in-app browser session).
 *
 * The app never navigates away, so the flow is one function: open the same `${comUrl}/auth/sso` page
 * the web app opens, wait for it to redirect to this app's scheme, take the code out of that URL and
 * exchange it. {@link completeRedirect} therefore has nothing to do here — see the web sibling for
 * why the pair is shaped this way.
 *
 * Nothing on the server had to change for this, and that was verified rather than assumed:
 * `/sso/create` stores `redirect_uri` verbatim and `findAndConsumeSsoCode` requires an exact match
 * with no allowlist, and `com/`'s SSO page does `new URL(redirect_uri)` + `searchParams.set('code')`,
 * which round-trips a custom scheme byte-identically. The same string goes out to `/auth/sso` and
 * back to `/sso/exchange`, so the match holds.
 *
 * `Linking.createURL` rather than a hardcoded `lmthing://auth/callback`: under Expo Go the app is
 * reachable at `exp://<host>:8081/--/auth/callback` instead, and since the gateway matches whatever
 * string it was given, a dev build works without a special case.
 */

/** `openAuthSessionAsync` resolves with the redirect URL only on a real completion. */
const SUCCESS = 'success'

export async function startLogin(config: AuthConfig, state: string): Promise<AuthSession | null> {
  const redirectUri = Linking.createURL('auth/callback')

  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    app: config.appName,
    state,
  })

  const result = await WebBrowser.openAuthSessionAsync(
    `${config.comUrl}/auth/sso?${params.toString()}`,
    redirectUri,
  )

  // The user dismissed the sheet, or the OS cancelled it. Not an error — the caller shows the
  // logged-out state it already had.
  if (result.type !== SUCCESS) return null

  // `Linking.parse`, not `new URL`: React Native's URL implementation is partial, and a custom
  // scheme is exactly where it has historically differed from the browser. This is the parser Expo
  // hands back for its own deep links.
  const { queryParams } = Linking.parse(result.url)
  const code = typeof queryParams?.code === 'string' ? queryParams.code : null
  const returnedState = typeof queryParams?.state === 'string' ? queryParams.state : null

  if (!code) return null
  if (returnedState !== state) {
    throw new Error('Invalid state parameter — possible CSRF attack')
  }

  return exchangeSsoCode(config, code, redirectUri)
}

/**
 * Nothing to complete: {@link startLogin} already resolved with the session, because the in-app
 * browser handed the redirect straight back instead of re-entering the app at a callback route.
 */
export function completeRedirect(_config: AuthConfig): Promise<AuthSession | null> {
  return Promise.resolve(null)
}
