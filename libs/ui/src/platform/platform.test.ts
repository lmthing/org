import { describe, it, expect } from 'vitest'
import { storage } from './storage'
import { clipboard } from './clipboard'
import { getWindowSize, subscribeWindowSize } from './dimensions'

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
