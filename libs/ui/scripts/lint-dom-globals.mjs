#!/usr/bin/env node
/**
 * lint-dom-globals.mjs — the gate for the failures `test:native` CANNOT see.
 *
 * The Metro graph gate proves a surface *resolves and transforms* for React Native. It says nothing
 * about `document.title = …` running on a device, because that is a runtime reference, not a
 * dependency. `chat/` was full of them, and every one would have thrown on the first render of the
 * screen that owned it — invisible to the graph gate, invisible to `tsc` (the DOM lib is loaded),
 * and invisible to jsdom tests (where `window` exists).
 *
 * So this is the companion gate: no bare `window` / `document` / `navigator` / `localStorage` /
 * `sessionStorage` / `alert` in a native-bound surface, unless it is on the list below with a
 * reason. Everything else goes through `platform/*`.
 *
 * WHAT IS ALLOWED, AND WHY IT IS A LIST RATHER THAN A BAN:
 *
 * Some DOM use is genuinely web-only *and unreachable on native* — a mouse-drag handle on a panel
 * opened by Alt+I, a `querySelector` autofocus in a dialog whose native counterpart uses `autoFocus`.
 * Inventing a native behaviour for those would be worse than not having them. The rule is that such
 * a site must (a) be optional-chained or `isWeb`-guarded so it cannot throw, and (b) be named here
 * with the reason. That converts "we think this is fine" into a reviewed, shrinking list.
 *
 * `globalThis.window?.…` is accepted anywhere: it is the explicit "may not exist" form, which is the
 * property that matters. A bare `window.…` is not.
 *
 * Usage: node libs/ui/scripts/lint-dom-globals.mjs
 */
import ts from 'typescript'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const uiSrc = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/**
 * Directories whose runtime must work on native. Grows as surfaces port — `studio/` is next.
 *
 * **A surface that `apps/mobile` mounts and this list does not name is not covered.** `team/` and
 * `dashboard/` were ported to native and left off, so the gate that exists for precisely their
 * failure mode never looked at them, and the team surface shipped with a mouse-drag resize handle
 * calling `window.addEventListener` on mount. Adding the directory here is part of porting a
 * surface, not a follow-up.
 */
const NATIVE_BOUND = ['chat', 'elements', 'platform', 'team', 'dashboard', 'view']

/** The globals that do not exist on React Native. */
const FORBIDDEN = new Set(['document', 'window', 'navigator', 'localStorage', 'sessionStorage', 'alert'])

/**
 * Files allowed to reference a DOM global, with the reason. Each is guarded so it cannot throw.
 * Keyed by path relative to `src/`.
 */
const ALLOWED = {
  // Feature-detected: React Native defines `navigator` (without `mediaDevices`), so the existing
  // capability check already disables the mic button rather than throwing. Recording on a device
  // needs expo-av and is its own piece of work.
  'chat/app/Composer.tsx': 'navigator.mediaDevices feature-detect — degrades to a disabled mic',
}

/**
 * SHARED source only — the files that must run on both targets.
 *
 * A `.native.*` or `.web.*` file is one half of a seam and is expected to speak its own platform's
 * vocabulary; so is an `index.tsx` that has an `index.native.tsx` beside it, which is the web half
 * of a fork even though its name does not say so. Flagging those would be flagging the pattern
 * itself.
 */
function hasNativeSibling(filePath) {
  const ext = filePath.endsWith('.tsx') ? '.tsx' : '.ts'
  const base = filePath.slice(0, -ext.length)
  return existsSync(`${base}.native.tsx`) || existsSync(`${base}.native.ts`)
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
    else if (
      /\.tsx?$/.test(name) &&
      !/\.test\.tsx?$/.test(name) &&
      !/\.(web|native)\.tsx?$/.test(name) &&
      !hasNativeSibling(p)
    ) {
      out.push(p)
    }
  }
  return out
}

/**
 * Bare references to a forbidden global — an identifier that is not a property access target, not a
 * declaration name, and not reached through `globalThis?.`.
 */
function violations(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const found = []

  const visit = (node) => {
    if (ts.isIdentifier(node) && FORBIDDEN.has(node.text)) {
      const parent = node.parent
      // `x.window`, `{ document: … }`, `{ window }` in a type, `case document:` — a NAME, not a read.
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isEnumMember(parent) && parent.name === node)
      const isDeclaration =
        (ts.isVariableDeclaration(parent) ||
          ts.isParameter(parent) ||
          ts.isBindingElement(parent) ||
          ts.isFunctionDeclaration(parent) ||
          ts.isPropertyDeclaration(parent)) &&
        parent.name === node
      const isImported = ts.isImportSpecifier(parent) || ts.isImportClause(parent)
      // `globalThis.window?.x` / `globalThis.window` — the explicit "may not exist" form.
      const viaGlobalThis =
        ts.isPropertyAccessExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        parent.expression.text === 'globalThis'
      // A type position (`React.useRef<HTMLDivElement>`) is erased and cannot throw.
      const isTypeRef = ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)
      // `typeof window === 'undefined'` is a guard, not a use.
      const isTypeofGuard = ts.isTypeOfExpression(parent)

      if (!isPropertyName && !isDeclaration && !isImported && !viaGlobalThis && !isTypeRef && !isTypeofGuard) {
        found.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          name: node.text,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

const files = NATIVE_BOUND.flatMap((d) => walk(join(uiSrc, d)))
const failures = []
const usedAllowances = new Set()

for (const file of files) {
  const rel = relative(uiSrc, file)
  const hits = violations(readFileSync(file, 'utf8'), file)
  if (!hits.length) continue
  if (ALLOWED[rel]) {
    usedAllowances.add(rel)
    continue
  }
  for (const hit of hits) failures.push(`${rel}:${hit.line}  ${hit.name}`)
}

for (const rel of Object.keys(ALLOWED)) {
  if (!usedAllowances.has(rel)) {
    failures.push(`STALE ALLOWANCE  ${rel} — listed as allowed but references no DOM global; remove it.`)
  }
}

if (failures.length) {
  console.error(`\n${failures.length} DOM global(s) in native-bound source:\n`)
  for (const f of failures) console.error(`  ${f}`)
  console.error(
    '\nReact Native has no `window`/`document`/`navigator`. These do not fail `test:native` — the\n' +
      'graph gate proves a module RESOLVES, not that it runs — so they would throw on the first\n' +
      'render on a device. Use a `platform/*` seam. If the site is genuinely web-only AND\n' +
      'unreachable on native, guard it (`globalThis.window?.…` or `isWeb`) and add it to ALLOWED\n' +
      'with the reason.\n',
  )
  process.exit(1)
}

console.log(
  `lint-dom-globals: clean (${files.length} files in ${NATIVE_BOUND.join(', ')}, ` +
    `${Object.keys(ALLOWED).length} reviewed allowances)`,
)
