#!/usr/bin/env node
/**
 * inline-style-to-props.mjs — lifts a STATIC inline `style={{…}}` object into Tamagui style props
 * (docs/tamagui-idiomatic-migration.md §5).
 *
 * `style` is the other escape hatch the migration has to close, and the larger one: it bypasses
 * Tamagui's atomic CSS completely, so a value there gets no media/hover variants, no token
 * resolution, and — the part that matters for native — no cross-platform translation at all.
 *
 *   <Prim.Box style={{ display: 'flex', gap: '0.5rem', padding: '1rem' }}>
 *     →  <Prim.Box display="flex" gap="0.5rem" padding="1rem">
 *
 * Rules, all of them the same safety rules the className codemod uses:
 *   - Only STATIC object literals on TAMAGUI-BACKED primitives. A `hostPrimitive` passthrough
 *     forwards props to a raw host tag, which ignores style props — converting one would delete
 *     the styling silently. A spread, a variable, or a call bails the whole object.
 *   - A shorthand is EXPANDED, not passed through (`flex: 1`, `padding: 'a b'`, `border: '…'`),
 *     because Tamagui has no shorthand for those and would drop them.
 *   - Any key that is not in the accept-list bails the WHOLE object and is reported, so an element
 *     is never half-lifted. The list deliberately EXCLUDES the props Tamagui silently drops
 *     (`wordBreak`, `listStyleType`, `listStyle`) — see `primitives/index.test.tsx`.
 *   - A prop the element already sets is reported as a manual merge.
 *   - Non-literal VALUES are fine (`color: colors.brand` → `color={colors.brand}`): the value is
 *     re-emitted as an expression. It is the KEY set that has to be understood, not the values.
 *
 * Usage:
 *   node libs/ui/scripts/inline-style-to-props.mjs [--check] <file.tsx> …
 */
import ts from 'typescript'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Tamagui-backed primitives — the same list the className codemod targets, same reason. */
const TARGETS = new Set([
  'Box', 'Row', 'Col', 'Text', 'Pressable', 'Link', 'Form', 'List', 'ListItem', 'Image', 'Label',
  'TextField', 'TextArea', 'Select', 'Pre', 'Table', 'Thead', 'Tbody', 'Tfoot', 'Tr', 'Th', 'Td',

  /*
   * Composites added in phase 3 (docs/tamagui-final-steps.md), each only AFTER READING IT and
   * confirming two things: it spreads its rest props straight onto a Tamagui primitive, and its
   * props interface now extends that primitive's prop type. The second half mattered — all of these
   * already forwarded style props correctly at RUNTIME, behind an `as Record<string, unknown>` cast
   * that existed purely because the declared type was `ComponentProps<'div'>`. Widening the type
   * deleted the casts and is what makes lifting a style here type-safe rather than merely working.
   *
   * NOT added, and not addable: `Prim.Svg`/`Prim.Video`/`Prim.IFrame`/`Prim.Line`/`Prim.Polyline`
   * (passthrough — they IGNORE style props, §6), every lucide icon (takes `style`, phase 1), and the
   * `Native*`/`RN*`/`TextInput`/`WebView` tags in `.native.tsx` forks (React Native styles ARE
   * `style`). For those, `style` is the correct destination, not a thing to migrate.
   */
  'Stack', 'Card', 'CardHeader', 'CardBody', 'CardFooter', 'Caption', 'Heading', 'Code',
])

/**
 * Keys that map 1:1 to a Tamagui style prop. Anything absent bails the object — including keys
 * Tamagui ACCEPTS but that need thought (`transition`, `animation`, `transform`), and keys it
 * silently DROPS (`wordBreak`, `listStyleType`).
 */
const DIRECT = new Set([
  'display', 'position', 'top', 'right', 'bottom', 'left', 'zIndex', 'opacity', 'overflow',
  'overflowX', 'overflowY', 'cursor', 'pointerEvents', 'userSelect', 'boxSizing',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'flexBasis',
  'alignItems', 'alignSelf', 'alignContent', 'justifyContent', 'gap', 'columnGap', 'rowGap',
  'gridTemplateColumns', 'gridTemplateRows',
  'color', 'backgroundColor', 'backgroundImage',
  'borderWidth', 'borderStyle', 'borderColor', 'borderRadius',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'textAlign', 'textTransform', 'textDecorationLine', 'textOverflow',
  'whiteSpace', 'wordWrap',
])

/** `display: 'flex'` etc. are fine as-is; these need EXPANDING because Tamagui has no shorthand. */
const EXPAND = {
  flex: (v) => (v === 1 || v === '1' ? { flexGrow: 1, flexShrink: 1, flexBasis: '0%' } : null),
  background: (v) => (typeof v === 'string' && v.includes('gradient') ? { backgroundImage: v } : { backgroundColor: v }),
  inset: (v) => ({ top: v, right: v, bottom: v, left: v }),
}

