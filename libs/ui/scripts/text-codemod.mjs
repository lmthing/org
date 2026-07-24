#!/usr/bin/env node
/**
 * text-codemod.mjs — Part III / B3.1 of the Tamagui migration.
 *
 * The web `Text` primitive is now a Tamagui `styled(Text)` whose `.is_Text` base is injected
 * UNLAYERED and so BEATS Tailwind utilities for the three props it sets — `display` (inline),
 * `white-space` (pre-wrap) and `word-wrap` (break-word). The primitive already neutralises those to
 * plain-tag semantics (per-tag `display`, `white-space`/`word-wrap` → `inherit`), which is correct for
 * the DEFAULT case but means a surface `Prim.Text` carrying a Tailwind class that SETS one of those
 * three props now loses to the primitive's own value. This codemod lifts exactly those conflicting
 * classes onto Tamagui props (which get the `:root` specificity boost and win), keeping every other
 * class (typography, colour, spacing, `flex-1`, `word-break`) as className.
 *
 *   <Prim.Text className="block truncate text-sm">        →  <Prim.Text className="text-sm"
 *                                                              display="block" overflow="hidden"
 *                                                              textOverflow="ellipsis" whiteSpace="nowrap">
 *
 * LIFT to props (base fights these):
 *   display:      block · inline-block · inline · hidden(→none) · flex · inline-flex   → display
 *   white-space:  whitespace-{normal,nowrap,pre,pre-wrap,pre-line,break-spaces}        → whiteSpace
 *   word-wrap:    break-words(→break-word)                                             → wordWrap
 *   truncate  →  overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap"
 * KEEP as className (base leaves alone): break-all/break-normal (word-break), flex-1/min-w-0/…,
 *   and all typography/colour/spacing/size classes — proven ≡ in apps/web/b0-probe/text-variants.mjs.
 *
 * TS-AST (never touches classes inside strings/comments). Only STATIC string classNames on `Prim.Text`
 * are handled; dynamic classNames (cn(), {expr}, template literals) are SKIPPED and reported. An element
 * that already carries a target prop, a `truncate`+`whitespace-*` collision, or a responsive/state
 * variant of a conflict class (`md:hidden`) is SKIPPED for manual review (can't be a static prop).
 * `import * as Prim` is already present (Phase 0), so no import edits.
 *
 * Usage: node libs/ui/scripts/text-codemod.mjs [--check] <file.tsx> …
 */
import ts from 'typescript'
import { readFileSync, writeFileSync } from 'node:fs'

const DISPLAY = {
  block: 'block', 'inline-block': 'inline-block', inline: 'inline',
  hidden: 'none', flex: 'flex', 'inline-flex': 'inline-flex',
}
const WHITESPACE = {
  'whitespace-normal': 'normal', 'whitespace-nowrap': 'nowrap', 'whitespace-pre': 'pre',
  'whitespace-pre-wrap': 'pre-wrap', 'whitespace-pre-line': 'pre-line',
  'whitespace-break-spaces': 'break-spaces',
}
const TARGET_PROPS = ['display', 'whiteSpace', 'wordWrap', 'overflow', 'textOverflow']

