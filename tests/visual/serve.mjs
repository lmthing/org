#!/usr/bin/env node
/** Minimal static file server for tests/visual/dist (used by playwright.config webServer). */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, normalize } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, 'dist')
const port = Number(process.env.PORT || 4319)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    let path = normalize(decodeURIComponent(url.pathname))
    if (path === '/' || path.endsWith('/')) path += 'index.html'
    const file = join(root, path)
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden')
      return
    }
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(port, () => console.log(`[visual-harness] serving tests/visual/dist on :${port}`))
