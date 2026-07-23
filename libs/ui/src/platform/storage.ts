/**
 * Key/value storage — WEB implementation (localStorage). The native counterpart (`storage.native.ts`)
 * uses AsyncStorage. Behind this `platform/` seam so a surface calls one API on both targets
 * (§7 step 8). This web file is the current browser behavior, verbatim; consumers migrate off raw
 * `localStorage` to here incrementally.
 *
 * Note the async signatures: localStorage is synchronous but AsyncStorage is not, so the seam is
 * Promise-based to match the lowest common denominator (callers `await`).
 */
export const storage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return globalThis.localStorage?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      globalThis.localStorage?.setItem(key, value)
    } catch {
      /* quota / disabled storage — ignore, as the current code does */
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      globalThis.localStorage?.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}