/** `padding: 'a b'` → vertical/horizontal, `'a b c d'` → per side. Only for LITERAL values. */
function expandBox(prop, value) {
  const parts = String(value).trim().split(/\s+/)
  const Cap = prop[0].toUpperCase() + prop.slice(1)
  if (parts.length === 1) return { [prop]: value }
  if (parts.length === 2) return { [`${prop}Vertical`]: parts[0], [`${prop}Horizontal`]: parts[1] }
  if (parts.length === 3) {
    return { [`${prop}Top`]: parts[0], [`${prop}Horizontal`]: parts[1], [`${prop}Bottom`]: parts[2] }
  }
  if (parts.length === 4) {
    return { [`${prop}Top`]: parts[0], [`${prop}Right`]: parts[1], [`${prop}Bottom`]: parts[2], [`${prop}Left`]: parts[3] }
  }
  return null
}

/** `border: '1px solid var(--x)'` → the width/style/colour trio, per side. */
function expandBorder(prop, value) {
  const side = prop === 'border' ? '' : prop.slice('border'.length)
  const m = String(value).trim().match(/^(\S+)\s+(solid|dashed|dotted|none)\s+(.+)$/)
  if (!m) return String(value).trim() === 'none' ? { [`border${side}Width`]: 0 } : null
  return { [`border${side}Width`]: m[1], [`border${side}Style`]: m[2], [`border${side}Color`]: m[3] }
}

/**
 * One `{ key: valueNode }` pair → props, or null to bail. `text` is the value's SOURCE (so a
 * non-literal is re-emitted verbatim); `literal` is its value when it is a plain literal.
 */
export function pairToProps(key, literal, text) {
  const isLiteral = literal !== undefined
  if (key in EXPAND) {
    if (!isLiteral && key !== 'background') return null // an expanded shorthand needs its value
    return EXPAND[key](isLiteral ? literal : text)
  }
  if ((key === 'padding' || key === 'margin') && isLiteral) return expandBox(key, literal)
  if (/^border(Top|Right|Bottom|Left)?$/.test(key)) return isLiteral ? expandBorder(key, literal) : null
  if (DIRECT.has(key)) return { [key]: isLiteral ? literal : { __expr: text } }
  return null
}

/** Serialize one prop to JSX attribute source. */
function attr(name, value) {
  if (value && typeof value === 'object' && '__expr' in value) return `${name}={${value.__expr}}`
  if (typeof value === 'number') return `${name}={${value}}`
  return `${name}=${JSON.stringify(String(value))}`
}

export function transform(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits = []
  const skips = []

  const isTarget = (tag) => {
    if (ts.isIdentifier(tag)) return TARGETS.has(tag.text)
    return (
      ts.isPropertyAccessExpression(tag) &&
      ts.isIdentifier(tag.expression) &&
      tag.expression.text === 'Prim' &&
      TARGETS.has(tag.name.text)
    )
  }

  const handle = (opening) => {
    if (!isTarget(opening.tagName)) return
    const attrNode = opening.attributes.properties.find(
      (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'style',
    )
    if (!attrNode?.initializer || !ts.isJsxExpression(attrNode.initializer)) return
    const obj = attrNode.initializer.expression
    if (!obj || !ts.isObjectLiteralExpression(obj)) return
    const line = sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1
    const tag = opening.tagName.getText(sf)

    const existing = new Set(
      opening.attributes.properties.filter((p) => ts.isJsxAttribute(p)).map((p) => p.name.getText(sf)),
    )

    const props = {}
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        skips.push({ line, why: `<${tag}> style has a spread or shorthand member — migrate manually` })
        return
      }
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null
      if (!key) { skips.push({ line, why: `<${tag}> style has a computed key — migrate manually` }); return }
      const v = prop.initializer
      let literal
      if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) literal = v.text
      else if (ts.isNumericLiteral(v)) literal = Number(v.text)
      const got = pairToProps(key, literal, v.getText(sf))
      if (!got) {
        skips.push({ line, why: `<${tag}> style key ${JSON.stringify(key)} has no safe prop form — migrate manually` })
        return
      }
      Object.assign(props, got)
    }
    if (Object.keys(props).length === 0) return

    const collisions = Object.keys(props).filter((k) => existing.has(k))
    if (collisions.length) {
      skips.push({ line, why: `<${tag}> already sets ${collisions.join('/')} — merge manually` })
      return
    }
    edits.push({
      start: attrNode.getStart(sf),
      end: attrNode.getEnd(),
      replacement: Object.entries(props).map(([k, v]) => attr(k, v)).join(' '),
    })
  }

  const visit = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) handle(n)
    ts.forEachChild(n, visit)
  }
  visit(sf)

  if (!edits.length) return { text, changed: false, count: 0, skips }
  edits.sort((a, b) => b.start - a.start)
  let out = text
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
  return { text: out, changed: true, count: edits.length, skips }
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntry) {
  const args = process.argv.slice(2)
  const check = args[0] === '--check'
  const files = (check ? args.slice(1) : args).filter((a) => a.endsWith('.tsx'))
  let total = 0
  let skipped = 0
  for (const file of files) {
    const { text, changed, count, skips } = transform(file, readFileSync(file, 'utf8'))
    for (const s of skips) console.log(`  SKIP ${file}:${s.line} — ${s.why}`)
    skipped += skips.length
    if (!changed) continue
    total += count
    if (check) console.log(`${file}: ${count} style object(s)`)
    else { writeFileSync(file, text); console.log(`✓ ${file}: ${count} style → props`) }
  }
  console.log(`[inline-style-to-props] ${check ? 'would lift' : 'lifted'} ${total} object(s) in ${files.length} files; ${skipped} reported`)
}
