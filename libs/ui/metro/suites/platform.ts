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
import {
  storage,
  clipboard,
  getWindowSize,
  subscribeWindowSize,
  apiBase,
  apiUrl,
  wsUrl,
  readLinkParams,
  writeLinkParams,
} from '../../src/platform'
import * as Linking from 'expo-linking'

/** The mock control surface — see metro/mocks/expo-linking.js. */
const linking = Linking as unknown as { __setLinkingURL: (url: string | null) => void }

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

test('the clipboard seam writes through Expo Clipboard and reports success', async () => {
  expect(await clipboard.writeText('copied')).toBe(true)
  // The seam swallows failures and returns '' — proving the happy path returns the string is what
  // distinguishes "wired up" from "silently degraded".
  expect(typeof (await clipboard.readText())).toBe('string')
})

test('the api base is ABSOLUTE here — the web half would resolve to nothing', () => {
  // This is the whole point of the seam, and the assertion that fails if Metro ever picks the `.ts`
  // sibling: on web `apiBase()` is '' and `apiUrl('/api/env')` is '/api/env', which React Native's
  // fetch cannot resolve against anything. Asserting the PREFIX rather than a fixed host keeps
  // `EXPO_PUBLIC_API_BASE` free to point a dev build at a local pod.
  expect(apiBase().startsWith('http')).toBe(true)
  expect(apiUrl('/api/env').endsWith('/api/env')).toBe(true)
  expect(apiUrl('/api/env').startsWith('http')).toBe(true)
})

test('the ws url swaps the scheme rather than the host', () => {
  const url = wsUrl('/api/ws?sessionId=abc')
  expect(url.startsWith('ws')).toBe(true)
  expect(url.includes('http')).toBe(false)
  expect(url.endsWith('/api/ws?sessionId=abc')).toBe(true)
})

test('deep-link params are seeded from the URL that OPENED the app', () => {
  // `?node=…` in an `lmthing://` link has to reach the surface the same way a web query string
  // does, or a shared link opens the app on the wrong node. The web half would read
  // `window.location.search` — undefined here — and silently return nothing.
  linking.__setLinkingURL('lmthing://chat?node=n-9&tab=code&follow=0')
  const params = readLinkParams()
  expect(params.node).toBe('n-9')
  expect(params.tab).toBe('code')
  expect(params.follow).toBe('0')
})

test('a write PATCHES the params and takes over from the launch url', () => {
  linking.__setLinkingURL('lmthing://chat?node=n-9&keep=yes')
  writeLinkParams({ node: 'n-10', follow: '0' })

  const params = readLinkParams()
  expect(params.node).toBe('n-10')
  expect(params.follow).toBe('0')
  // The first write must not drop what the deep link set — the surface owns node/tab/follow only.
  expect(params.keep).toBe('yes')
})

test('a null value removes a param', () => {
  linking.__setLinkingURL('lmthing://chat?node=n-9')
  writeLinkParams({ node: null })
  expect(readLinkParams().node).toBe(undefined)
})

test('no launch url means no params, not a crash on first render', () => {
  linking.__setLinkingURL(null)
  writeLinkParams({ node: null, tab: null, follow: null, keep: null })
  expect(Object.keys(readLinkParams()).length).toBe(0)
})
