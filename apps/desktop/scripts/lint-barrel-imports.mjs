#!/usr/bin/env node
/**
 * lint-barrel-imports.mjs — the app may not reach into the shared package's internals.
 *
 * The invariant is one source, two outputs: every screen lives in `@lmthing/ui` and both targets
 * render it. This shell's job is the provider, the entry, and the window chrome — that is
 * the entire divergence budget.
 *
 * A deep import like `@lmthing/ui/src/chat/app/AppShell` is how that budget gets spent without
 * anyone deciding to: it lets this app compose its own screen out of another surface's internals,
 * which is a fork of the product wearing an import path. Public subpaths (`@lmthing/ui/elements/*`,
 * `/chat`, `/theme/*`) are fine — they are the same entry points the web app uses.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BAD = /@lmthing\/(ui|css|state)\/src\//

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const failures = []
for (const file of walk(root)) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (BAD.test(line)) failures.push(`${relative(root, file)}:${i + 1}  ${line.trim()}`)
    })
}

if (failures.length) {
  console.error(`\n${failures.length} deep import(s) into a shared package's internals:\n`)
  for (const f of failures) console.error(`  ${f}`)
  console.error('\nImport a PUBLIC subpath instead. If the thing you need is not exported, it belongs')
  console.error('in @lmthing/ui as a shared screen, not composed out of internals here.\n')
  process.exit(1)
}

console.log('lint-barrel-imports: clean')
