import { describe, it, expect, afterEach, vi } from 'vitest'
import type { AuthConfig } from '../types'
import { startLogin } from './sso'

/**
 * The web product surfaces (chat/studio/computer/team/app) have NO embedded login form: when a user
 * is unauthenticated their `AuthGate` calls `useAuth().login()`, which routes here. So the invariant
 * this suite pins — "an unauthenticated web user is sent to lmthing.com's SSO endpoint with the right
 * `redirect_uri`/`app`/`state`" — is what every web sign-in now depends on, not just the GitHub
 * button that used to be the only caller.
 *
 * Runs under the root runner's `environment: 'node'`, with `window` stubbed by hand for the same
 * reason `env.test.ts` does: jsdom cannot represent the origins under test and a hand-rolled stub
 * states the exact shape the code reads.
 */
const config: AuthConfig = {
  comUrl: 'https://lmthing.com',
  cloudUrl: 'https://lmthing.cloud',
  appName: 'studio',
  callbackPath: '/',
}

/** Minimal browser-shaped global: enough for `isWeb()`/`getDesktopBridge()` and `location`. */
function asWebPage(origin: string): void {
  vi.stubGlobal('window', {
    document: {},
    location: { origin, href: '' },
    // No `__LMTHING_DESKTOP__` → getDesktopBridge() returns null → the plain web redirect branch.
  })
  const store = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    getItem: (k: string) => store.get(k) ?? null,
    removeItem: (k: string) => {
      store.delete(k)
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startLogin (web)', () => {
  it('redirects the browser to lmthing.com/auth/sso with the surface as redirect_uri + app + state', () => {
    asWebPage('https://lmthing.chat')
    // `state` is passed in (the caller generates it), so this exercises no crypto.
    startLogin(config, 'cafef00d')

    const href = (window as unknown as { location: { href: string } }).location.href
    const url = new URL(href)

    expect(url.origin + url.pathname).toBe('https://lmthing.com/auth/sso')
    expect(url.searchParams.get('redirect_uri')).toBe('https://lmthing.chat/')
    expect(url.searchParams.get('app')).toBe('studio')
    expect(url.searchParams.get('state')).toBe('cafef00d')
    // The CSRF nonce is stashed so the redirect-back can verify it (see completeRedirect).
    expect(sessionStorage.getItem('sso_state')).toBe('cafef00d')
  })

  it('points redirect_uri at whatever surface the user is on (not hard-coded to one domain)', () => {
    asWebPage('https://lmthing.team')
    const teamConfig: AuthConfig = { ...config, appName: 'team' }
    startLogin(teamConfig, '1')

    const href = (window as unknown as { location: { href: string } }).location.href
    const url = new URL(href)
    expect(url.searchParams.get('redirect_uri')).toBe('https://lmthing.team/')
    expect(url.searchParams.get('app')).toBe('team')
  })

  it('never takes the desktop deep-link branch when no shell bridge is present', () => {
    asWebPage('https://lmthing.studio')
    startLogin(config, 'abc')

    const href = (window as unknown as { location: { href: string } }).location.href
    // A desktop shell would have produced an `lmthing://` callback redirect_uri; a browser must not.
    expect(href.startsWith('https://lmthing.com/auth/sso')).toBe(true)
    expect(url(href).searchParams.get('redirect_uri')).toBe('https://lmthing.studio/')
  })
})

function url(s: string): URL {
  return new URL(s)
}
