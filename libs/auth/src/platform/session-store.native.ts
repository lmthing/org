import * as SecureStore from 'expo-secure-store'

/**
 * Where the auth session is persisted — NATIVE implementation (the OS keystore).
 *
 * Two things are true at once and they conflict:
 *
 *   - The session holds a **bearer token**. On a phone that belongs in the Keychain / Android
 *     Keystore, not in the app-private plaintext `AsyncStorage` the other `platform/` seams use.
 *     Anyone with the file is otherwise the user.
 *   - `getSession()` is **synchronous**, and has to stay that way — it is read from inside
 *     `fetch(url, { headers: authHeaders() })` in a dozen places. `SecureStore` is async.
 *
 * The resolution is a read-through cache: {@link hydrate} loads the keystore once at boot, reads
 * come from memory, and writes update memory first and the keystore after. The cache is the
 * authority for the life of the process, so a read can never observe a write that has not landed.
 *
 * The cost, stated plainly: **reads before `hydrate()` resolves return null**, which an app would
 * render as "logged out" and then flip. `apps/mobile` therefore awaits `hydrateAuth()` before it
 * mounts the tree, and {@link isHydrated} exists so that contract can be asserted rather than
 * assumed.
 *
 * Persistence is fire-and-forget because the API is synchronous. That is safe in the direction that
 * matters — the process never reads a stale value — and the failure it admits is narrow: a write
 * issued in the last moments before a hard kill may not reach the keystore, costing one re-login.
 */
const cache = new Map<string, string>()
let hydrated = false

/** Synchronous read of a persisted auth value. Null until {@link hydrate} has resolved. */
export function readItem(key: string): string | null {
  return cache.get(key) ?? null
}

export function writeItem(key: string, value: string): void {
  cache.set(key, value)
  void SecureStore.setItemAsync(key, value).catch(() => {
    /* keystore unavailable — the in-memory session still works for this launch */
  })
}

export function removeItem(key: string): void {
  cache.delete(key)
  void SecureStore.deleteItemAsync(key).catch(() => {
    /* as above */
  })
}

/**
 * Load `keys` from the keystore into the cache so {@link readItem} can answer synchronously.
 *
 * Await this before rendering anything that reads a session. A key that is absent or unreadable is
 * skipped rather than thrown on: a corrupt entry should mean "log in again", not a boot loop.
 */
export async function hydrate(keys: readonly string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        const value = await SecureStore.getItemAsync(key)
        if (value !== null) cache.set(key, value)
      } catch {
        /* unreadable entry — treat as absent */
      }
    }),
  )
  hydrated = true
}

/** Whether {@link readItem} can be trusted yet. */
export function isHydrated(): boolean {
  return hydrated
}
