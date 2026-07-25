#!/usr/bin/env node
/**
 * style-bags-to-props.mjs — the last of the inline-`style` tail (phase 3 of
 * docs/tamagui-final-steps.md).
 *
 * `inline-style-to-props.mjs` only lifts inline object LITERALS (`style={{ … }}`). Most of what is
 * left is a REFERENCE — `style={styles.container}` pointing at a module-level
 * `const styles = { container: { … } as React.CSSProperties }`. The codemod cannot see through the
 * indirection, so ~87 of the 127 remaining objects were invisible to it.
 *
 * This converts the bag itself: each entry's CSS keys become Tamagui prop names, using the SAME
 * `pairToProps` mapping the inline codemod uses (imported, not reimplemented — a second mapping table
 * would be a second thing to drift), and every `style={styles.x}` becomes `{...styles.x}`.
 *
 * SAFETY, per ENTRY. An entry is converted only if EVERY key in it maps cleanly; one unmappable key
 * (`transition`, `wordBreak`, `resize`, a shorthand this file cannot expand) and that entry is left
 * as `style` and reported. Entry granularity is the correct unit because each call site references
 * exactly one entry — so no element ever ends up with half its styling on each channel, which would be
 * worse than none given Tamagui silently drops style props it does not understand.
 *
 * Bags on NON-Tamagui targets are left alone: `Prim.Svg`/`Prim.Video`/`Prim.IFrame` are passthroughs
 * that ignore style props, lucide takes `style`, and `.native.tsx` React Native styles ARE `style`.
 *
 * Usage: node libs/ui/scripts/style-bags-to-props.mjs [--check] <file.tsx> …
 */
import ts from 'typescript'
import { readFileSync, writeFileSync } from 'node:fs'
import { pairToProps } from './inline-style-to-props.mjs'

/** Look through `expr as X` and `expr satisfies X`. `satisfies` is the one that bit: the finder only
 *  unwrapped `as`, so `const styles = { … } satisfies Record<…>` looked like "no styles object". */
const unwrap = (node) =>
  ts.isAsExpression(node) || ts.isSatisfiesExpression(node) ? unwrap(node.expression) : node

/** Tamagui-backed targets — the same list the inline codemod uses, for the same reason. */
const TARGETS = new Set([
  'Box', 'Row', 'Col', 'Text', 'Pressable', 'Link', 'Form', 'List', 'ListItem', 'Image', 'Label',
  'TextField', 'TextArea', 'Select', 'Pre', 'Table', 'Thead', 'Tbody', 'Tfoot', 'Tr', 'Th', 'Td',
  'Stack', 'Card', 'CardHeader', 'CardBody', 'CardFooter', 'Caption', 'Heading', 'Code',
])

const isTarget = (tagText) => TARGETS.has(tagText.includes('.') ? tagText.split('.').pop() : tagText)

/** Render a prop map back out as JSX attribute text. */
function propsToAttrs(props) {
  return Object.entries(props)
    .map(([k, v]) => (typeof v === 'string' ? `${k}="${v}"` : `${k}={${JSON.stringify(v)}}`))
    .join(' ')
}

