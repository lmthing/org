/**
 * Cryptographic randomness — WEB implementation (Web Crypto).
 *
 * Used for the OAuth `state` value, so it must be unpredictable rather than merely unique. Behind a
 * seam because React Native ships **no `crypto` global at all** and Expo does not polyfill one
 * (checked: `expo/build/winter` installs `fetch`, `FormData`, `TextDecoder`… and no `crypto`). A
 * `Math.random()` fallback would have been the quiet wrong answer — it still produces a distinct
 * string, so nothing would look broken while CSRF protection was gone.
 */
export function getRandomValues(bytes: Uint8Array): Uint8Array {
  return crypto.getRandomValues(bytes)
}
