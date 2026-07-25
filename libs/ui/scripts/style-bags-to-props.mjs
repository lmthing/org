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

  // ── 1. find EVERY module-level `const <name> = { … }` object ─────────────────────────────────
  // Originally this looked for the identifier `styles` and nothing else, which silently skipped the
  // three densest files in the codebase: they name their bags `MONO`, `inputStyle`,
  // `upgradeCardStyles`, `centerStyles`. Discovery is by SHAPE now, not by name.
  const bags = new Map() // name → VariableDeclaration
  const findBags = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isObjectLiteralExpression(unwrap(node.initializer))
    ) {
      bags.set(node.name.text, node)
    }
    ts.forEachChild(node, findBags)
  }
  findBags(sf)
  if (!bags.size) return { text, skips: [`${file}: no module-level object literals`] }

  // ── 2. collect every `style=` reference on a Tamagui-backed target ────────────────────────────
  //
  // Four shapes, all of which point at a module-level bag:
  //   style={BAG}                    a flat style object
  //   style={BAG.entry}              one entry of a bag-of-bags
  //   style={{ ...BAG, k: v }}       a shared base plus overrides — the densest remaining pattern
  //   style={{ ...BAG.a, ...BAG.b }} a pure merge
  //
  // `v` may be a computed expression (`(field.rows ?? 3) * 20`); `pairToProps` returns
  // `{ key: { __expr } }` for those, so they survive as `k={expr}` rather than blocking the file.
  const wanted = new Map() // "BAG" | "BAG.entry" → true if every use is on a Tamagui target
  const sites = [] // { start, end, parts:[{ref}|{props}] }

  /** Resolve a `BAG` / `BAG.entry` expression to its key, or null if it is not a known bag. */
  const refKey = (e) => {
    if (ts.isIdentifier(e) && bags.has(e.text)) return e.text
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && bags.has(e.expression.text)) {
      return `${e.expression.text}.${e.name.getText()}`
    }
    return null
  }

  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText() === 'style' && node.initializer) {
      const init = node.initializer
      if (ts.isJsxExpression(init) && init.expression) {
        const e = init.expression
        const owner = node.parent.parent
        const tag = owner && owner.tagName ? owner.tagName.getText() : ''
        const onTarget = isTarget(tag)

        const direct = refKey(e)
        if (direct) {
          if (!onTarget) { wanted.set(direct, false); skips.push(`${file}: ${direct} is used on <${tag}>, not Tamagui-backed — \`style\` is correct there`) }
          else { if (!wanted.has(direct)) wanted.set(direct, true); sites.push({ start: node.getStart(sf), end: node.getEnd(), parts: [{ ref: direct }] }) }
        } else if (ts.isObjectLiteralExpression(e) && e.properties.length) {
          const parts = []
          let ok = true
          for (const m of e.properties) {
            if (ts.isSpreadAssignment(m)) {
              const k = refKey(m.expression)
              if (!k) { ok = false; break } // spreading something we cannot convert (e.g. a prop)
              parts.push({ ref: k })
            } else if (ts.isPropertyAssignment(m)) {
              const key = m.name.getText().replace(/['"]/g, '')
              const val = unwrap(m.initializer)
              const literal = ts.isStringLiteral(val) ? val.text
                : ts.isNumericLiteral(val) ? Number(val.text)
                : undefined
              const mapped = pairToProps(key, literal, val.getText())
              if (!mapped) { ok = false; skips.push(`${file}: inline \`${key}\` has no safe prop form — left as \`style\``); break }
              parts.push({ props: mapped })
            } else { ok = false; break }
          }
          const refs = ok ? parts.filter((p) => p.ref).map((p) => p.ref) : []
          // `!ok` = a member we cannot convert; `!refs.length` = a plain inline literal, which is the
          // OTHER codemod's job. Either way this attribute keeps its `style`.
          if (ok && refs.length) {
            if (!onTarget) { for (const r of refs) wanted.set(r, false) }
            else {
              for (const r of refs) if (!wanted.has(r)) wanted.set(r, true)
              sites.push({ start: node.getStart(sf), end: node.getEnd(), parts })
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (!sites.length) return { text, skips: [...skips, `${file}: no convertible bag references`] }

  // ── 3. convert each wanted bag / entry, all-or-nothing PER BAG ────────────────────────────────
  const converted = new Map() // key → true
  const blockedBags = new Set() // bags with a CSSProperties contract that could not fully convert
  const edits = []

  /**
   * Does this bag declaration carry a `React.CSSProperties` contract — either a type annotation
   * (`const x: React.CSSProperties`, `: Record<string, React.CSSProperties>`) or a trailing
   * `satisfies`? If so it is ALL-OR-NOTHING: converting some entries and leaving the contract in
   * place makes the converted ones fail it (`paddingVertical` is not a CSS property), and stripping
   * the contract while entries still hold real CSS de-types those. Both were live failures the first
   * time this ran — 6 typecheck errors across `gates.tsx` and `ReplChatView.tsx`.
   */
  const contractOf = (decl) => {
    const annotated = decl.type && /React\.CSSProperties/.test(decl.type.getText())
    const sat = ts.isSatisfiesExpression(decl.initializer) && /React\.CSSProperties/.test(decl.initializer.type.getText())
    return annotated || sat
  }
  for (const [key, allOnTargets] of wanted) {
    if (!allOnTargets) continue
    const [bagName, entry] = key.split('.')
    const decl = bags.get(bagName)
    const bagObj = unwrap(decl.initializer)
    let obj = bagObj
    // `extent` is the FULL initializer, cast included: an entry written
    // `{ … } as React.CSSProperties` must be replaced whole, or the rewrite lands inside the cast and
    // produces `{ … } as const as React.CSSProperties` — which still types as CSSProperties and fails
    // the moment it is spread onto a Tamagui component.
    let extent = decl.initializer
    if (entry !== undefined) {
      const member = bagObj.properties.find(
        (m) => ts.isPropertyAssignment(m) && m.name.getText().replace(/['"]/g, '') === entry,
      )
      if (!member) { skips.push(`${file}: ${key} — no such entry`); continue }
      obj = unwrap(member.initializer)
      extent = member.initializer
    }
    if (!ts.isObjectLiteralExpression(obj)) { skips.push(`${file}: ${key} is not an object literal`); continue }

    const props = {}
    let bad = false
    for (const member of obj.properties) {
      if (!ts.isPropertyAssignment(member)) { skips.push(`${file}: ${key} has a spread or shorthand member — migrate manually`); bad = true; break }
      const k = member.name.getText().replace(/['"]/g, '')
      const val = unwrap(member.initializer)
      const literal = ts.isStringLiteral(val) ? val.text
        : ts.isNumericLiteral(val) ? Number(val.text)
        : undefined
      const mapped = pairToProps(k, literal, val.getText())
      if (!mapped) { skips.push(`${file}: ${key}.${k} has no safe prop form — migrate manually`); bad = true; break }
      Object.assign(props, mapped)
    }
    if (bad) {
      // A constrained bag is all-or-nothing: mark every entry of it unconvertible so no call site
      // gets rewritten against a half-converted bag.
      if (contractOf(decl)) {
        for (const k of [...wanted.keys()]) if (k === bagName || k.startsWith(`${bagName}.`)) converted.delete(k)
        blockedBags.add(bagName)
        skips.push(`${file}: ${bagName} carries a React.CSSProperties contract and not every entry converts — left whole`)
      }
      continue
    }
    if (blockedBags.has(bagName)) continue
    converted.set(key, true)
    // Replace the object's own extent. `as const` is required: without it TypeScript widens
    // `alignSelf: 'flex-end'` to `string`, which Tamagui's literal unions reject.
    edits.push({ start: extent.getStart(sf), end: extent.getEnd(), replacement: `${renderBag(props)} as const` })
  }
  if (!converted.size) return { text, skips: [...skips, `${file}: nothing convertible`] }

  // ── 4. rewrite the call sites whose every referenced bag converted ────────────────────────────
  const siteEdits = []
  for (const site of sites) {
    if (!site.parts.filter((p) => p.ref).every((p) => converted.has(p.ref))) continue
    const attrs = site.parts
      .map((p) => (p.ref ? `{...${p.ref}}` : renderAttrs(p.props)))
      .filter(Boolean)
      .join(' ')
    siteEdits.push({ start: site.start, end: site.end, replacement: attrs })
  }
  if (!siteEdits.length) return { text, skips: [...skips, `${file}: bags converted but no call site could be rewritten`] }

  let out = text
  for (const e of [...edits, ...siteEdits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
  }
  // The `React.CSSProperties` contract on a fully-converted bag is now a lie — these are Tamagui
  // prop bags. Strip the annotation AND the trailing `satisfies`; the guard above guarantees we only
  // reach here when every entry of the bag converted.
  for (const bagName of new Set([...converted.keys()].map((k) => k.split('.')[0]))) {
    out = out
      .replace(new RegExp(`(const ${bagName})\\s*:\\s*React\\.CSSProperties`), '$1')
      .replace(new RegExp(`(const ${bagName})\\s*:\\s*Record<[^>]*React\\.CSSProperties>`), '$1')
  }
  out = out.replace(/\}\s*satisfies Record<[^>]*React\.CSSProperties>/g, (m, off) => {
    // Only for bags we fully converted — find which declaration this closes.
    const before = out.slice(0, off)
    const name = [...before.matchAll(/const ([A-Za-z_$][\w$]*)\s*=\s*\{/g)].pop()?.[1]
    return name && converted.has(`${name}`) === false && [...converted.keys()].some((k) => k.startsWith(`${name}.`))
      ? '}'
      : m
  })
  return { text: out, skips, convertedCount: converted.size, rewritten: siteEdits.length }
}

/** A prop map as an object literal. `__expr` values are raw expressions, not JSON. */
function renderBag(props) {
  const body = Object.entries(props)
    .map(([k, v]) => `${k}: ${v && typeof v === 'object' && '__expr' in v ? v.__expr : JSON.stringify(v)}`)
    .join(', ')
  return `{ ${body} }`
}

/** A prop map as JSX attributes. */
function renderAttrs(props) {
  return Object.entries(props)
    .map(([k, v]) =>
      v && typeof v === 'object' && '__expr' in v
        ? `${k}={${v.__expr}}`
        : typeof v === 'string'
          ? `${k}="${v}"`
          : `${k}={${JSON.stringify(v)}}`,
    )
    .join(' ')
}


const CHECK = process.argv.includes('--check')
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'))
let totalBags = 0
let totalRefs = 0
const allSkips = []
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const { text, skips, convertedCount = 0, rewritten = 0 } = transformBags(f, src)
  allSkips.push(...skips)
  if (text === src) continue
  if (!CHECK) writeFileSync(f, text)
  totalBags += convertedCount
  totalRefs += rewritten
  console.log(`✓ ${f}: ${convertedCount} bag(s) → props, ${rewritten} call site(s) spread`)
}
for (const s of allSkips) console.log(`  SKIP ${s}`)
console.log(`\n[style-bags-to-props] ${CHECK ? 'would convert' : 'converted'} ${totalBags} bag(s), ${totalRefs} call site(s)`)
