import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// The installed @playwright/test may pin a browser build newer than the one pre-installed at
// /opt/pw-browsers (do NOT run `playwright install`). Point executablePath at the pre-installed
// full Chromium so we use it verbatim. Overridable via PW_CHROMIUM.
const executablePath =
  process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

/**
 * Playwright config for the L2 (computed-style) + L3 (screenshot) parity gate (§3.2).
 *
 * Serves the esbuild-bundled harness (tests/visual/dist) with a pinned viewport,
 * deviceScaleFactor 1 and animations disabled. One project per theme, since the token set is
 * theme-first. Chromium is pinned to the pre-installed browser at /opt/pw-browsers — do NOT run
 * `playwright install`.
 */
const PORT = Number(process.env.PORT || 4319)

export default defineConfig({
  testDir: __dirname,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{projectName}{ext}',
  timeout: 30_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled' } },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
  ],
  webServer: {
    command: `node ${__dirname}/serve.mjs`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
    env: { PORT: String(PORT) },
  },
})
