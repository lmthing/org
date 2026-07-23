import { test, expect } from '@playwright/test'
import { AUDITED_PROPERTIES } from './audited-properties'

/**
 * B1 EQUIVALENCE gate (Part III / §4 pre-proof).
 *
 * For each eq fixture, compare the plain-HTML reference (`[data-eq-ref]`) against the Tamagui
 * candidate (`[data-eq-cand]`) rendered in the SAME page, and assert their computed styles are
 * equal on the audited property set. This is stronger than the baseline files and independent of
 * the `main` capture: it proves the Tamagui primitive reproduces the box model of the plain element
 * it will replace, right now, in this browser.
 *
 * Two — and only two — documented semantic-equivalence normalizations are applied (everything else
 * is exact string equality):
 *  1. `align-items: normal` (a bare flex container's initial value) is treated as `stretch` — they
 *     are the SAME used behavior for flex; Tamagui's base emits `stretch`, a plain flex div computes
 *     `normal`. (CSS: on a flex container, `align-items: normal` behaves as `stretch`.)
 *  2. The flex-only properties are inert on a non-flex container, so when an element's `display` is
 *     not a flex/grid value they are dropped from the comparison. (A `display:block` Box computes a
 *     stale `flex-direction`/`align-items` from the RN base that has zero rendering effect.)
 */
const EQ_FIXTURE_NAMES = ['eq-row', 'eq-col', 'eq-box'] as const

const FLEX_ONLY = new Set([
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-items',
  'align-self',
  'justify-content',
  'gap',
  'row-gap',
  'column-gap',
])
const isFlexish = (display: string) => /(^|-)(flex|grid)$/.test(display)

function normalize(styles: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...styles }
  if (out['align-items'] === 'normal') out['align-items'] = 'stretch'
  if (!isFlexish(out['display'])) {
    for (const p of FLEX_ONLY) delete out[p]
  }
  return out
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html?theme=' + (test.info().project.name === 'dark' ? 'dark' : 'light'))
  await page.waitForSelector('html[data-harness-ready="1"]')
})

test('harness renders exactly the declared eq fixtures (no drift)', async ({ page }) => {
  const names = await page
    .locator('[data-eq-fx]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-eq-fx')))
  expect(names).toEqual([...EQ_FIXTURE_NAMES])
})

for (const name of EQ_FIXTURE_NAMES) {
  test(`primitive equivalence (ref ≡ candidate): ${name}`, async ({ page }) => {
    const [ref, cand] = await page.evaluate(
      ({ name, props }) => {
        const stage = document.querySelector(`[data-eq-stage="${name}"]`)!
        const read = (sel: string) => {
          const el = stage.querySelector(sel) as HTMLElement
          const cs = getComputedStyle(el)
          const rec: Record<string, string> = {}
          for (const p of props) rec[p] = cs.getPropertyValue(p).trim()
          return rec
        }
        return [read('[data-eq-ref]'), read('[data-eq-cand]')]
      },
      { name, props: AUDITED_PROPERTIES as unknown as string[] },
    )
    expect(normalize(cand)).toEqual(normalize(ref))
  })
}