export function transformBags(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const skips = []

  // ── 1. find `const styles = { … }` (or `const styles: X = { … }`) ────────────────────────────
  let bagDecl = null
  const findBag = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'styles' &&
      node.initializer &&
      ts.isObjectLiteralExpression(unwrap(node.initializer))
    ) {
      bagDecl = node
    }
    ts.forEachChild(node, findBag)
  }
  findBag(sf)
  if (!bagDecl) return { text, skips: [`${file}: no module-level \`const styles\` object`] }

  // ── 2. which entries are referenced, and are ALL their targets Tamagui-backed? ────────────────
  const used = new Map() // entryName → { spreadable: boolean }
  const refs = [] // { start, end, entry }
  const merges = [] // { start, end, names[] } — `style={{ ...styles.a, ...styles.b }}`
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText() === 'style' && node.initializer) {
      const init = node.initializer
      if (ts.isJsxExpression(init) && init.expression) {
        const e = init.expression
        // `style={styles.foo}` only. A spread/merge (`{ ...styles.a, ...style }`) keeps its `style`:
        // the incoming `style` prop is a caller-supplied CSSProperties object we cannot convert.
        // `style={{ ...styles.a, ...styles.b }}` — a pure merge of bag entries becomes two spreads.
        // Only when EVERY member is such a spread: a mixed `{ ...styles.a, top: x }` would need the
        // extra keys mapped too, and is left for the inline codemod / hand.
        if (
          ts.isObjectLiteralExpression(e) &&
          e.properties.length > 0 &&
          e.properties.every(
            (m) =>
              ts.isSpreadAssignment(m) &&
              ts.isPropertyAccessExpression(m.expression) &&
              ts.isIdentifier(m.expression.expression) &&
              m.expression.expression.text === 'styles',
          )
        ) {
          const owner = node.parent.parent
          const tag = owner && owner.tagName ? owner.tagName.getText() : ''
          const names = e.properties.map((m) => m.expression.name.getText())
          if (isTarget(tag)) {
            for (const n of names) if (!used.has(n)) used.set(n, { spreadable: true })
            merges.push({ start: node.getStart(sf), end: node.getEnd(), names })
          } else {
            for (const n of names) used.set(n, { spreadable: false })
          }
        } else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'styles') {
          const owner = node.parent.parent // JsxAttributes → JsxOpening/SelfClosing element
          const tag = owner && owner.tagName ? owner.tagName.getText() : ''
          const entry = e.name.getText()
          if (!isTarget(tag)) {
            skips.push(`${file}:${sf.getLineAndCharacterOfPosition(node.pos).line + 1} — styles.${entry} on <${tag}> is not Tamagui-backed; \`style\` is correct there`)
            used.set(entry, { spreadable: false })
          } else {
            if (!used.has(entry)) used.set(entry, { spreadable: true })
            refs.push({ start: node.getStart(sf), end: node.getEnd(), entry })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (!refs.length && !merges.length) return { text, skips: [...skips, `${file}: no convertible \`style={styles.x}\` references`] }

  // ── 3. convert every entry that is referenced from a Tamagui target ───────────────────────────
  const edits = []
  for (const prop of unwrap(bagDecl.initializer).properties) {
    if (!ts.isPropertyAssignment(prop)) {
      skips.push(`${file}: \`styles\` has a non-literal member — left as-is`)
      continue
    }
    const name = prop.name.getText().replace(/['"]/g, '')
    const entry = used.get(name)
    if (!entry || !entry.spreadable) continue // unreferenced, or referenced only from a passthrough

    // Unwrap `{ … } as React.CSSProperties`.
    const obj = unwrap(prop.initializer)
    if (!ts.isObjectLiteralExpression(obj)) {
      skips.push(`${file}: styles.${name} is not an object literal`)
      continue
    }

    const props = {}
    let bad = false
    for (const member of obj.properties) {
      if (!ts.isPropertyAssignment(member)) {
        skips.push(`${file}: styles.${name} has a spread or shorthand member — migrate manually`)
        bad = true
        break
      }
      const key = member.name.getText().replace(/['"]/g, '')
      const valNode = unwrap(member.initializer)
      const literal = ts.isStringLiteral(valNode)
        ? valNode.text
        : ts.isNumericLiteral(valNode)
          ? Number(valNode.text)
          : undefined
      if (literal === undefined) {
        skips.push(`${file}: styles.${name}.${key} is not a literal — migrate manually`)
        bad = true
        break
      }
      const mapped = pairToProps(key, literal, valNode.getText())
      if (!mapped) {
        skips.push(`${file}: styles.${name}.${key} has no safe prop form — migrate manually`)
        bad = true
        break
      }
      Object.assign(props, mapped)
    }
    if (bad) continue // this entry keeps its `style`; its call sites are left untouched below
    // Replace the entry's ENTIRE initializer, cast included: `{ … } as React.CSSProperties` becomes a
    // Tamagui prop bag, and the cast would then be a lie. Doing it per-entry matters — an earlier
    // version stripped every cast in the file with one regex, which also de-typed the entries that were
    // NOT converted and are still passed as `style`.
    edits.push({ start: prop.initializer.getStart(sf), end: prop.initializer.getEnd(), props, name })
  }
  if (!edits.length) return { text, skips: [...skips, `${file}: nothing convertible`] }

  // ── 4. rewrite, right-to-left ────────────────────────────────────────────────────────────────
  const all = [
    ...edits.map((e) => ({
      start: e.start,
      end: e.end,
      // Keep it an object; only the KEYS change. The call sites spread it instead of passing it as
      // `style`, so this stays one named bag per surface rather than inlining N props at N sites.
      // `as const` is required, not cosmetic: without it TypeScript widens `alignSelf: 'flex-end'`
      // to `string`, which is not assignable to Tamagui's literal union — 23 errors' worth. It also
      // matches how every hand-written prop bag in this codebase is declared.
      replacement: `{ ${Object.entries(e.props)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(', ')} } as const`,
    })),
    // Only the call sites whose entry converted — an entry left as `style` keeps its call sites.
    ...refs
      .filter((r) => edits.some((e) => e.name === r.entry))
      .map((r) => ({ start: r.start, end: r.end, replacement: `{...styles.${r.entry}}` })),
    // A merge only converts if EVERY entry it spreads did; otherwise it keeps its `style`.
    ...merges
      .filter((m) => m.names.every((n) => edits.some((e) => e.name === n)))
      .map((m) => ({
        start: m.start,
        end: m.end,
        replacement: m.names.map((n) => `{...styles.${n}}`).join(' '),
      })),
  ].sort((a, b) => b.start - a.start)

  let out = text
  for (const e of all) out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
  return { text: out, skips, converted: edits.length, rewritten: refs.length }
}

const CHECK = process.argv.includes('--check')
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'))
let totalBags = 0
let totalRefs = 0
const allSkips = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const { text, skips, converted = 0, rewritten = 0 } = transformBags(f, src)
  allSkips.push(...skips)
  if (text === src) continue
  if (!CHECK) writeFileSync(f, text)
  totalBags += converted
  totalRefs += rewritten
  console.log(`✓ ${f}: ${converted} bag(s) → props, ${rewritten} call site(s) spread`)
}
for (const s of allSkips) console.log(`  SKIP ${s}`)
console.log(`\n[style-bags-to-props] ${CHECK ? 'would convert' : 'converted'} ${totalBags} bag(s), ${totalRefs} call site(s)`)
