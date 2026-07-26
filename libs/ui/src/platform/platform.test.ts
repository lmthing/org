import { describe, it, expect } from 'vitest'
import { storage } from './storage'
import { clipboard } from './clipboard'
import { getWindowSize, subscribeWindowSize } from './dimensions'
import { apiBase, apiUrl, wsUrl } from './api-base'

/**
 * Runtime verification of the WEB platform shims (jsdom). The native mirrors (`*.native.ts`) are
 * verified in the mobile app. Proves the seam's web behavior matches the raw browser APIs it
 * replaces. See docs/react-native-tamagui-migration.md §7 step 8.
 */
describe('platform (web)', () => {
  it('storage round-trips via localStorage', async () => {
    await storage.setItem('k', 'v')
    expect(await storage.getItem('k')).toBe('v')
    await storage.removeItem('k')
    expect(await storage.getItem('k')).toBeNull()
  })

  it('storage.getItem returns null for a missing key (no throw)', async () => {
    expect(await storage.getItem('does-not-exist')).toBeNull()
  })

  it('clipboard.writeText resolves to a boolean without throwing (no API in jsdom → false)', async () => {
    const ok = await clipboard.writeText('hello')
    expect(typeof ok).toBe('boolean')
  })

  it('getWindowSize returns numeric dimensions', () => {
    const s = getWindowSize()
    expect(typeof s.width).toBe('number')
    expect(typeof s.height).toBe('number')
  })

  it('apiUrl is the IDENTITY on web — the seam changes no request the browser makes', () => {
    // The zero-delta claim for this step, stated as a test. Every `/api/*` call site now goes
    // through `apiUrl`, so if this were ever anything but identity, every fetch in the app would
    // change at once.
    expect(apiBase()).toBe('')
    expect(apiUrl('/api/env')).toBe('/api/env')
    expect(apiUrl('/api/projects/p1/sessions')).toBe('/api/projects/p1/sessions')
  })

  it('wsUrl derives an absolute socket url from the page origin', () => {
    // WebSocket never accepted a relative url, so this reproduces what Sidebar built inline.
    const url = wsUrl('/api/ws?sessionId=abc')
    expect(url.startsWith('ws://') || url.startsWith('wss://')).toBe(true)
    expect(url.endsWith(`//${window.location.host}/api/ws?sessionId=abc`)).toBe(true)
  })

  it('subscribeWindowSize returns an unsubscribe fn and fires on resize', () => {
    let calls = 0
    const off = subscribeWindowSize(() => {
      calls++
    })
    expect(typeof off).toBe('function')
    globalThis.window?.dispatchEvent(new Event('resize'))
    expect(calls).toBe(1)
    off()
    globalThis.window?.dispatchEvent(new Event('resize'))
    expect(calls).toBe(1)
  })
})
