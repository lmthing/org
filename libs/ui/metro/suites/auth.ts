/**
 * The auth session on native.
 *
 * `chat/` imports exactly one thing from `@lmthing/auth` — `getSession` — and every authenticated
 * request in the surface goes through it. It read `localStorage` directly, which on React Native is
 * not an error but something worse: `globalThis.localStorage?.getItem(…)` is `undefined ?? null`, so
 * the web half would return **null forever, silently**, and every request would look merely
 * unauthenticated. Nothing would throw and nothing would say why.
 *
 * That is why the assertions below are BEHAVIOURAL rather than "does it import". A store-then-read
 * round-trip is the one thing the web fork cannot pass on this target, so it is what proves Metro
 * selected `session-store.native.ts`.
 *
 * What this does NOT prove — see `mocks/expo-secure-store.js`: that the OS keystore is reached, that
 * anything is encrypted at rest, or that a session survives a real app restart. The mock is an
 * in-memory Map. Those are device claims and the plan keeps them as device claims.
 */
import { test, expect } from '../harness'
import { getSession, storeSession, clearSession, hydrateAuth, isAuthHydrated } from '@lmthing/auth'

const SESSION = {
  accessToken: 'tok-native-1',
  refreshToken: 'refresh-native-1',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  userId: 'user-1',
  email: 'someone@example.com',
  githubRepo: null,
  githubUsername: null,
}

test('the session store is NOT hydrated before boot asks it to be', () => {
  // On web this is always true, because localStorage is synchronous and there is nothing to load.
  // False here is the fork-selection proof, and it is also the contract `apps/mobile` has to honour:
  // render after `hydrateAuth()`, or paint a logged-out shell and flip.
  expect(isAuthHydrated()).toBe(false)
  expect(getSession()).toBe(null)
})

test('hydrateAuth resolves and marks the store readable', async () => {
  await hydrateAuth()
  expect(isAuthHydrated()).toBe(true)
})

test('a stored session reads back SYNCHRONOUSLY — the whole reason the seam exists', async () => {
  await hydrateAuth()
  storeSession(SESSION)
  // No await. `authHeaders()` is called from inside `fetch(url, { headers: … })`, so if this needed
  // a tick the entire chat surface would have to become async with it. With the web fork on this
  // target the write is a no-op and this is null.
  const read = getSession()
  expect(read?.accessToken).toBe('tok-native-1')
  expect(read?.userId).toBe('user-1')
})

test('a hydrate on a later launch recovers what the previous one wrote', async () => {
  await hydrateAuth()
  storeSession(SESSION)
  // The cache is populated, so re-hydrating must not lose or duplicate anything — this is the
  // "reopen the app" path, as far as an in-memory keystore can model it.
  await hydrateAuth()
  expect(getSession()?.accessToken).toBe('tok-native-1')
})

test('clearSession removes it from the synchronous store', async () => {
  await hydrateAuth()
  storeSession(SESSION)
  clearSession()
  expect(getSession()).toBe(null)
})
