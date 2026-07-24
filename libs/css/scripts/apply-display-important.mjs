#!/usr/bin/env node
/**
 * apply-display-important.mjs — Part III / B3.3 of the Tamagui migration.
 *
 * The web `Box` (and Text/Pressable) primitives are Tamagui components whose base sets an explicit,
 * `:root`-boosted default `display` (block / inline). That boost beats an UNLAYERED author rule of
 * equal specificity — including the design system's OWN component/element classes that set `display`
 * via `@apply flex/grid/…`. So a `<Prim.Box className="computer-dashboard">` (whose `display:grid`
 * comes from a BEM `@apply`) would render `block`.
 *
 * Fix: make those `@apply` DISPLAY utilities `!important` (Tailwind v4's trailing `!` modifier) so the
 * author rule wins over the boosted default. `!important` beats a normal boosted declaration — verified
 * in `apps/web/b0-probe/box-variants.mjs` (`bem-bang`). Only DISPLAY utilities are touched (margins and
 * everything else are unaffected by the base, so they need no change).
 *
 * Idempotent (skips tokens already `!`). Only rewrites `@apply` directives in the passed CSS files.
 * Run: node libs/css/scripts/apply-display-important.mjs [--check] libs/css/src/{components,elements}/**\/*.css
 */
import { readFileSync, writeFileSync } from 'node:fs'

// Exact Tailwind display-utility tokens (NOT flex-1/flex-col/grid-cols-* etc. — those aren't display).
const DISPLAY = new Set([
  'block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid',
  'contents', 'hidden', 'flow-root', 'table', 'inline-table', 'list-item',
  'table-caption', 'table-cell', 'table-row', 'table-row-group', 'table-header-group',
  'table-footer-group', 'table-column', 'table-column-group',
])

/** bare utility after stripping variant prefixes (hover:, md:, group-hover:, dark:, …). */
const bare = (tok) => tok.slice(tok.lastIndexOf(':') + 1)

function transform(text) {
  let count = 0
  // Rewrite each `@apply <utilities>;` directive.
  const out = text.replace(/@apply\s+([^;}]+)/g, (full, utils) => {
    const rewritten = utils.replace(/\S+/g, (tok) => {
      if (tok.endsWith('!')) return tok // already important
      if (DISPLAY.has(bare(tok))) { count++; return `${tok}!` }
      return tok
    })
    return `@apply ${rewritten}`
  })
  return { out, count }
}

const args = process.argv.slice(2)
const check = args[0] === '--check'
const files = (check ? args.slice(1) : args).filter((a) => a.endsWith('.css'))
let total = 0, changed = 0
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const { out, count } = transform(src)
  if (count > 0) {
    total += count; changed++
    if (!check) writeFileSync(file, out)
    console.log(`${check ? 'would mark' : '✓'} ${file}: ${count} display utility → !important`)
  }
}
console.log(`[apply-display-important] ${check ? 'would mark' : 'marked'} ${total} display utilities in ${changed} files`)
