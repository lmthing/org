#!/usr/bin/env node
/**
 * shoot.mjs — pictures of the real team and chat surfaces, at a phone and a
 * desktop viewport, in both themes.
 *
 * This is a LOOKING gate, not an asserting one. Every other gate in this repo is
 * blind to layout: `renderToStaticMarkup` + jsdom cannot see a container that
 * collapses to zero height, the a11y tree happily lists content that is painted
 * nowhere, and the metro graph gate proves modules RESOLVE, not that they mount.
 * A surface can be completely blank with the whole suite green. So: take the
 * picture and look at it.
 *
 * It does assert the one thing worth failing a build over — that the surface
 * actually painted something — by rejecting a shot that is a single flat colour.
 *
 *   node tests/surface-shots/shoot.mjs                 # all fixtures, both viewports, both themes
 *   node tests/surface-shots/shoot.mjs --fx team       # one fixture
 *   node tests/surface-shots/shoot.mjs --only phone    # one viewport
 *   node tests/surface-shots/shoot.mjs --out DIR       # default: __shots__/
 */
const PLAYWRIGHT =
  process.env.PW_PLAYWRIGHT ||
  new URL('../../../../node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs', import.meta.url).href
const { chromium } = await import(PLAYWRIGHT)
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, 'dist')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const OUT = flag('out', join(HERE, '__shots__'))
const ONLY_FX = flag('fx', null)
const ONLY_VP = flag('only', null)

