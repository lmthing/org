#!/usr/bin/env node
/**
 * classnames-to-props.mjs — the P3 codemod (docs/tamagui-idiomatic-migration.md §5).
 *
 * Rewrites STATIC Tailwind `className` strings on primitive JSX elements (`Prim.Box`, or a
 * directly-imported `Row`/`Col`/`Text`/`Pressable`/…) into idiomatic Tamagui style props, using
 * the exhaustively unit-tested translation table in `classnames-to-props-map.mjs`. It is the
 * bulk engine for the ~1281-usage migration; the manual tail (dynamic `cn()`, alpha modifiers,
 * animations) is REPORTED, never silently dropped.
 *
 *   <Text className="font-display text-2xl font-bold text-foreground mb-2">
 *     →  <Text fontFamily="$heading" fontSize="$2xl" fontWeight="$bold" color="$foreground"
 *              marginBottom="$2">
 *
 * Rules:
 *   - Only STATIC string classNames are rewritten. Dynamic (`cn(...)`, `{expr}`, template) are
 *     REPORTED for manual migration (a conditional-prop-object rewrite, §5).
 *   - `keep` classes (alpha modifiers, animations that need a driver) stay in a residual
 *     `className="…"` — the app still styles them via theme.css until theme.css is deleted last.
 *   - `skip` classes (unmapped utilities) leave the WHOLE element untouched + reported, so a human
 *     migrates it deliberately (never a half-migrated element).
 *   - A prop the element ALREADY sets is not duplicated — reported as a manual merge.
 *
 * Usage:
 *   node libs/ui/scripts/classnames-to-props.mjs [--check] [--targets=Row,Col,…] <file.tsx> …
 *     --check    report only (counts + skips), do not write.
 *     --targets  extra bare-identifier component names to treat as primitives (default set below).
 */
import ts from 'typescript'
import { readFileSync, writeFileSync } from 'node:fs'
import { classToProps } from './classnames-to-props-map.mjs'

const DEFAULT_TARGETS = new Set([
  'Box', 'Row', 'Col', 'Text', 'Pressable', 'Link', 'Form', 'List', 'ListItem', 'Image', 'Label',
])

/** Serialize a prop value to JSX attribute source. */
function serialize(name, value) {
  if (value && typeof value === 'object') {
    const inner = Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k).replace(/^"([A-Za-z_$][\w$]*)"$/, '$1')}: ${lit(v)}`)
      .join(', ')
    return `${name}={{ ${inner} }}`
  }
  if (typeof value === 'number') return `${name}={${value}}`
  return `${name}=${JSON.stringify(String(value))}`
}
function lit(v) {
  if (typeof v === 'number') return String(v)
  return JSON.stringify(String(v))
}

function transform(file, text, targets) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits = []
  const skips = []
  let count = 0

  const isTarget = (tag) => {
    if (ts.isIdentifier(tag)) return targets.has(tag.text)
    return (
      ts.isPropertyAccessExpression(tag) &&
      ts.isIdentifier(tag.expression) &&
      tag.expression.text === 'Prim' &&
      targets.has(tag.name.text)
    )
  }

  const handle = (opening) => {
    if (!isTarget(opening.tagName)) return
    const attr = opening.attributes.properties.find(
      (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'className',
    )
    if (!attr) return
    const line = sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1
    const tag = opening.tagName.getText(sf)

    if (!attr.initializer || !ts.isStringLiteral(attr.initializer)) {
      const raw = attr.initializer ? attr.initializer.getText(sf) : ''
      skips.push({ line, why: `dynamic className on <${tag}> — migrate to conditional prop objects: ${raw.slice(0, 60)}` })
      return
    }

    const { props, keep, skip } = classToProps(attr.initializer.text)
    if (skip.length) {
      skips.push({ line, why: `<${tag}> has unmapped classes ${JSON.stringify(skip)} — migrate manually` })
      return
    }
    if (Object.keys(props).length === 0) return // nothing to lift (all kept)

    // Don't duplicate a prop the element already sets.
    const existing = new Set(
      opening.attributes.properties
        .filter((p) => ts.isJsxAttribute(p))
        .map((p) => p.name.getText(sf)),
    )
    const collisions = Object.keys(props).filter((k) => existing.has(k))
    if (collisions.length) {
      skips.push({ line, why: `<${tag}> already sets ${collisions.join('/')} — merge lifted prop(s) manually` })
      return
    }

    const propStr = Object.entries(props).map(([k, v]) => serialize(k, v)).join(' ')
    const keepAttr = keep.length ? `className=${JSON.stringify(keep.join(' '))} ` : ''
    edits.push({ start: attr.getStart(sf), end: attr.getEnd(), replacement: keepAttr + propStr })
    count++
  }

  const visit = (node) => {
    if (ts.isJsxElement(node)) handle(node.openingElement)
    else if (ts.isJsxSelfClosingElement(node)) handle(node)
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (edits.length === 0) return { text, changed: false, count: 0, skips }
  edits.sort((a, b) => b.start - a.start)
  let out = text
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
  return { text: out, changed: true, count, skips }
}

const args = process.argv.slice(2)
const check = args.includes('--check')
const targetsArg = args.find((a) => a.startsWith('--targets='))
const targets = new Set(DEFAULT_TARGETS)
if (targetsArg) for (const t of targetsArg.slice('--targets='.length).split(',')) targets.add(t)
const files = args.filter((a) => a.endsWith('.tsx'))

let total = 0
let totalSkips = 0
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const { text, changed, count, skips } = transform(file, src, targets)
  if (skips.length) {
    totalSkips += skips.length
    for (const s of skips) console.log(`  SKIP ${file}:${s.line} — ${s.why}`)
  }
  if (changed) {
    total += count
    if (check) console.log(`${file}: ${count} className → props`)
    else {
      writeFileSync(file, text)
      console.log(`✓ ${file}: ${count} className → props`)
    }
  }
}
console.log(
  `[classnames-to-props] ${check ? 'would migrate' : 'migrated'} ${total} element(s) in ${files.length} file(s); ${totalSkips} reported for manual review`,
)
export { transform }
