import * as Linking from 'expo-linking'

/**
 * Deep-link parameters — NATIVE implementation (the launch URL, then memory).
 *
 * There is no query string to live in and no history to replace, so the parameters are held in
 * memory — but seeded from the URL that actually opened the app, so an `lmthing://…?node=abc` link
 * lands on the same node it would on web. Once the user navigates in-app, memory wins: the launch
 * URL describes how the app was opened, not where the user is now.
 *
 * `Linking.getLinkingURL()` is used rather than `getInitialURL()` precisely because it is
 * **synchronous**, which lets this fork present the same synchronous API as the web half. An async
 * read would have forced `url-state.ts` — a file that is deliberately shared — to fork as well, and
 * a screen, store or data path forking is the thing the whole invariant forbids.
 */
let overrides: Record<string, string> | null = null

/** Only string-valued query params; `expo-linking` also yields arrays for repeated keys. */
function stringParams(queryParams: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(queryParams ?? {})) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

export function readLinkParams(): Record<string, string> {
  if (overrides) return { ...overrides }

  const url = Linking.getLinkingURL()
  if (!url) return {}
  try {
    return stringParams(Linking.parse(url).queryParams)
  } catch {
    // A malformed launch URL means "no parameters", not a crash on the first render.
    return {}
  }
}

/**
 * Merge `patch` into the current parameters. A `null` value removes that key.
 *
 * The first write also takes over from the launch URL, which is why the base is {@link
 * readLinkParams} rather than `overrides` — otherwise the very first navigation would silently drop
 * whatever the deep link had set.
 */
export function writeLinkParams(patch: Record<string, string | null>): void {
  const next = { ...readLinkParams() }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  overrides = next
}
