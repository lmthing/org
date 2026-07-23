import { chromium } from '/home/user/org/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const DIST = join(process.cwd(), 'dist')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0])
  if (p === '/') p = '/index.html'
  const f = join(DIST, p)
  if (!existsSync(f)) { res.statusCode = 404; return res.end('nf') }
  res.setHeader('Content-Type', MIME[extname(f)] || 'application/octet-stream')
  res.end(readFileSync(f))
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

// The box-model properties the migration must preserve.
const PROPS = [
  'display', 'flex-direction', 'flex-grow', 'flex-shrink', 'flex-basis',
  'align-items', 'justify-content', 'gap', 'min-width',
]
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage()
await page.goto(`http://localhost:${port}/index.html`)
await page.waitForFunction('window.__probeReady === true')

const pairs = [['lay-ref-1', 'lay-cand-1'], ['lay-ref-2', 'lay-cand-2']]
let failures = 0
for (const [refId, candId] of pairs) {
  const [ref, cand] = await page.evaluate(
    ({ refId, candId, props }) => {
      const read = (id) => {
        const cs = getComputedStyle(document.querySelector(`[data-testid="${id}"]`))
        const rec = {}
        for (const p of props) rec[p] = cs.getPropertyValue(p).trim()
        return rec
      }
      return [read(refId), read(candId)]
    },
    { refId, candId, props: PROPS },
  )
  const diffs = PROPS.filter((p) => ref[p] !== cand[p])
  if (diffs.length) {
    failures++
    console.log(`✘ ${refId} ≠ ${candId}:`)
    for (const p of diffs) console.log(`    ${p}: ref=${ref[p]}  cand=${cand[p]}`)
  } else {
    console.log(`✓ ${refId} ≡ ${candId} (${PROPS.length} props match)`)
  }
}
await browser.close()
server.close()
console.log(failures ? `\n${failures} pair(s) FAILED` : '\nALL PAIRS MATCH')
process.exit(failures ? 1 : 0)
