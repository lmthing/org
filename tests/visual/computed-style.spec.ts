import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
import { FIXTURE_NAMES } from './fixture-names'
import { extractFixtureStyles, type FixtureStyles } from './extract-computed-styles'

/**
 * Layer 2 — computed-style contract test (§3). For every fixture, walk the rendered subtree and
 * record getComputedStyle for the audited property set, then compare EXACTLY (string equality)
 * against the committed `main`/passthrough baseline. This is what catches a `display:flex` or
 * `flex-shrink:0` box-model regression the instant the primitives swap to Tamagui.
 *
 * Baselines live in `__computed__/<fixture>-<project>.json`, committed from the passthrough
 * primitives. Regenerate deliberately with UPDATE_VISUAL_BASELINE=1 (a reviewed act, §8).
 */
const BASELINE_DIR = join(__dirname, '__computed__')
const UPDATE = process.env.UPDATE_VISUAL_BASELINE === '1'

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html?theme=' + (test.info().project.name === 'dark' ? 'dark' : 'light'))
  await page.waitForSelector('html[data-harness-ready="1"]')
})

test('harness renders exactly the declared fixtures (no drift)', async ({ page }) => {
  const names = await page.locator('[data-fx]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-fx')),
  )
  expect(names).toEqual([...FIXTURE_NAMES])
})

for (const name of FIXTURE_NAMES) {
  test(`computed-style parity: ${name}`, async ({ page }, testInfo) => {
    const actual = await extractFixtureStyles(page, name)
    const file = join(BASELINE_DIR, `${name}-${testInfo.project.name}.json`)

    if (UPDATE || !existsSync(file)) {
      mkdirSync(BASELINE_DIR, { recursive: true })
      writeFileSync(file, JSON.stringify(actual, null, 2) + '\n')
      test.skip(!UPDATE, `baseline captured for ${name} (${testInfo.project.name})`)
      return
    }

    const baseline = JSON.parse(readFileSync(file, 'utf8')) as FixtureStyles
    // Compare per-element so a mismatch reports the exact element path + property.
    expect(Object.keys(actual).sort()).toEqual(Object.keys(baseline).sort())
    for (const path of Object.keys(baseline)) {
      expect(actual[path], `element ${path}`).toEqual(baseline[path])
    }
  })
}
