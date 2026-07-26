/**
 * expo-linking — hand-written (no published jest mock; it is an Expo module).
 *
 * `createURL` returns the app-scheme URL a standalone build would produce. A real Expo Go build
 * returns `exp://<host>:8081/--/<path>` instead, and the seam is written so that either works — the
 * gateway matches whatever string it was handed. This mock picks the standalone shape because it is
 * the one the shipped app uses.
 *
 * `parse` is the real parsing behaviour, implemented over the WHATWG `URL` that Node has: a custom
 * scheme parses, and `searchParams` round-trips. That is exactly why the seam uses `Linking.parse`
 * rather than React Native's own partial `URL` — see `platform/sso.native.ts`.
 */
const SCHEME = 'lmthing'

function createURL(path, options = {}) {
  const scheme = options.scheme ?? SCHEME
  const clean = String(path ?? '').replace(/^\/+/, '')
  const base = `${scheme}://${clean}`
  const query = options.queryParams ? new URLSearchParams(options.queryParams).toString() : ''
  return query ? `${base}?${query}` : base
}

function parse(url) {
  const parsed = new URL(url)
  const queryParams = {}
  for (const [key, value] of parsed.searchParams) queryParams[key] = value
  return {
    scheme: parsed.protocol.replace(/:$/, ''),
    hostname: parsed.hostname || null,
    path: parsed.pathname || null,
    queryParams,
  }
}

async function getInitialURL() {
  return null
}

function addEventListener() {
  return { remove() {} }
}

module.exports = { createURL, parse, getInitialURL, addEventListener }
