#!/usr/bin/env node
/**
 * flexbox-codemod.mjs — Part III / B2 of the Tamagui migration.
 *
 * Rewrites flex `Prim.Box` containers to Tamagui `Prim.Row`/`Prim.Col`, moving the box-model layout
 * classes Tamagui's `.is_View` base sets UNLAYERED onto Tamagui props (so the surface layout is
 * driven by Tamagui, not Tailwind), and keeping the classes the base leaves alone as className.
 * Rules are EMPIRICALLY VERIFIED (docs Part III / "B2 — codemod rules"; apps/web/b0-probe).
 *
 *   <Prim.Box className="flex items-center justify-between gap-2 flex-1 min-w-0 px-4">
 *     → <Prim.Row className="justify-between gap-2 px-4" alignItems="center"
 *                 flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0}>
 *
 * MOVE to props: items-* → alignItems · flex-1/-auto/-none → flexGrow/Shrink/Basis · shrink-* →
 *   flexShrink · grow-* → flexGrow · min-w-0 → minWidth · self-* → alignSelf.
 * STRIP: flex / flex-row / flex-col (Row/Col own display + direction).
 * KEEP as className: justify-* · gap-* · everything paint/spacing/size.
 *
 * TS-AST (never touches `flex` inside strings/comments). Only STATIC string classNames are handled;
 * dynamic classNames (cn(), {expr}, template literals) and containers carrying a `text-{size}` class
 * (whose line-height Tamagui overrides — needs an inline-style fix) are SKIPPED and reported for
 * manual migration. `import * as Prim` is already present (Phase 0), so no import edits.
 *
 * Usage: node libs/ui/scripts/flexbox-codemod.mjs [--check] <file.tsx> …
 */
import ts from 'typescript'
import { readFileSync, writeFileSync } from 'node:fs'

