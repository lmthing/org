/**
 * Deep-link parameters — WEB implementation (the query string).
 *
 * `chat/` uses the URL as a state channel: `?node=<id>&tab=<tab>&follow=0` makes a view of a session
 * linkable and, as the original comment put it, LLM-friendly. That is a genuinely good design on
 * web and it is not portable — React Native has no `window.location` and no history to replace.
 *
 * So the CHANNEL is abstracted rather than the feature: `url-state.ts` stays one file that reads and
 * writes named parameters, and only the place they live differs. Web keeps the query string, so a
 * link a user copies still works exactly as before.
 *
 * {@link writeLinkParams} takes a PATCH, not a replacement, and that is load-bearing: the surface
 * only owns `node`/`tab`/`follow`, and blowing away every other query parameter on the way past
 * would break anything else sharing the URL.
 */

/** Every deep-link parameter currently set. */
export function readLinkParams(): Record<string, string> {
  const search = globalThis.window?.location?.search ?? ''
  const out: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(search)) out[key] = value
  return out
}

/**
 * Merge `patch` into the current parameters. A `null` value removes that key; anything not named is
 * left alone.
 */
export function writeLinkParams(patch: Record<string, string | null>): void {
  const location = globalThis.window?.location
  const history = globalThis.window?.history
  if (!location || !history) return

  const params = new URLSearchParams(location.search)
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  history.replaceState(null, '', `${location.pathname}?${params.toString()}`)
}
