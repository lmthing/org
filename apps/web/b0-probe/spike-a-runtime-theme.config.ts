import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Pinned pre-installed Chromium (do NOT run `playwright install`). Overridable via PW_CHROMIUM.
const executablePath =
  process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

/**
 * SPIKE A1 probe config. No webServer/bundle needed — the spec uses `page.setContent`, so it is
 * a self-contained, fast proof of the CSS-var indirection mechanism. Run:
 *   node node_modules/.bin/playwright test -c apps/web/b0-probe/spike-a-runtime-theme.config.ts
 */
export default defineConfig({
  testDir: __dirname,
  testMatch: 'spike-a-runtime-theme.spec.ts',
  reporter: [['list']],
  timeout: 30_000,
  use: { launchOptions: { executablePath } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