// The pre-installed Chromium. `playwright install` is not run in this repo; the
// pinned build the package wants may not be the one on disk, so point at what is.
const CANDIDATES = [
  process.env.PW_CHROMIUM,
  `${process.env.HOME}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean)
const EXECUTABLE = CANDIDATES.find((p) => existsSync(p))
if (!EXECUTABLE) {
  console.error(`[shots] no chromium found. Tried:\n  ${CANDIDATES.join('\n  ')}\nSet PW_CHROMIUM.`)
  process.exit(1)
}

if (!existsSync(DIST)) {
  console.error('[shots] no build — run: pnpm shots:build')
  process.exit(1)
}

const FIXTURES = ['team', 'team-long', 'team-thread', 'team-dm', 'team-paging', 'team-attachments', 'chat', 'chat-empty', 'chat-devpanel']
const VIEWPORTS = {
  // iPhone 14/15 logical size — the one the team surface has to survive.
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false },
}
const THEMES = ['light', 'dark']

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.otf': 'font/otf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' }
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

// Only a FULL run may clear the directory. A filtered run that wiped it would
// leave you comparing one new picture against nothing, which is how you convince
// yourself a surface is fine because you cannot see the one that broke.
if (!ONLY_FX && !ONLY_VP) rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: EXECUTABLE })
const problems = []
const consoleErrors = []

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  if (ONLY_VP && vpName !== ONLY_VP) continue
  for (const fx of FIXTURES) {
    if (ONLY_FX && fx !== ONLY_FX) continue
    for (const theme of THEMES) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: theme })
      // There is no backend behind this harness on purpose — the surfaces are driven by fakes at
      // their own seams. A failed `/api/*` fetch is therefore expected, and reporting it buries
      // the errors that would actually mean something.
      const expectedFailure = (text) => /Failed to load resource/.test(text)
      page.on('console', (m) => {
        if (m.type() === 'error' && !expectedFailure(m.text())) {
          consoleErrors.push(`${fx}/${vpName}/${theme}: ${m.text().slice(0, 200)}`)
        }
      })
      page.on('requestfailed', (r) => {
        if (!/\/api\//.test(r.url())) consoleErrors.push(`${fx}/${vpName}/${theme}: request failed ${r.url()}`)
      })
      page.on('pageerror', (e) => consoleErrors.push(`${fx}/${vpName}/${theme}: PAGEERROR ${String(e).slice(0, 200)}`))
      await page.goto(`http://localhost:${port}/?fx=${fx}&theme=${theme}`)
      try {
        await page.waitForFunction('window.__shotReady === true', { timeout: 15_000 })
      } catch {
        problems.push(`${fx}/${vpName}/${theme}: never became ready`)
      }
      await page.evaluate(() => document.fonts.ready)
      // Settle every animation at its END, not at t=0. `visual-surface/capture.mjs`
      // freezes at 0 because it wants stable computed values — but a transcript
      // that fades in is at opacity 0 there, so the same trick in a PICTURE gate
      // photographs an invisible surface and calls it a contrast bug.
      await page.evaluate(() => {
        for (const a of document.getAnimations()) {
          try { a.finish() } catch { a.cancel() }
        }
      })

      const name = `${fx}-${vpName}-${theme}.png`
      const path = join(OUT, name)
      await page.screenshot({ path })

      // The one hard assertion: did anything paint? A surface whose container
      // collapsed renders as one flat colour, and that is exactly the failure
      // no other gate in this repo can see.
      const ink = await page.evaluate(() => {
        const stage = document.querySelector('[data-fx-stage]')
        if (!stage) return { boxes: 0, height: 0, text: 0 }
        const all = Array.from(stage.querySelectorAll('*'))
        const painted = all.filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 2 && r.height > 2
        })
        const text = all.filter((el) => (el.textContent || '').trim().length > 0 && el.children.length === 0).length
        return { boxes: painted.length, height: stage.getBoundingClientRect().height, text }
      })
      if (ink.height < 50) problems.push(`${fx}/${vpName}/${theme}: stage collapsed (height ${Math.round(ink.height)}px)`)
      else if (ink.boxes < 5) problems.push(`${fx}/${vpName}/${theme}: nothing painted (${ink.boxes} boxes)`)
      else if (ink.text === 0) problems.push(`${fx}/${vpName}/${theme}: no text rendered`)

      // Horizontal overflow on a phone is a real, visible defect — the page
      // rocks sideways and content sits off-screen.
      if (vpName === 'phone') {
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        if (over > 4) problems.push(`${fx}/phone/${theme}: horizontal overflow ${over}px`)
      }

      // These surfaces are fixed-height shells: a transcript scrolls INSIDE the
      // window, the window itself never does. When the page grows past the
      // viewport it means a height constraint stopped being passed down — and
      // the symptom is not "a slightly tall page", it is a transcript that no
      // longer scrolls, running under the composer with its newest messages
      // unreachable. That happened here the moment a `position: relative`
      // wrapper (display:block) was put between the flex column and the Scroll:
      // `flex={1}` on the Scroll silently meant nothing inside a block parent.
      const page_ = await page.evaluate(() => {
        const de = document.documentElement
        const scrollers = Array.from(document.querySelectorAll('*'))
          .filter((el) => getComputedStyle(el).overflowY === 'auto')
          .map((el) => ({
            h: Math.round(el.getBoundingClientRect().height),
            scrolls: el.scrollHeight > el.clientHeight + 1,
          }))
        return { over: de.scrollHeight - de.clientHeight, vh: de.clientHeight, scrollers }
      })
      if (page_.over > 4) problems.push(`${fx}/${vpName}/${theme}: the PAGE scrolls (${page_.over}px past the viewport) — a height constraint is not reaching a scroll region`)
      for (const s of page_.scrollers) {
        if (s.h > page_.vh + 4) problems.push(`${fx}/${vpName}/${theme}: a scroll region is ${s.h}px tall in a ${page_.vh}px viewport — it grew to its content instead of scrolling`)
      }

      // An overflowing transcript must still be scrollable back to its FIRST message. Bottom-
      // anchoring a scroll region with `justify-content: flex-end` silently makes the overflow
      // unreachable in the start direction, and nothing about the bottom of the list looks wrong
      // when that happens — so check the top explicitly rather than trusting the picture.
      if (fx.endsWith('-long')) {
        const reach = await page.evaluate(() => {
          const boxes = Array.from(document.querySelectorAll('*')).filter(
            (el) => el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== 'visible',
          )
          const el = boxes.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
          if (!el) return { scrolled: false, sawFirst: false, overflow: 0 }
          const overflow = el.scrollHeight - el.clientHeight
          el.scrollTop = 0
          const first = Array.from(el.querySelectorAll('*')).find((n) =>
            (n.textContent || '').startsWith('FIRST MESSAGE'),
          )
          if (!first) return { scrolled: true, sawFirst: false, overflow }
          const r = first.getBoundingClientRect()
          const c = el.getBoundingClientRect()
          return { scrolled: true, sawFirst: r.top >= c.top - 2 && r.bottom <= c.bottom + 2, overflow }
        })
        if (!reach.scrolled) problems.push(`${fx}/${vpName}/${theme}: nothing overflows — fixture is not tall enough to test reachability`)
        else if (reach.overflow < 100) problems.push(`${fx}/${vpName}/${theme}: only ${reach.overflow}px of overflow`)
        else if (!reach.sawFirst) problems.push(`${fx}/${vpName}/${theme}: FIRST MESSAGE unreachable at scrollTop 0 — bottom-anchoring broke start-direction overflow`)
        await page.screenshot({ path: join(OUT, `${fx}-${vpName}-${theme}-top.png`) })
        console.log(`    ↳ scrolled to top: first message ${reach.sawFirst ? 'reachable' : 'UNREACHABLE'} (${reach.overflow}px overflow)`)
      }

      console.log(`  ${name}  ${ink.boxes} boxes, ${ink.text} text nodes, ${Math.round(ink.height)}px tall`)
      await page.close()
    }
  }
}

await browser.close()
server.close()

if (consoleErrors.length) {
  console.log(`\n[shots] console errors (${consoleErrors.length}):`)
  for (const e of [...new Set(consoleErrors)].slice(0, 20)) console.log(`  ! ${e}`)
}
console.log(`\n[shots] written to ${OUT}`)
if (problems.length) {
  console.log(`\n[shots] PROBLEMS (${problems.length}):`)
  for (const p of problems) console.log(`  ✗ ${p}`)
  process.exit(1)
}
console.log('[shots] every surface painted.')
