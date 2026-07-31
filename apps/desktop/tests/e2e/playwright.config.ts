import { defineConfig, devices } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const APP_PORT = Number(process.env.APP_PORT || 4410)
const STUB_PORT = Number(process.env.STUB_PORT || 4411)

/**
 * Which Chromium to run the app in.
 *
 * Locally the installed `@playwright/test` pins a browser build newer than the one on disk, and
 * `playwright install` is deliberately not run here — `tests/visual/playwright.config.ts` carries
 * the same note for the same reason — so an already-downloaded one is used.
 *
 * In CI the workflow DOES install the pinned build, and Playwright's own default is correct. This
 * must therefore resolve to nothing rather than to a guess: pointing `executablePath` at a version
 * that is not there fails every test at launch with "executable doesn't exist", which reads as a
 * broken suite rather than a wrong path. That is exactly what it did.
 */
function localChromium(): string | undefined {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM
  const cache = `${process.env.HOME}/.cache/ms-playwright`
  if (!existsSync(cache)) return undefined
  const versions = readdirSync(cache)
    .filter((d) => d.startsWith('chromium-'))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const v of versions) {
    for (const layout of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = `${cache}/${v}/${layout}`
      if (existsSync(p)) return p
    }
  }
  return undefined
}

const executablePath = localChromium()

/**
 * End-to-end gate for the desktop shell.
 *
 * The bundle and the API live on DIFFERENT ports on purpose. A Tauri renderer's origin
 * (`tauri://localhost`) is not the pod, so every request the shell makes has to be rewritten from
 * the injected bridge; splitting the ports turns a regression in that seam from a subtly wrong
 * request into a hard 404 the test can see.
 *
 * Chromium is used because a Tauri webview is not scriptable by Playwright and Chromium is the
 * closest thing available in CI. That is a real limitation and it is stated in the spec: these
 * tests prove the APP, and `cargo test` plus a real launch prove the shell.
 */
export default defineConfig({
  testDir: here,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  timeout: 45_000,
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    viewport: { width: 1280, height: 860 },
    ...devices['Desktop Chrome'],
    // Only when one was actually found — an undefined `executablePath` lets Playwright use its own.
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: 'desktop' }],
  webServer: [
    {
      command: `node ${here}/serve-bundle.mjs`,
      url: `http://127.0.0.1:${APP_PORT}/index.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      env: { APP_PORT: String(APP_PORT) },
    },
    {
      command: `node ${here}/stub-backend.mjs`,
      url: `http://127.0.0.1:${STUB_PORT}/__calls`,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      env: { STUB_PORT: String(STUB_PORT) },
    },
  ],
})
