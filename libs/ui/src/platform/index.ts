/**
 * `platform/` — the seam for browser globals that have no direct React Native equivalent
 * (Tamagui migration §7 step 8). Each capability is a `*.ts` (web, current behavior verbatim) +
 * `*.native.ts` (RN) pair; Metro prefers `.native.ts` on native, web bundlers keep `.ts`. Surfaces
 * migrate off raw `localStorage` / `navigator.clipboard` / `window` onto these APIs incrementally,
 * so the same surface code runs on both targets.
 *
 * Covered: `storage` (localStorage ↔ AsyncStorage), `clipboard` (navigator.clipboard ↔ RN
 * Clipboard), window `dimensions` (window resize ↔ RN Dimensions), `api-base` (the same-origin
 * `/api/*` prefix ↔ an absolute pod URL, since native has no origin) and `deep-link` (the query
 * string ↔ the launch URL plus memory), `keyboard` (Escape ↔ the Android back
 * gesture) and `navigation`. Follow-ups noted in the doc:
 * `document`/`AppState` listeners and `getBoundingClientRect`→`onLayout`.
 */
export { storage } from './storage'
export { clipboard } from './clipboard'
export { haptics } from './haptics'
export { getWindowSize, subscribeWindowSize, type Size } from './dimensions'
export { apiBase, apiUrl, wsUrl, cloudBaseOverride, teamBase } from './api-base'
export { readLinkParams, writeLinkParams } from './deep-link'
export { onDismiss, onKeyDown } from './keyboard'
export { openUrl, reloadApp, setAppTitle, currentUrl } from './navigation'
