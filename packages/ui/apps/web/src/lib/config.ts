/**
 * Centralised URL constants for the web app.
 *
 * Each constant checks the corresponding VITE_* env-var override first so
 * local dev and CI can point at arbitrary origins; in production they resolve
 * to the canonical service URL or the current window origin.
 */

/** Compute pod REST API origin. In production the pod is reached from the same
 *  window origin (Envoy proxies /api/* to the user's compute pod). */
export const COMPUTER_BASE_URL =
  import.meta.env.VITE_COMPUTER_BASE_URL ??
  (import.meta.env.DEV ? 'https://computer.test' : window.location.origin)

/** Cloud gateway origin — auth, billing, compute ensure. */
export const CLOUD_BASE_URL =
  import.meta.env.VITE_CLOUD_BASE_URL ??
  import.meta.env.VITE_CLOUD_URL ??
  (import.meta.env.DEV ? 'https://cloud.test' : 'https://lmthing.cloud')
