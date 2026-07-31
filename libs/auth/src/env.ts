/**
 * Which kind of host is this bundle running in?
 *
 * Three targets share this code and only two of them are distinguishable from the language: a
 * browser, a React Native runtime, and — since the Tauri app — a desktop shell whose renderer IS a
 * browser but whose *origin is a lie*. This file is where that third case gets a name.
 */

/**
 * True only in a real browser. React Native's own bootstrap (`setUpGlobals.js`) sets
 * `global.window = global` for npm-package compatibility, so `typeof window !== 'undefined'` is
 * true on native too — every other DOM-only property (`location`, `document`, `history`) is
 * NOT shimmed, so reading through them unconditionally throws instead of falling through the
 * `undefined` branch. `window.document` is a real signal RN never sets.
 */
export function isWeb(): boolean {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined'
}

/**
 * The contract version of {@link DesktopBridge}. Bumped when a field changes meaning or is removed;
 * a shell announcing anything else is ignored wholesale, so an old app and a new shell degrade to
 * "not desktop" rather than to a half-understood object.
 */
export const DESKTOP_PROTOCOL_VERSION = 1

/**
 * The object `sdk/org/apps/desktop`'s Rust side injects into every page via
 * `WebviewWindowBuilder::initialization_script`, before any bundle script runs.
 *
 * It exists because a Tauri webview serves the app from `tauri://localhost` (macOS/Linux) or
 * `http://tauri.localhost` (Windows). That origin is not the pod, not the gateway, and not a
 * meaningful base for anything — so the three questions shared code normally answers from
 * `window.location` have to be answered by the host instead.
 *
 * This is deliberately a RUNTIME value rather than a `platform/*.desktop.ts` build-time fork:
 *  - a `.desktop.ts` sibling would be invisible to `libs/ui/scripts/lint-native-forks.mjs`, which
 *    scans only `.native`/`.web` — an unlisted, unreasoned-about file in `platform/` is the one
 *    failure mode a ratchet must not have;
 *  - and the value genuinely needs to change at runtime: local mode repoints `apiBase` at a
 *    loopback sidecar with no rebuild.
 *
 * The precedent is `window.__LM_ACCESS_TOKEN__` (see `getPodInjectedToken`) — the pod bootstrap
 * already injects a global that shared code reads defensively.
 *
 * Read it through {@link getDesktopBridge} and feature-check the optional members
 * (`if (bridge.startSso)`), never a truthiness check on the object itself.
 */
export interface DesktopBridge {
  /** Must equal {@link DESKTOP_PROTOCOL_VERSION}; anything else is ignored. */
  protocolVersion: number
  platform: 'macos' | 'windows' | 'linux'
  /** `cloud` — a hosted compute pod. `local` — a bundled sidecar on loopback. */
  mode: 'cloud' | 'local'
  /** Absolute origin of the pod's `/api/*`, no trailing slash. */
  apiBase: string
  /** Absolute origin of the gateway, no trailing slash. */
  cloudBase: string
  /** Absolute origin of the team surface, no trailing slash. */
  teamBase: string
  /**
   * The custom-scheme URL the SSO callback comes back to, e.g. `lmthing://auth/callback`.
   * Present whenever {@link startSso} is.
   */
  ssoRedirectUri?: string
  /**
   * Open `url` in the SYSTEM browser and resolve with the full callback URL once the deep link
   * fires. Supplied by the shell's own boot script, so the Tauri JS plugins stay out of the shared
   * libraries entirely.
   */
  startSso?: (url: string, redirectUri: string) => Promise<string>
}

/**
 * The injected bridge, or null when this is not a desktop shell (a browser, a phone, or a shell
 * announcing a protocol version this build does not understand).
 */
export function getDesktopBridge(): DesktopBridge | null {
  if (!isWeb()) return null
  const bridge = (window as unknown as { __LMTHING_DESKTOP__?: DesktopBridge }).__LMTHING_DESKTOP__
  if (!bridge || bridge.protocolVersion !== DESKTOP_PROTOCOL_VERSION) return null
  return bridge
}

/** True when running inside the LMThing desktop shell. */
export function isDesktopRun(): boolean {
  return getDesktopBridge() !== null
}
