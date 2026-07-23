import { chromium } from '/home/user/org/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const DIST = join(process.cwd(), 'dist')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }

const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0])
  if (p === '/') p = '/index.html'
  const file = join(DIST, p)
  if (!existsSync(file)) {
    res.statusCode = 404
    res.end('nf')
    return
  }
  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage()
await page.goto(`http://localhost:${port}/index.html`)
await page.waitForFunction('window.__probeReady === true')

const props = ['align-items', 'flex-direction', 'justify-content', 'display']
const ids = ['align', 'dir', 'justify', 'display']
const result = {}
for (const id of ids) {
  result[id] = await page.evaluate(
    ({ id, props }) => {
      const el = document.querySelector(`[data-testid="${id}"]`)
      const cs = getComputedStyle(el)
      const out = { className: el.className }
      for (const p of props) out[p] = cs.getPropertyValue(p)
      return out
    },
    { id, props },
  )
}
console.log(JSON.stringify(result, null, 2))
await browser.close()
server.close()
