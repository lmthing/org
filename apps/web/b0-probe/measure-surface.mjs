import { chromium } from '/home/user/org/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const DIST = join(process.cwd(), 'dist-surface')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.otf': 'font/otf' }
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0])
  if (p === '/') p = '/surface.html'
  const f = join(DIST, p)
  if (!existsSync(f)) { res.statusCode = 404; return res.end('nf') }
  res.setHeader('Content-Type', MIME[extname(f)] || 'application/octet-stream')
  res.end(readFileSync(f))
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

const PROPS = [
  'display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'min-height',
  'max-width', 'max-height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-bottom-width', 'border-top-left-radius', 'border-bottom-right-radius',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'align-items', 'align-self', 'justify-content', 'gap',
  'color', 'background-color', 'border-top-color', 'opacity',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform',
  'overflow-x', 'overflow-y',
]

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto(`http://localhost:${port}/surface.html`)
await page.waitForFunction('window.__surfaceReady === true')
await page.evaluate(() => document.fonts.ready)

const { refStyles, candStyles } = await page.evaluate((props) => {
  const collect = (rootEl) => {
    const out = {}
    const walk = (el, path) => {
      const cs = getComputedStyle(el)
      const rec = {}
      for (const p of props) rec[p] = cs.getPropertyValue(p).trim()
      out[path] = rec
      Array.from(el.children).forEach((c, i) => walk(c, `${path}/${c.tagName.toLowerCase()}[${i}]`))
    }
    walk(rootEl, 'root')
    return out
  }
  const refRoot = document.querySelector('[data-surface="ref"]').firstElementChild
  const candRoot = document.querySelector('[data-surface="cand"]').firstElementChild
  return { refStyles: collect(refRoot), candStyles: collect(candRoot) }
}, PROPS)

// align-items: 'normal' (bare flex initial) === 'stretch' (Tamagui base) — same used behavior.
const norm = (r) => { const o = { ...r }; if (o['align-items'] === 'normal') o['align-items'] = 'stretch'; return o }

const refKeys = Object.keys(refStyles), candKeys = Object.keys(candStyles)
let failures = 0
if (refKeys.length !== candKeys.length) {
  console.log(`✘ structure differs: ref ${refKeys.length} nodes, cand ${candKeys.length} nodes`)
  console.log('  ref paths:', refKeys.join(' '))
  console.log('  cand paths:', candKeys.join(' '))
  failures++
}
for (const path of refKeys) {
  if (!candStyles[path]) { console.log(`✘ ${path}: missing in candidate`); failures++; continue }
  const r = norm(refStyles[path]), c = norm(candStyles[path])
  const diffs = PROPS.filter((p) => r[p] !== c[p])
  if (diffs.length) {
    failures++
    console.log(`✘ ${path}:`)
    for (const p of diffs) console.log(`    ${p}: ref=${r[p]}  cand=${c[p]}`)
  }
}
await browser.close()
server.close()
console.log(failures ? `\n${failures} node(s) FAILED` : `\n✓ ALL ${refKeys.length} NODES MATCH (EmptyState ref ≡ migrated candidate)`)
process.exit(failures ? 1 : 0)