/** Classify one className string. null → no conflict class (skip). {skip} → manual review. */
function classify(cls) {
  const tokens = cls.split(/\s+/).filter(Boolean)
  const keep = []
  const props = {} // ordered
  let touched = false
  for (const t of tokens) {
    // responsive/state variants of a conflict class can't become a static prop → bail for review.
    if (t.includes(':')) {
      const bare = t.slice(t.lastIndexOf(':') + 1)
      if (bare in DISPLAY || bare in WHITESPACE || bare === 'break-words' || bare === 'truncate')
        return { skip: `variant conflict class '${t}' can't be lifted to a static prop (migrate manually)` }
      keep.push(t); continue
    }
    if (t in DISPLAY) { props.display = `"${DISPLAY[t]}"`; touched = true }
    else if (t in WHITESPACE) {
      if (props.whiteSpace && props.whiteSpace !== `"${WHITESPACE[t]}"`)
        return { skip: `conflicting white-space classes (e.g. truncate + ${t}) — migrate manually` }
      props.whiteSpace = `"${WHITESPACE[t]}"`; touched = true
    } else if (t === 'break-words') { props.wordWrap = '"break-word"'; touched = true }
    else if (t === 'truncate') {
      if (props.whiteSpace && props.whiteSpace !== '"nowrap"')
        return { skip: `conflicting white-space classes (truncate + whitespace-*) — migrate manually` }
      props.overflow = '"hidden"'; props.textOverflow = '"ellipsis"'; props.whiteSpace = '"nowrap"'; touched = true
    } else keep.push(t)
  }
  if (!touched) return null
  const order = ['display', 'overflow', 'textOverflow', 'whiteSpace', 'wordWrap']
  const propStr = order.filter((k) => k in props).map((k) => `${k}=${props[k]}`).join(' ')
  return { className: keep.join(' '), propStr }
}

function transform(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits = []
  const skips = []
  let count = 0

  const isPrimText = (t) =>
    t && ts.isPropertyAccessExpression(t) && ts.isIdentifier(t.expression) &&
    t.expression.text === 'Prim' && t.name.text === 'Text'

  const handle = (opening) => {
    if (!isPrimText(opening.tagName)) return
    const attr = opening.attributes.properties.find(
      (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'className',
    )
    if (!attr) return
    const line = sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1
    if (!attr.initializer || !ts.isStringLiteral(attr.initializer)) {
      // Dynamic className: only report if it textually contains a conflict class worth a human look.
      const raw = attr.initializer ? attr.initializer.getText(sf) : ''
      if (/\b(block|inline-block|hidden|inline-flex|truncate|break-words|whitespace-)\b/.test(raw))
        skips.push({ line, why: `dynamic className may carry a conflict class (migrate manually): ${raw.slice(0, 60)}` })
      return
    }
    const res = classify(attr.initializer.text)
    if (!res) return
    if (res.skip) { skips.push({ line, why: res.skip }); return }
    // Don't duplicate a target prop the element already sets explicitly.
    const existing = opening.attributes.properties.filter(
      (p) => ts.isJsxAttribute(p) && TARGET_PROPS.includes(p.name.getText(sf)),
    )
    if (existing.length && res.propStr) {
      skips.push({ line, why: `element already sets ${existing.map((p) => p.name.getText(sf)).join('/')} — merge lifted props manually` })
      return
    }
    count++
    const parts = []
    if (res.className) parts.push(`className="${res.className}"`)
    if (res.propStr) parts.push(res.propStr)
    edits.push({ start: attr.getStart(sf), end: attr.getEnd(), replacement: parts.join(' ') })
  }

  const visit = (node) => {
    if (ts.isJsxElement(node)) handle(node.openingElement)
    else if (ts.isJsxSelfClosingElement(node)) handle(node)
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (edits.length === 0) return { text, changed: false, count: 0, skips }
  edits.sort((a, b) => b.start - a.start || b.end - a.end)
  let out = text
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
  return { text: out, changed: true, count, skips }
}

const args = process.argv.slice(2)
const check = args[0] === '--check'
const files = (check ? args.slice(1) : args).filter((a) => a.endsWith('.tsx'))
let total = 0, totalSkips = 0
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const { text, changed, count, skips } = transform(file, src)
  if (skips.length) { totalSkips += skips.length; for (const s of skips) console.log(`  SKIP ${file}:${s.line} — ${s.why}`) }
  if (changed) {
    total += count
    if (check) console.log(`${file}: ${count} Prim.Text conflict-class → props`)
    else { writeFileSync(file, text); console.log(`✓ ${file}: ${count} Prim.Text conflict-class → props`) }
  }
}
console.log(`[text-codemod] ${check ? 'would migrate' : 'migrated'} ${total} Prim.Text in ${files.length} files; ${totalSkips} skipped for manual review`)
