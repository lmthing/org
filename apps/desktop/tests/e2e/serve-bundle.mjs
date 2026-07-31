#!/usr/bin/env node
/**
 * Serves the REAL production bundle from `dist/`.
 *
 * Not a test fixture and not a re-bundle: this is the exact output `pnpm build` produces and the
 * exact output Tauri embeds. Anything that survives here — the Tamagui runtime, the shared
 * surfaces, the boot order in `main.tsx` — is the thing that ships.
 *
 * The one job beyond static files is the SPA fallback, because Tauri's asset protocol resolves
 * unknown paths to `index.html` the same way.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../dist')
const PORT = Number(process.env.APP_PORT || 4410)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  let path = normalize(decodeURIComponent(url.pathname))
  if (path === '/' || path.endsWith('/')) path += 'index.html'
  let file = join(root, path)
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden')
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    // SPA fallback, mirroring Tauri's asset protocol.
    try {
      const body = await readFile(join(root, 'index.html'))
      res.writeHead(200, { 'content-type': types['.html'] })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[serve-bundle] dist on http://127.0.0.1:${PORT}`)
})
