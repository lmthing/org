import { defineConfig, devices } from '@playwright/test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const APP_PORT = Number(process.env.APP_PORT || 4410)
const STUB_PORT = Number(process.env.STUB_PORT || 4411)

/**
 * The installed `@playwright/test` pins a browser build newer than the one on disk, and
 * `playwright install` is deliberately not run here — `tests/visual/playwright.config.ts` carries
 * the same note for the same reason. Point at the newest already-downloaded Chromium instead.
 * Overridable with `PW_CHROMIUM`, which is how CI supplies its own.
 */
const executablePath =
  process.env.PW_CHROMIUM ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`

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
    launchOptions: { executablePath },
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
