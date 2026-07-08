import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getAccessToken, authHeaders, wsTokenSuffix, withAuthToken } from './auth'

/** Install a minimal localStorage backed by an in-memory store. */
function mockLocalStorage(store: Record<string, string>): void {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k]! : null),
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
  })
}

describe('app/auth (token from @lmthing/auth session)', () => {
  beforeEach(() => mockLocalStorage({}))
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads the access token from the lmthing_session and builds auth headers/WS suffix', () => {
    mockLocalStorage({ lmthing_session: JSON.stringify({ accessToken: 'tok-123' }) })

    expect(getAccessToken()).toBe('tok-123')
    expect(authHeaders()).toEqual({ authorization: 'Bearer tok-123' })
    expect(wsTokenSuffix()).toBe('&access_token=tok-123')
  })

  it('returns empty headers/suffix when no session is present', () => {
    expect(getAccessToken()).toBeUndefined()
    expect(authHeaders()).toEqual({})
    expect(wsTokenSuffix()).toBe('')
  })

  it('withAuthToken appends access_token to an upload URL so <img>/<audio> GETs authenticate', () => {
    mockLocalStorage({ lmthing_session: JSON.stringify({ accessToken: 'tok-123' }) })
    // No existing query string → `?`.
    expect(withAuthToken('/api/uploads/abc')).toBe('/api/uploads/abc?access_token=tok-123')
    // Existing query string → `&`.
    expect(withAuthToken('/api/uploads/abc?x=1')).toBe('/api/uploads/abc?x=1&access_token=tok-123')
  })

  it('withAuthToken is a no-op with no session (local/demo mode)', () => {
    expect(withAuthToken('/api/uploads/abc')).toBe('/api/uploads/abc')
  })
})
