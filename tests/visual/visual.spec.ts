import { test, expect } from '@playwright/test'
import { FIXTURE_NAMES } from './fixture-names'

/**
 * Layer 3 — visual regression (§3). A screenshot of each fixture stage is diffed against its
 * committed `main`/passthrough baseline at ≤0.1% pixels (maxDiffPixelRatio 0.001, config-level).
 * The threshold is a rendering-engine noise budget, not a license to drift: L1+L2 are exact.
 * Baselines are written on first run and updated deliberately with --update-snapshots (§8).
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/index.html?theme=' + (test.info().project.name === 'dark' ? 'dark' : 'light'))
  await page.waitForSelector('html[data-harness-ready="1"]')
})

for (const name of FIXTURE_NAMES) {
  test(`visual parity: ${name}`, async ({ page }) => {
    const stage = page.locator(`[data-fx-stage="${name}"]`)
    await expect(stage).toHaveScreenshot(`${name}.png`)
  })
}
