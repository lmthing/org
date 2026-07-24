import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * SPIKE A1 — runtime / per-space theming through the Tamagui-token → CSS-var indirection.
 * The #1 risk of the idiomatic migration (docs/tamagui-idiomatic-migration.md §1, SPIKE A).
 *
 * CLAIM UNDER TEST: an idiomatic Tamagui web style prop `backgroundColor="$background"` emits
 * atomic CSS of the form `background: var(--color-background)`, given a color TOKEN whose value
 * is `var(--background)` (the generated `webColorTokens`). theme.css already declares
 *   :root            { --background: <light hex> }
 *   [data-theme=dark]{ --background: <dark hex>  }
 *   @theme inline    { --color-background: var(--background) }
 * so that atomic style must resolve to:
 *   1. the LIGHT hex under the default theme,
 *   2. the DARK hex once `data-theme="dark"` is set (no rebuild),
 *   3. an ARBITRARY per-space value once the space injects a runtime `--background` override
 *      (exactly what libs/ui theme.ts `applyThemeTokens` does).
 *
 * If all three hold, idiomatic `$token` props AND runtime space themes coexist — SPIKE A passes
 * with option A1. This probe reproduces the mechanism against the REAL theme.css var blocks
 * (extracted below), so it measures actual browser cascade resolution, not a mock.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const themeCss = readFileSync(
  join(__dirname, '../../../libs/css/src/theme.css'),
  'utf8',
)

/** Pull a top-level `selector { … }` block body out of theme.css (drops the `@import` lines). */
function block(re: RegExp): string {
  const m = themeCss.match(re)
  if (!m) throw new Error(`theme.css: block not found for ${re}`)
  return m[1]
}

// The three plain-CSS blocks the browser needs (Tailwind's `@import` is irrelevant to var
// resolution). `@theme inline` carries the `--color-*: var(--*)` indirection Tamagui mirrors.
const rootVars = block(/:root\s*\{([^}]*)\}/)
const darkVars = block(/\[data-theme="dark"\]\s*\{([^}]*)\}/)
const inlineVars = block(/@theme inline\s*\{([^}]*)\}/)

// The atomic rule a var-backed Tamagui token emits for `backgroundColor="$background"`.
// (Tamagui's real class name is hashed; the DECLARATION is what matters and is reproduced 1:1.)
const pageCss = `
  :root { ${rootVars} }
  [data-theme="dark"] { ${darkVars} }
  :root { ${inlineVars} }
  .tamagui-bg-background { background: var(--color-background); }
  .tamagui-color-foreground { color: var(--color-foreground); }
`

const html = `<!doctype html><html><head><style>${pageCss}</style></head>
  <body>
    <div id="box" class="tamagui-bg-background tamagui-color-foreground">idiomatic $background</div>
  </body></html>`

const rgb = (hex: string) => {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

// Ground-truth hexes from tokens.json (also asserted === theme.css by the L1 parity test).
const LIGHT_BG = '#fffdfb'
const DARK_BG = '#1a1512'
const LIGHT_FG = '#1c1917'
const SPACE_BG = '#0b3d2e' // an arbitrary space-supplied colour, unlike either built-in theme

test('A1: $background resolves to the LIGHT hex by default', async ({ page }) => {
  await page.setContent(html)
  const bg = await page.$eval('#box', (el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe(rgb(LIGHT_BG))
})

test('A1: flipping data-theme="dark" re-resolves $background to the DARK hex (no rebuild)', async ({
  page,
}) => {
  await page.setContent(html)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  const bg = await page.$eval('#box', (el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe(rgb(DARK_BG))
})

test('A1: a runtime space override of --background flows through the token indirection', async ({
  page,
}) => {
  await page.setContent(html)
  // Exactly what libs/ui theme.ts applyThemeTokens does for a space theme.json.
  await page.evaluate((v) => {
    document.documentElement.style.setProperty('--background', v)
  }, SPACE_BG)
  const bg = await page.$eval('#box', (el) => getComputedStyle(el).backgroundColor)
  expect(bg).toBe(rgb(SPACE_BG))
})

test('A1: light + dark foreground both resolve through the same $foreground token', async ({
  page,
}) => {
  await page.setContent(html)
  const light = await page.$eval('#box', (el) => getComputedStyle(el).color)
  expect(light).toBe(rgb(LIGHT_FG))
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  const dark = await page.$eval('#box', (el) => getComputedStyle(el).color)
  expect(dark).toBe(rgb('#ece8e3'))
})
