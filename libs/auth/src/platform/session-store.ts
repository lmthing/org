/**
 * Where the auth session is persisted — WEB implementation.
 *
 * `localStorage` is synchronous, which is the property the whole auth client is built on:
 * `getSession()` is called from inside `fetch(url, { headers: authHeaders() })`, so it cannot be
 * async without turning every call site in `chat/` async with it. This file is therefore a direct
 * passthrough and changes nothing about how the browser behaves.
 *
 * The native sibling has to reach the same synchronous API over an asynchronous keystore, which is
 * why {@link hydrate} exists at all — see `session-store.native.ts` for what it costs there.
 */

/** Synchronous read of a persisted auth value. */
export function readItem(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    // Safari in private mode, and any embedding that blocks storage access.
    return null
  }
}

export function writeItem(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    /* storage unavailable — the in-page session still works for this tab */
  }
}

export function removeItem(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    /* as above */
  }
}

/**
 * Load persisted values so {@link readItem} can answer synchronously.
 *
 * A no-op on web: `localStorage` is already synchronous, so there is nothing to pre-load. Callers
 * still await it, so the boot sequence is written once for both targets.
 */
export function hydrate(_keys: readonly string[]): Promise<void> {
  return Promise.resolve()
}

/** Whether {@link readItem} can be trusted yet. Always true on web. */
export function isHydrated(): boolean {
  return true
}
