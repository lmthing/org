import * as Crypto from 'expo-crypto'

/**
 * Cryptographic randomness — NATIVE implementation (`expo-crypto`).
 *
 * React Native has no `crypto` global, so the web half would throw `ReferenceError: crypto is not
 * defined` the first time a login was attempted. `expo-crypto`'s `getRandomValues` implements the
 * same Web Crypto signature — fills the array in place, returns it — so the caller is one function
 * for both targets and the `state` value is generated the same way on each.
 */
export function getRandomValues(bytes: Uint8Array): Uint8Array {
  return Crypto.getRandomValues(bytes)
}
