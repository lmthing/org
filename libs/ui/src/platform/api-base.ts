/**
 * Where the pod's `/api/*` lives — WEB implementation.
 *
 * On web there is an origin, and Envoy proxies `/api/*` on every `lmthing.*` host to the caller's
 * own compute pod (routed by the JWT `sub` claim, not by hostname — `devops/argocd/envoy/
 * chat-policies.yaml`). So a same-origin relative URL is exactly right, and this seam is the
 * identity function: `apiUrl('/api/projects')` is the string that was written there before.
 *
 * On native there is **no origin at all**. `fetch('/api/projects')` does not fall back to anything
 * on React Native — it throws. That is why every transport call site goes through here rather than
 * embedding a leading `/`, and why `scripts/lint-relative-transport.mjs` fails the build on a
 * `fetch`/`WebSocket` whose URL literal starts with one.
 */

/** Origin prefix for pod API calls. Empty on web — the pod is same-origin. */
export function apiBase(): string {
  return ''
}

/** Absolute (here: unchanged) URL for a pod API path such as `/api/projects`. */
export function apiUrl(path: string): string {
  return `${apiBase()}${path}`
}

/**
 * WebSocket URL for a pod API path such as `/api/ws?sessionId=…`.
 *
 * `WebSocket` never accepted a relative URL, so this is the one place web already had to name its
 * origin; the protocol swap is the same one `Sidebar` did inline.
 */
export function wsUrl(path: string): string {
  const loc = globalThis.window?.location
  const proto = loc?.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${loc?.host ?? ''}${path}`
}
