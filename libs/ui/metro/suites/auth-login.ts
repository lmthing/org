/**
 * SSO login on native.
 *
 * The session suite (`auth.ts`) proves the app can READ a session. This one proves it can OBTAIN
 * one: that the in-app browser is opened at the same `${comUrl}/auth/sso` page the web app uses,
 * with this app's scheme as `redirect_uri`; that the returned code is exchanged; and that the
 * `state` check actually rejects a mismatch rather than being decorative.
 *
 * The seam is imported by RELATIVE PATH (`libs/auth/src/platform/sso`) rather than through the
 * barrel, for two reasons: `startLogin`/`completeRedirect` are internals that should not be public
 * API just to be testable, and the bare specifier is what makes Metro's platform-extension
 * preference the thing under test — the web half would reach for `window.location` and die here.
 *
 * What this does NOT prove — the mocks say so individually: that an OS browser opens, that the
 * custom scheme is registered, or that the redirect is actually intercepted. Those are device
 * claims, and `docs/mobile-native-chat.md` keeps them as device claims.
 */
import { test, expect } from '../harness'
import { startLogin, completeRedirect } from '../../../auth/src/platform/sso'
import * as WebBrowser from 'expo-web-browser'

const browser = WebBrowser as unknown as {
  __setResult: (r: { type: string; url?: string }) => void
  __lastAuthUrl: () => string | null
}

const CONFIG = {
  comUrl: 'https://lmthing.com',
  cloudUrl: 'https://lmthing.cloud',
  appName: 'chat',
  callbackPath: '/auth/callback',
}

const EXCHANGE_BODY = {
  access_token: 'tok-from-exchange',
  refresh_token: 'refresh-from-exchange',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'user-42', email: 'someone@example.com', github_repo: null, github_username: null },
}

/** Capture what the exchange was called with, and answer it. Returns the recorded request. */
function stubExchange(ok = true): { calls: { url: string; body: Record<string, string> }[] } {
  const calls: { url: string; body: Record<string, string> }[] = []
  ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return {
      ok,
      json: async () => (ok ? EXCHANGE_BODY : { error: { message: 'nope' } }),
    }
  }
  return { calls }
}

test('login opens the SSO page with this app scheme as redirect_uri', async () => {
  browser.__setResult({ type: 'cancel' })
  await startLogin(CONFIG, 'state-abc')

  const url = browser.__lastAuthUrl() ?? ''
  expect(url.startsWith('https://lmthing.com/auth/sso?')).toBe(true)

  const query = new URLSearchParams(url.slice(url.indexOf('?') + 1))
  // The app scheme, not an https origin: native has no origin, which is the whole reason this fork
  // exists. `Linking.createURL` is what makes an Expo Go build work without a special case.
  expect(query.get('redirect_uri')).toBe('lmthing://auth/callback')
  expect(query.get('app')).toBe('chat')
  expect(query.get('state')).toBe('state-abc')
})

test('a dismissed browser sheet is not an error — it is just no session', async () => {
  browser.__setResult({ type: 'dismiss' })
  expect(await startLogin(CONFIG, 'state-abc')).toBe(null)
})

test('a returned code is exchanged, with the SAME redirect_uri the gateway stored', async () => {
  const { calls } = stubExchange()
  browser.__setResult({ type: 'success', url: 'lmthing://auth/callback?code=code-1&state=state-abc' })

  const session = await startLogin(CONFIG, 'state-abc')
  expect(session?.accessToken).toBe('tok-from-exchange')
  expect(session?.userId).toBe('user-42')

  // The gateway consumes the code with an exact redirect_uri match and no allowlist, so a seam that
  // sent a different string here would fail only against the real server.
  expect(calls.length).toBe(1)
  expect(calls[0].url).toBe('https://lmthing.cloud/api/auth/sso/exchange')
  expect(calls[0].body.redirect_uri).toBe('lmthing://auth/callback')
  expect(calls[0].body.code).toBe('code-1')
})

test('a mismatched state is REJECTED, and never reaches the exchange', async () => {
  const { calls } = stubExchange()
  browser.__setResult({ type: 'success', url: 'lmthing://auth/callback?code=code-1&state=attacker' })

  let threw = false
  try {
    await startLogin(CONFIG, 'state-abc')
  } catch {
    threw = true
  }
  expect(threw).toBe(true)
  // The check is worthless if the code is spent before it runs.
  expect(calls.length).toBe(0)
})

test('a redirect with no code yields no session', async () => {
  const { calls } = stubExchange()
  browser.__setResult({ type: 'success', url: 'lmthing://auth/callback?error=access_denied' })
  expect(await startLogin(CONFIG, 'state-abc')).toBe(null)
  expect(calls.length).toBe(0)
})

test('completeRedirect is a no-op here — startLogin already finished', async () => {
  // The web sibling reads `window.location` for the code; native never left the app, so there is no
  // second half. A fork that "helpfully" did something here would double-spend the code.
  expect(await completeRedirect(CONFIG)).toBe(null)
})