const ALIGN = { center: 'center', start: 'flex-start', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' }
const TEXT_SIZE = /^text-(xs|sm|base|lg|xl|[2-9]xl)$/
// Tailwind text-{size} line-heights (the Tamagui View base overrides line-height, so a migrated
// container carrying a text-{size} class must restore it via inline style — verified in b0-probe).
const TEXT_LH = { xs: '1rem', sm: '1.25rem', base: '1.5rem', lg: '1.75rem', xl: '1.75rem', '2xl': '2rem', '3xl': '2.25rem', '4xl': '2.5rem', '5xl': '1', '6xl': '1', '7xl': '1', '8xl': '1', '9xl': '1' }

/** Classify one className string. Returns null to SKIP, else {tag, className, props, reason?}. */
function classify(cls) {
  const tokens = cls.split(/\s+/).filter(Boolean)
  if (!tokens.includes('flex')) return null // exact display:flex only (not inline-flex)
  const isCol = tokens.includes('flex-col')
  const keep = []
  const props = {} // ordered insertion
  let lineHeight = null
  for (const t of tokens) {
    if (t === 'flex' || t === 'flex-row' || t === 'flex-col') continue
    let m
    if ((m = t.match(/^items-(center|start|end|stretch|baseline)$/))) props.alignItems = `"${ALIGN[m[1]]}"`
    else if (t === 'flex-1') { props.flexGrow = '{1}'; props.flexShrink = '{1}'; props.flexBasis = '"0%"' }
    else if (t === 'flex-auto') { props.flexGrow = '{1}'; props.flexShrink = '{1}'; props.flexBasis = '"auto"' }
    else if (t === 'flex-none') { props.flexGrow = '{0}'; props.flexShrink = '{0}'; props.flexBasis = '"auto"' }
    else if ((m = t.match(/^(?:flex-)?shrink-(\d+)$/))) props.flexShrink = `{${m[1]}}`
    else if (t === 'shrink' || t === 'flex-shrink') props.flexShrink = '{1}'
    else if ((m = t.match(/^(?:flex-)?grow-(\d+)$/))) props.flexGrow = `{${m[1]}}`
    else if (t === 'grow' || t === 'flex-grow') props.flexGrow = '{1}'
    else if ((m = t.match(/^min-([wh])-(0|full)$/))) {
      // The View base forces min-width/height (webBlockCompat → auto), so a min-* class loses → prop.
      const key = m[1] === 'w' ? 'minWidth' : 'minHeight'
      props[key] = m[2] === '0' ? '{0}' : '"100%"'
    } else if (/^min-[wh]-/.test(t)) return { skip: `unrecognized min-* class '${t}' (base overrides min-width/height; map it to a prop manually)` }
    else if ((m = t.match(/^self-(auto|start|end|center|stretch|baseline)$/)))
      props.alignSelf = `"${m[1] === 'start' ? 'flex-start' : m[1] === 'end' ? 'flex-end' : m[1]}"`
    else if ((m = t.match(TEXT_SIZE))) { lineHeight = TEXT_LH[m[1]]; keep.push(t) } // keep for font-size; restore line-height
    else keep.push(t)
  }
  // deterministic prop order
  const order = ['alignItems', 'alignSelf', 'flexGrow', 'flexShrink', 'flexBasis', 'minWidth', 'minHeight']
  const propStr = order.filter((k) => k in props).map((k) => `${k}=${props[k]}`).join(' ')
  return { tag: isCol ? 'Col' : 'Row', className: keep.join(' '), propStr, lineHeight }
}

function transform(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits = []
  const skips = []
  let count = 0

  const isPrimBox = (t) =>
    t && ts.isPropertyAccessExpression(t) && ts.isIdentifier(t.expression) &&
    t.expression.text === 'Prim' && t.name.text === 'Box'

  const handle = (opening, closing) => {
    if (!isPrimBox(opening.tagName)) return
    const attr = opening.attributes.properties.find(
      (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'className',
    )
    if (!attr) return
    // Only static string classNames.
    if (!attr.initializer || !ts.isStringLiteral(attr.initializer)) {
      const cls = attr.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : ''
      // detect flex intent for reporting only when it's a plain string (handled above); dynamic → check text
      return
    }
    const cls = attr.initializer.text
    const res = classify(cls)
    if (!res) return // not a flex box
    const line = sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1
    if (res.skip) { skips.push({ line, why: res.skip }); return }
    // A text-{size} container needs an inline lineHeight restore; if it already has a `style` attr,
    // merging is ambiguous → SKIP for manual migration.
    const hasStyle = opening.attributes.properties.some(
      (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'style',
    )
    if (res.lineHeight && hasStyle) {
      skips.push({ line, why: `flex container has both a text-{size} class and an existing style attr (merge lineHeight manually)` })
      return
    }
    count++
    // rename opening tag
    edits.push({ start: opening.tagName.getStart(sf), end: opening.tagName.getEnd(), replacement: `Prim.${res.tag}` })
    // replace the className attribute with (kept className + props [+ style lineHeight])
    const parts = []
    if (res.className) parts.push(`className="${res.className}"`)
    if (res.propStr) parts.push(res.propStr)
    if (res.lineHeight) parts.push(`style={{ lineHeight: '${res.lineHeight}' }}`)
    edits.push({ start: attr.getStart(sf), end: attr.getEnd(), replacement: parts.join(' ') })
    // rename closing tag
    if (closing) edits.push({ start: closing.tagName.getStart(sf), end: closing.tagName.getEnd(), replacement: `Prim.${res.tag}` })
  }

  const visit = (node) => {
    if (ts.isJsxElement(node)) handle(node.openingElement, node.closingElement)
    else if (ts.isJsxSelfClosingElement(node)) handle(node, null)
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
    if (check) console.log(`${file}: ${count} flex Box → Row/Col`)
    else { writeFileSync(file, text); console.log(`✓ ${file}: ${count} flex Box → Row/Col`) }
  }
}
console.log(`[flexbox-codemod] ${check ? 'would migrate' : 'migrated'} ${total} flex Boxes in ${files.length} files; ${totalSkips} skipped for manual review`)
