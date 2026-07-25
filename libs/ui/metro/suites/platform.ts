/**
 * The `platform/` seams on native — `storage` (AsyncStorage), `clipboard` (RN Clipboard),
 * `dimensions` (RN `Dimensions`).
 *
 * `src/platform/platform.test.ts` runs in jsdom and therefore tests the `.ts` (web) half only; the
 * `.native.ts` half has never executed anywhere. These cases are reached through the SAME
 * `platform/index.ts` barrel the surfaces import, so Metro's fork preference is what selects them —
 * exactly the mechanism that has to work on a device.
 */
import { test, expect } from '../harness'
import { storage, clipboard, getWindowSize, subscribeWindowSize } from '../../src/platform'

test('getWindowSize reads RN Dimensions and returns numbers', () => {
  const size = getWindowSize()
  expect(typeof size.width).toBe('number')
  expect(typeof size.height).toBe('number')
})

test('subscribeWindowSize returns a working unsubscribe', () => {
  const unsubscribe = subscribeWindowSize(() => {})
  expect(typeof unsubscribe).toBe('function')
  // Must not throw: RN's `Dimensions.addEventListener` returns a subscription with `.remove()`,
  // and an unsubscribe that assumed the pre-0.65 removal API would only fail here.
  unsubscribe()
})

test('the storage seam round-trips through AsyncStorage', async () => {
  expect(await storage.getItem('metro-harness')).toBeNull()
  await storage.setItem('metro-harness', 'value')
  expect(await storage.getItem('metro-harness')).toBe('value')
  await storage.removeItem('metro-harness')
  expect(await storage.getItem('metro-harness')).toBeNull()
})

test('the clipboard seam writes through RN Clipboard and reports success', async () => {
  expect(await clipboard.writeText('copied')).toBe(true)
  // The seam swallows failures and returns '' — proving the happy path returns the string is what
  // distinguishes "wired up" from "silently degraded".
  expect(typeof (await clipboard.readText())).toBe('string')
})
