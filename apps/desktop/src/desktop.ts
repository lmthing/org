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
 * The injected bridge, or null.
 *
 * This deliberately does NOT throw, and the reason is a bug this cost: it used to, and it was
 * called from `boot()` BEFORE `createRoot().render()`. So on a page with no bridge the exception
 * escaped, React never mounted, and the window was **blank with nothing in it** — the loudest
 * failure in the code producing the quietest one a person could see. "Fail loudly" has to mean
 * loudly *to the user*, not loudly into a console nobody has open in a packaged app.
 *
 * A missing bridge still means the Rust initialization script did not run, which is a broken build
 * rather than a runtime condition to paper over. So it is reported and the app still mounts, where
 * the normal auth path can render something a person can act on.
 */
export function optionalBridge(): DesktopBridge | null {
  const bridge = getDesktopBridge()
  if (!bridge) {
    console.error(
      '[desktop] No __LMTHING_DESKTOP__ bridge on the page. The Tauri initialization script did ' +
        'not run — this build is broken, not misconfigured. Sign-in and every pod call will be ' +
        'addressed to the wrong origin.',
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
  const bridge = optionalBridge()
  // No bridge means no shell to open a system browser with, so there is nothing to install. The
  // app still mounts; `startLogin` falls back to its web branch, which is the correct behaviour for
  // the only context that can legitimately reach here — the E2E harness driving this bundle in
  // Chromium.
  if (!bridge) return
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

/**
 * Subscribe to View → Browser (⌘/Ctrl-B) from the native menu.
 *
 * Rust emits the event rather than acting on it, because which pane is open is React state and the
 * shell has no business knowing it. This is the seam between the two.
 *
 * Returns a cleanup, and the `void` unlisten dance is not ceremony: `listen` resolves AFTER the
 * effect may already have been torn down, so a naive version leaks a listener per mount and the
 * menu item eventually toggles the pane several times per click.
 */
export function onMenuToggleBrowser(fn: () => void): () => void {
  let unlisten: (() => void) | undefined
  let cancelled = false
  void import('@tauri-apps/api/event')
    .then(({ listen }) => listen('lmthing://toggle-browser', () => fn()))
    .then((off) => {
      if (cancelled) off()
      else unlisten = off
    })
    .catch(() => {
      // No Tauri runtime — the app is being driven in a plain browser by the E2E. The menu does
      // not exist there either, so there is nothing to report.
    })
  return () => {
    cancelled = true
    unlisten?.()
  }
}
