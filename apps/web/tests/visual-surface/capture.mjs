#!/usr/bin/env node
/**
 * capture.mjs — the P0 real-surface computed-style gate.
 *
 * Serves the built harness, walks every fixture stage in light AND dark, records
 * `getComputedStyle` for the audited property set on every element, and either COMPARES against
 * the committed baseline (default) or REWRITES it (`--update`).
 *
 * Why this exists: the two changes still ahead — the animation driver and the Tailwind deletion —
 * alter output app-wide and cannot be reviewed by reading a diff. They can be reviewed as a
 * computed-style delta over the components the app actually ships, which is what this captures.
 * (`tests/visual/` cannot do that job: its fixtures render local PASSTHROUGH copies of the
 * pre-Tamagui primitives so its pre-swap baselines stay byte-valid.)
 *
 * Usage:
 *   node tests/visual-surface/capture.mjs            # compare, exit 1 on any delta
 *   node tests/visual-surface/capture.mjs --update   # re-capture (a deliberate, reviewed act)
 *
 * See docs/tamagui-idiomatic-migration.md §2 (P0).
 */
// `playwright` is not a direct dependency of any workspace package (the visual harness at
// tests/visual gets it via @playwright/test), so resolve the pnpm-store copy the way the b0-probe
// scripts do. Override with PW_PLAYWRIGHT if the version pin moves.
const PLAYWRIGHT =
  process.env.PW_PLAYWRIGHT ||
  new URL('../../../../node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs', import.meta.url).href
const { chromium } = await import(PLAYWRIGHT)
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, 'dist')
const BASELINE = join(HERE, '__baseline__')
const UPDATE = process.argv.includes('--update')

// Chromium is the pre-installed browser — do NOT run `playwright install`.
const EXECUTABLE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

/** The audited property set. Kept in step with `tests/visual/audited-properties.ts`. */
const PROPS = [
  'display', 'position', 'box-sizing', 'width', 'height',
  'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'align-items', 'align-self', 'align-content', 'justify-content', 'gap',
  'grid-template-columns',
  'color', 'background-color', 'opacity', 'box-shadow', 'outline-width', 'outline-style', 'outline-color',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'text-decoration-line', 'text-overflow',
  'white-space', 'word-wrap', 'overflow-x', 'overflow-y', 'overflow-wrap',
  'cursor', 'pointer-events', 'user-select', 'z-index',
  // The animation family is IN the audited set on purpose: it is what the driver changes, and the
  // point of this baseline is to make that change reviewable.
  'transition-property', 'transition-duration', 'transition-timing-function',
  'animation-name', 'animation-duration', 'animation-iteration-count',
]

if (!existsSync(DIST)) {
  console.error('[visual-surface] no build — run: pnpm test:surface:build')
  process.exit(1)
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.otf': 'font/otf', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0])
  if (p === '/') p = '/index.html'
  const f = join(DIST, p)
  if (!existsSync(f)) { res.statusCode = 404; return res.end('not found') }
  res.setHeader('Content-Type', MIME[extname(f)] || 'application/octet-stream')
  res.end(readFileSync(f))
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

const browser = await chromium.launch({ executablePath: EXECUTABLE })
/** Walk every stage on the page and return { [fixture]: { [path]: { prop: value } } }. */
async function capture(theme) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:${port}/?theme=${theme}`)
  await page.waitForFunction('window.__surfaceReady === true')
  await page.evaluate(() => document.fonts.ready)
  // Freeze every running animation at t=0. Without this the `lm-fade-in`/`lm-pulse` fixtures report
  // whatever `opacity` the animation happened to be at when the walk ran, and the gate flaps. The
  // animation PROPERTIES (`animation-name`/`duration`/`iteration-count`) are unaffected — which is
  // what we actually want to pin, since they are what the driver replaces.
  await page.evaluate(() => {
    for (const a of document.getAnimations()) { a.currentTime = 0; a.pause() }
  })
  const out = await page.evaluate((props) => {
    const result = {}
    for (const stage of Array.from(document.querySelectorAll('[data-fx-stage]'))) {
      const styles = {}
      const walk = (el, path) => {
        const cs = getComputedStyle(el)
        const rec = {}
        for (const p of props) rec[p] = cs.getPropertyValue(p).trim()
        styles[path] = rec
        Array.from(el.children).forEach((c, i) => walk(c, `${path}/${c.tagName.toLowerCase()}[${i}]`))
      }
      // Skip the stage wrapper itself — it is harness scaffolding, not a shipped element.
      Array.from(stage.children).forEach((c, i) => walk(c, `${c.tagName.toLowerCase()}[${i}]`))
      result[stage.getAttribute('data-fx-stage')] = styles
    }
    return result
  }, PROPS)
  await page.close()
  return out
}

const captured = { light: await capture('light'), dark: await capture('dark') }
await browser.close()
server.close()

mkdirSync(BASELINE, { recursive: true })

if (UPDATE) {
  let n = 0
  for (const [theme, fixtures] of Object.entries(captured)) {
    for (const [fx, styles] of Object.entries(fixtures)) {
      writeFileSync(join(BASELINE, `${fx}-${theme}.json`), JSON.stringify(styles, null, 2) + '\n')
      n++
    }
  }
  console.log(`[visual-surface] wrote ${n} baseline file(s) to __baseline__/`)
  process.exit(0)
}

const existing = new Set(readdirSync(BASELINE).filter((f) => f.endsWith('.json')))
const diffs = []
let elements = 0
for (const [theme, fixtures] of Object.entries(captured)) {
  for (const [fx, styles] of Object.entries(fixtures)) {
    const file = `${fx}-${theme}.json`
    if (!existing.has(file)) { diffs.push(`${file}: NEW fixture with no baseline`); continue }
    existing.delete(file)
    const base = JSON.parse(readFileSync(join(BASELINE, file), 'utf8'))
    for (const path of new Set([...Object.keys(base), ...Object.keys(styles)])) {
      if (!(path in base)) { diffs.push(`${file} ${path}: element ADDED`); continue }
      if (!(path in styles)) { diffs.push(`${file} ${path}: element REMOVED`); continue }
      elements++
      for (const p of PROPS) {
        if (base[path][p] !== styles[path][p]) {
          diffs.push(`${file} ${path} ${p}: ${JSON.stringify(base[path][p])} → ${JSON.stringify(styles[path][p])}`)
        }
      }
    }
  }
}
for (const orphan of existing) diffs.push(`${orphan}: baseline has no matching fixture`)

if (diffs.length === 0) {
  console.log(`[visual-surface] ✓ ${elements} element(s) match the baseline across light + dark`)
  process.exit(0)
}
console.error(`[visual-surface] ✗ ${diffs.length} computed-style delta(s):\n`)
for (const d of diffs.slice(0, 120)) console.error('  ' + d)
if (diffs.length > 120) console.error(`  … and ${diffs.length - 120} more`)
console.error('\nIf the change is intended, re-capture with `pnpm test:surface:update` and review the baseline diff.')
process.exit(1)
