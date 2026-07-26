#!/usr/bin/env node
/**
 * lint-no-tailwind.mjs — Tailwind stays out of `libs/ui` and `apps/web`.
 *
 * `libs/css/src/tailwind-free.test.ts` already guards the STYLESHEETS (no `@apply`, `@theme`,
 * `--tw-*`, …). Two things it cannot see, both of which had drifted:
 *
 *   1. **Dependencies.** `tailwind-merge` was still a runtime dependency of both packages long after
 *      the last Tailwind class went — `cn()` was shipping a utility-conflict table for a vocabulary
 *      the codebase no longer speaks, and `apps/web` carried it with zero call sites.
 *   2. **Utility classNames in TSX.** A stylesheet gate cannot see `className="p-4 flex"`. Without
 *      Tailwind installed those produce nothing at all, so they are invisible until someone notices
 *      the layout is wrong.
 *
 * The animation classes are allowed BY NAME: `.animate-spin`/`.animate-pulse` are hand-written in
 * `libs/css/src/animations.css` (Tailwind's names kept on purpose so the computed style did not
 * shift), and `lm-*` are ours.
 *
 * NOT in scope: `libs/cli`, which compiles agent-authored project app pages with a real Tailwind —
 * a product feature, not migration residue.
 *
 * Usage: node libs/ui/scripts/lint-no-tailwind.mjs   (checks libs/ui + apps/web)
 */
import ts from 'typescript'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ORG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PACKAGES = ['libs/ui', 'apps/web']

/** Dependency names that mean Tailwind is back. `@tailwindcss/vite` is loaded lazily by
 *  `libs/utils`, so an app that opted out should not carry it either. */
const FORBIDDEN_DEP = /^(tailwindcss|tailwind-merge|@tailwindcss\/.*|@tailwindcss-.*)$/

/**
 * Classes that LOOK like Tailwind utilities but are ours. Everything else matching the utility
 * shape is a finding.
 */
const ALLOWED_CLASS = /^(lm-[\w-]+|animate-spin|animate-pulse|safe-top|safe-bottom|streaming-cursor|react-arborist[\w-]*)$/

/**
 * The utility shape: an optional variant chain, then either a word that IS a utility on its own
 * (`flex`, `hidden`) or a property prefix that REQUIRES a value (`p-4`, `text-sm`).
 *
 * The split matters: a bare `h` or `p` is not a Tailwind class, and treating it as one made this
 * gate fire on a test fixture that used `className="h"` as an arbitrary string.
 */
const VARIANTS = '(?:(?:sm|md|lg|xl|2xl|hover|focus|focus-visible|active|disabled|dark|group-hover|peer|first|last|odd|even):)*'
const STANDALONE = 'flex|grid|hidden|block|inline|inline-block|inline-flex|table|contents|truncate|underline|italic|absolute|relative|fixed|sticky|static|uppercase|lowercase|capitalize|antialiased'
const PREFIXED =
  'p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min-w|min-h|max-w|max-h|gap|space-x|space-y|text|bg|border|rounded|shadow|flex|grid|items|justify|self|order|col|row|z|opacity|overflow|whitespace|leading|tracking|font|cursor|select|pointer-events|ring|outline|transition|duration|ease|animate|translate|scale|rotate|inset|top|bottom|left|right|list|divide|prose'
const UTILITY = new RegExp(`^${VARIANTS}(?:(?:${STANDALONE})|(?:${PREFIXED})-[\\w./\\[\\]%-]+)$`)

const findings = []

for (const pkg of PACKAGES) {
  const manifestPath = join(ORG, pkg, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const dep of Object.keys(manifest[field] ?? {})) {
      if (FORBIDDEN_DEP.test(dep)) {
        findings.push(`${pkg}/package.json  ${field}.${dep}  — Tailwind is not used here`)
      }
    }
  }
}

function tsxFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) tsxFiles(p, out)
    // Test fixtures use arbitrary class strings; the sibling `lint-rn-safety` skips them too.
    else if (extname(name) === '.tsx' && !name.endsWith('.test.tsx')) out.push(p)
  }
  return out
}

for (const pkg of PACKAGES) {
  for (const file of tsxFiles(join(ORG, pkg, 'src'))) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node) => {
      // Only `className` attribute values — a Tailwind-shaped word in a comment or a string
      // constant is not a class, which is why this is AST-based rather than a grep.
      if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'className' && node.initializer) {
        const literals = []
        const collect = (n) => {
          if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) literals.push(n)
          ts.forEachChild(n, collect)
        }
        collect(node.initializer)
        for (const literal of literals) {
          for (const cls of literal.text.split(/\s+/).filter(Boolean)) {
            if (ALLOWED_CLASS.test(cls) || !UTILITY.test(cls)) continue
            const { line } = sf.getLineAndCharacterOfPosition(literal.getStart(sf))
            findings.push(`${relative(ORG, file)}:${line + 1}  className "${cls}"  — no Tailwind to compile it`)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
}

if (findings.length === 0) {
  console.log('[lint-no-tailwind] ✓ no Tailwind dependency or utility className in libs/ui or apps/web')
  process.exit(0)
}
for (const f of findings) console.log(f)
console.error(
  `\n[lint-no-tailwind] ✗ ${findings.length} finding(s). Tailwind was removed from the design system ` +
    `and the web surfaces (docs/tamagui-final-steps.md §4): a utility className compiles to nothing ` +
    `and renders unstyled. Use design-system props/tokens. Animation classes are allow-listed by name.`,
)
process.exit(1)
