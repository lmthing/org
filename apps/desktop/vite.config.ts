import { createViteConfig } from '@lmthing/utils/vite'

/**
 * The desktop renderer is a browser, so this is an ordinary web build of the same shared surfaces
 * `apps/web` renders — but it is not served by a web server, and two of the factory's defaults are
 * wrong because of that.
 *
 * `base: './'` — Tauri serves the bundle over a custom protocol (`tauri://localhost` on
 * macOS/Linux, `http://tauri.localhost` on Windows). Vite's default absolute `/assets/…` URLs do
 * not resolve there, and the failure is a blank window with no console error worth reading.
 *
 * `build.target` — the renderer is the OS webview, NOT Chrome: WKWebView on macOS, WebKitGTK on
 * Linux, WebView2 (Chromium) only on Windows. The factory pins no target, so the default assumes a
 * browser baseline the first two do not meet. These three are the declared floor — macOS 13+,
 * Ubuntu 22.04+/WebKitGTK 2.36+, Windows 10 1809+ with Evergreen WebView2.
 *
 * `tailwind: false` matches `apps/web`: the shared surfaces carry no Tailwind directives.
 *
 * `router: false` because this app has no router — its panes are a window's state, exactly as they
 * are on the phone, since a desktop window has no browser history to be the source of truth.
 */
export default createViteConfig(
  __dirname,
  {
    base: './',
    build: { target: ['es2022', 'safari16', 'chrome110'] },
  },
  { tailwind: false, router: false },
)
