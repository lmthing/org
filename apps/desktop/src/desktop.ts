/**
 * This shell's own view of the host bridge — and the one place the Tauri JS plugins are imported.
 *
 * `@lmthing/auth` declares the bridge's SHAPE (`DesktopBridge`) and reads it defensively; that is
 * shared code and must stay free of any Tauri import, or `apps/web`, `apps/mobile` and every
 * product SPA would start carrying a dependency on a desktop runtime they will never have.
 *
 * The split is: Rust injects the DATA half (origins, platform, mode) before any bundle script runs,
 * and this file attaches the BEHAVIOUR half (`startSso`) as the app boots. Both halves are in place
 * before React mounts, which is all `startLogin` requires — a person cannot click "Sign in with
 * GitHub" before the tree exists.
 */
import { getDesktopBridge, type DesktopBridge } from '@lmthing/auth'
import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { openUrl } from '@tauri-apps/plugin-opener'

/** The scheme the installer registers; must match `tauri.conf.json`'s `plugins.deep-link`. */
export const SSO_REDIRECT_URI = 'lmthing://auth/callback'

/**
 * Fail loudly rather than fall back to a browser default.
 *
 * Every "sensible default" available here is wrong in a way that presents as something else: an
 * empty `apiBase` makes `fetch` address `tauri://localhost` and read as a network outage, and
 * guessing production would silently ignore whatever the shell was configured with. A missing
 * bridge means the Rust side did not run its initialization script, which is a broken build, not a
 * runtime condition to paper over.
 */
export function requireBridge(): DesktopBridge {
  const bridge = getDesktopBridge()
  if (!bridge) {
    throw new Error(
      'No __LMTHING_DESKTOP__ bridge on the page. The Tauri initialization script did not run — ' +
        'this build is broken, not misconfigured.',
    )
  }
  return bridge
}

/**
 * Give the injected bridge its `startSso`, so `@lmthing/auth`'s `startLogin` can take the desktop
 * branch instead of assigning `location.href`.
 *
 * Assigning `location.href` in a Tauri window navigates the single webview off the bundle to
 * lmthing.com with nothing to come back to — the app is simply gone until the user force-quits.
 * So: hand the URL to the SYSTEM browser (which is also where the person's GitHub session already
 * is) and wait for the OS to hand back the `lmthing://` callback.
 *
 * Must be called BEFORE the tree mounts.
 */
export function installSsoHandler(): void {
  const bridge = requireBridge()
  bridge.ssoRedirectUri = SSO_REDIRECT_URI
  bridge.startSso = (url: string) =>
    new Promise<string>((resolve, reject) => {
      let unlisten: (() => void) | undefined
      let settled = false

      // A login the user abandons must not leave a listener (and a pending promise) alive for the
      // rest of the session — the next attempt would then have two, and the first would win with a
      // stale `state` and throw a CSRF error at someone who did nothing wrong.
      const timer = setTimeout(
        () => finish(() => reject(new Error('Sign-in timed out. Please try again.'))),
        SSO_TIMEOUT_MS,
      )

      const finish = (settle: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unlisten?.()
        settle()
      }

      void onOpenUrl((urls) => {
        const callback = urls.find((u) => u.startsWith('lmthing://auth/callback'))
        if (callback) finish(() => resolve(callback))
      })
        .then((off) => {
          if (settled) off()
          else unlisten = off
        })
        .then(() => openUrl(url))
        .catch((err) => finish(() => reject(err)))
    })
}

/** Long enough for a real sign-in including a fresh GitHub login and 2FA. */
const SSO_TIMEOUT_MS = 5 * 60_000
