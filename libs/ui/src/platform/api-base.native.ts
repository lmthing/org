/**
 * Where the pod's `/api/*` lives — NATIVE implementation.
 *
 * A React Native bundle has no origin, so the base must be absolute. It defaults to production and
 * is overridable with `EXPO_PUBLIC_API_BASE`, which `babel-preset-expo` inlines at build time —
 * pointing a dev build at a local pod (`EXPO_PUBLIC_API_BASE=http://10.0.2.2:3000` for the Android
 * emulator's host loopback) needs no code change.
 *
 * The default is `lmthing.chat` because that host's `/api` HTTPRoute is bound to the per-user
 * dynamic backend: Envoy validates the gateway JWT and routes on its `sub` claim, so the host only
 * selects the *route*, and the token selects the *pod*. Any other `lmthing.*` host with the same
 * policy would work identically.
 */
const DEFAULT_BASE = 'https://lmthing.chat'

/** Origin prefix for pod API calls — absolute, because native has no origin to be relative to. */
export function apiBase(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE
  return configured ? configured.replace(/\/+$/, '') : DEFAULT_BASE
}

/** Absolute URL for a pod API path such as `/api/projects`. */
export function apiUrl(path: string): string {
  return `${apiBase()}${path}`
}

/** WebSocket URL for a pod API path such as `/api/ws?sessionId=…`. */
export function wsUrl(path: string): string {
  return `${apiBase().replace(/^http/, 'ws')}${path}`
}

/**
 * Where the GATEWAY lives on native — overridable with `EXPO_PUBLIC_CLOUD_BASE`.
 *
 * `dataPlaneOrigin('cloud')` derives its answer from `window.location`, which does not exist here,
 * so it fell through to the production constant with no way to say otherwise. That meant a device
 * build could be pointed at a local POD (`EXPO_PUBLIC_API_BASE`) while every shared surface that
 * asks the GATEWAY a question — the Home dashboard's team list, first among them — still went to
 * production and failed. Same variable the app's own `src/hosts.ts` reads, so the two halves of a
 * build cannot disagree about which gateway they are talking to.
 */
export function cloudBaseOverride(): string {
  const configured = process.env.EXPO_PUBLIC_CLOUD_BASE
  return configured ? configured.replace(/\/+$/, '') : ''
}
