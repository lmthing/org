import { chromium } from '/home/user/org/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
const DIST = join(process.cwd(), 'dist-surface')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0])
  if (p === '/') p = '/pressable-variants.html'
  const f = join(DIST, p)
  if (!existsSync(f)) { res.statusCode = 404; return res.end('nf') }
  res.setHeader('Content-Type', MIME[extname(f)] || 'text/plain'); res.end(readFileSync(f))
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } })
await pg.goto(`http://localhost:${port}/pressable-variants.html`)
await pg.waitForFunction('window.__pressableReady===true')
const PROPS = [
  'display', 'box-sizing', 'white-space', 'overflow-wrap',
  'flex-direction', 'flex-shrink', 'flex-grow', 'align-items', 'justify-content', 'gap',
  'width', 'height', 'min-width', 'min-height',
  'margin-top', 'margin-left', 'padding-top', 'padding-left',
  'border-top-width', 'border-top-style', 'background-color',
  'font-family', 'font-size', 'font-weight', 'line-height', 'color',
  'text-align', 'text-transform', 'cursor', 'appearance', '-webkit-appearance',
]
const result = await pg.evaluate((PROPS) => {
  const read = (el) => { const cs = getComputedStyle(el); const o = {}; for (const p of PROPS) o[p] = cs.getPropertyValue(p).trim(); return o }
  const out = {}
  for (const caseEl of document.querySelectorAll('[data-case]')) {
    const label = caseEl.getAttribute('data-case')
    const refEl = caseEl.querySelector('[data-role="ref"]').firstElementChild
    const candEl = caseEl.querySelector('[data-role="cand"]').firstElementChild
    const r = read(refEl), c = read(candEl)
    const diffs = PROPS.filter((p) => r[p] !== c[p]).map((p) => `${p}: ${r[p]} vs ${c[p]}`)
    if (refEl.tagName !== candEl.tagName) diffs.unshift(`tag: ${refEl.tagName} vs ${candEl.tagName}`)
    out[label] = diffs
  }
  return out
}, PROPS)
let fail = 0
for (const [label, diffs] of Object.entries(result)) { if (diffs.length) { fail++; console.log(`✗ ${label}:`, diffs) } else console.log(`✓ ${label}`) }
console.log(fail ? `\n${fail} MISMATCH` : '\nALL MATCH')
await b.close(); server.close(); process.exit(fail ? 1 : 0)
