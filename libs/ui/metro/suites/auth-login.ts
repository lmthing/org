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
import { requestEmailCode, verifyEmailCode } from '../../../auth/src/email-login'
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

// ── passwordless email sign-in ───────────────────────────────────────────────
//
// The other door, and the only one that completes IN THE APP. Everything above needs a browser
// session because GitHub is an external identity provider; these two calls need nothing but
// `fetch`, which is why the mobile app can sign a user in without a sheet at all.
//
// Imported by relative path for the same reason as the seam above — but note this module is NOT
// forked: there is one implementation for both targets, and that is the claim worth protecting.

const EMAIL_SESSION = {
  access_token: 'tok-from-email',
  refresh_token: 'refresh-from-email',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'user-77', email: 'someone@example.com' },
}

function stubJson(body: unknown, ok = true): { calls: { url: string; body: Record<string, string> }[] } {
  const calls: { url: string; body: Record<string, string> }[] = []
  ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return { ok, json: async () => body }
  }
  return { calls }
}

test('requesting a code opens NO browser sheet — the whole point on a phone', async () => {
  // The guard against someone "unifying" this onto the SSO seam later: if an email sign-in ever
  // starts routing through `/auth/sso`, a browser URL appears here and this fails.
  browser.__setResult({ type: 'cancel' })
  await startLogin(CONFIG, 'seen-before') // leaves a URL behind, so `null` below means something
  const before = browser.__lastAuthUrl()

  stubJson({ sent: true, email: 'v••••@example.com', expires_at: EMAIL_SESSION.expires_at })
  await requestEmailCode(CONFIG, 'someone@example.com')

  expect(browser.__lastAuthUrl()).toBe(before)
})

test('native sends NO redirect_uri — the gateway allowlist would reject a deep link', async () => {
  // `isAllowedRedirect` accepts http/https only, so passing `lmthing://auth/callback` here would
  // 400 the whole request. Native omits it and the user types the code instead.
  const { calls } = stubJson({ sent: true, email: 'v••••@example.com', expires_at: 1 })
  await requestEmailCode(CONFIG, 'someone@example.com')

  expect(calls.length).toBe(1)
  expect(calls[0].url).toBe('https://lmthing.cloud/api/auth/email/start')
  expect(calls[0].body.email).toBe('someone@example.com')
  expect('redirect_uri' in calls[0].body).toBe(false)
})

test('a mailed code becomes a session in the SAME shape the SSO exchange yields', async () => {
  // An address that signs in by email and one that signs in through GitHub resolve to ONE Zitadel
  // user, so a session that differed in shape between the two paths would be a latent bug in
  // whatever consumes it.
  const { calls } = stubJson(EMAIL_SESSION)
  const session = await verifyEmailCode(CONFIG, 'someone@example.com', '123456')

  expect(calls[0].url).toBe('https://lmthing.cloud/api/auth/email/verify')
  expect(calls[0].body.code).toBe('123456')
  expect(session.accessToken).toBe('tok-from-email')
  expect(session.userId).toBe('user-77')
  expect(session.email).toBe('someone@example.com')
  // Absent from the payload rather than null — the mapping must not leave them `undefined`, which
  // is what the session store persists and the backup surfaces then read.
  expect(session.githubRepo).toBe(null)
  expect(session.githubUsername).toBe(null)
})

test('a rejected code surfaces the gateway’s own message, not a generic one', async () => {
  // "That code is not right" vs "Too many incorrect attempts" is the difference between retrying
  // and requesting a new one, so the text has to survive the boundary.
  stubJson({ error: 'Too many incorrect attempts — request a new code' }, false)

  let message = ''
  try {
    await verifyEmailCode(CONFIG, 'someone@example.com', '000000')
  } catch (err) {
    message = err instanceof Error ? err.message : ''
  }
  expect(message).toBe('Too many incorrect attempts — request a new code')
})
