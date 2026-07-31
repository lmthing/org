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

/**
 * The desktop shell is served by this same WEB fork — a Tauri renderer is a browser, so nothing
 * here resolves to `.native`. But its origin is `tauri://localhost` (macOS/Linux) or
 * `http://tauri.localhost` (Windows), which is neither the pod nor anything else useful, so every
 * answer below that would be derived from `window.location` is instead taken from the host-injected
 * bridge. Absent (an ordinary browser), each branch is inert and the previous behaviour stands.
 */
import { getDesktopBridge } from '@lmthing/auth'

/** Origin prefix for pod API calls. Empty on web — the pod is same-origin. */
export function apiBase(): string {
  return getDesktopBridge()?.apiBase.replace(/\/+$/, '') ?? ''
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
 *
 * The desktop branch is load-bearing rather than cosmetic: under `tauri://localhost` the
 * `location.protocol` test below is not `https:`, so the fallthrough would build
 * `ws://localhost/api/ws` — a syntactically valid URL pointing at nothing, which fails as a
 * connection error rather than as a configuration one.
 */
export function wsUrl(path: string): string {
  const base = apiBase()
  if (base) return `${base.replace(/^http/, 'ws')}${path}`
  const loc = globalThis.window?.location
  const proto = loc?.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${loc?.host ?? ''}${path}`
}

/**
 * Where the GATEWAY lives, for the shared surfaces that talk to it directly (the dashboard's team
 * list, billing). Empty on web means "let `dataPlaneOrigin` decide from the hostname", which is
 * what it already did — this seam exists for the native fork's sake, and now the desktop's.
 */
export function cloudBaseOverride(): string {
  return getDesktopBridge()?.cloudBase.replace(/\/+$/, '') ?? ''
}

/**
 * Where a TEAM's pod is reached.
 *
 * The edge routes by the `team` claim in the token, so the host only selects the route and the
 * token selects the pod — there is no per-team hostname to construct, which is why this is one
 * origin rather than a function of the team id.
 *
 * On web the answer is the team surface's own domain; a host that knows better (native's
 * `EXPO_PUBLIC_TEAM_BASE`, the desktop bridge) overrides it.
 */
export function teamBase(): string {
  return getDesktopBridge()?.teamBase.replace(/\/+$/, '') ?? 'https://lmthing.team'
}
