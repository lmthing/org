#!/usr/bin/env node
/**
 * lint-relative-transport.mjs — forbid origin-relative `fetch` / `WebSocket` URLs on surfaces that
 * have to run on React Native.
 *
 * `fetch('/api/projects')` is correct on web and *silently wrong* on native. There is no document,
 * no origin, and no base URL to resolve against, so React Native's fetch does not "default to the
 * current host" — it fails. The failure surfaces as a network error inside whatever component owned
 * the call, which reads exactly like a pod that is down.
 *
 * The fix is `platform/api-base`: identity on web, an absolute pod URL on native. This gate is what
 * keeps the next `/api/` from being written inline. It is not a style rule — every entry it catches
 * is a call that cannot work on a device.
 *
 * WHAT COUNTS. Only the *statically known leading text* of the URL argument:
 *
 *   fetch('/api/env')                → FAIL, literal starts with '/'
 *   fetch(`/api/x/${id}`)            → FAIL, first template chunk starts with '/'
 *   fetch(apiUrl('/api/env'))        → ok,   a call expression: the seam decides
 *   fetch(`${baseUrl}/api/x`)        → ok,   first chunk is empty, the base is threaded in
 *   new WebSocket(wsUrl(`/api/ws`))  → ok
 *
 * That makes the rule decidable without type information and precise about the actual defect: the
 * hardcoded leading slash. It says nothing about `/api/` appearing anywhere else — a path fragment
 * appended to a base is fine, and `rpc-client.ts` is built exactly that way.
 *
 * SCOPE. `NATIVE_BOUND` below, not all of `src`. A surface joins the list when it is walked onto the
 * native graph, so the gate always describes what is actually true rather than aspiring. `studio/`
 * is the next one to join.
 *
 * Usage: node libs/ui/scripts/lint-relative-transport.mjs
 */
import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const uiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** Directories (relative to src/) whose transport must work on native. */
const NATIVE_BOUND = ['chat', 'platform']

/**
 * The literal text an expression is statically known to START with, or null when it is decided at
 * runtime (a call, an identifier, a template opening with a substitution).
 */
function staticPrefix(node) {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.head.text
  return null
}

/** `fetch(x)` / `window.fetch(x)` / `new WebSocket(x)` — the URL argument, or null. */
function transportUrlArg(node) {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'WebSocket') {
    return node.arguments?.[0] ?? null
  }
  if (!ts.isCallExpression(node)) return null
  const callee = node.expression
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : null
  return name === 'fetch' ? (node.arguments[0] ?? null) : null
}

function violations(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []
  const visit = (node) => {
    const arg = transportUrlArg(node)
    const prefix = arg ? staticPrefix(arg) : null
    if (prefix !== null && prefix.startsWith('/')) {
      found.push({
        line: sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1,
        text: prefix.slice(0, 40),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const files = NATIVE_BOUND.flatMap((d) => walk(join(uiSrc, d)))
const failures = []

for (const file of files) {
  for (const v of violations(readFileSync(file, 'utf8'), file)) {
    failures.push({ file: relative(uiSrc, file), ...v })
  }
}

if (failures.length) {
  console.error(`\n${failures.length} origin-relative transport url(s):\n`)
  for (const f of failures) console.error(`  ${f.file}:${f.line}  "${f.text}…"`)
  console.error(
    '\nReact Native has no origin, so a leading `/` cannot resolve — the call fails on a device\n' +
      'while working on web. Wrap the path: `fetch(apiUrl(\'/api/…\'))`, `new WebSocket(wsUrl(…))`,\n' +
      'or use the `apiGet`/`apiPost`/`apiPut`/`apiDelete` helpers in `chat/app/api.ts`.\n',
  )
  process.exit(1)
}

console.log(`lint-relative-transport: clean (${files.length} files in ${NATIVE_BOUND.join(', ')})`)
