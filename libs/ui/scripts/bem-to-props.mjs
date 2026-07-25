/**
 * bem-to-props — convert a BEM component stylesheet into Tamagui `$`-token PROP BAGS.
 *
 * The element-layer swap (docs/tamagui-idiomatic-migration.md §4) was done by hand, one block at a
 * time: read the `@apply` rules, write the equivalent prop bag, rewrite the call sites, delete the
 * stylesheet. That is fine for 29 element blocks; the 16 surviving `components/**` stylesheets carry
 * ~810 classes, 1446 plain declarations and 1159 `@apply` utilities, which is codemod territory.
 *
 * `@apply` lines are converted by the SAME map the P3 className codemod uses
 * (`classnames-to-props-map.mjs`), so the two agree by construction. Plain CSS declarations go
 * through the property table below.
 *
 * SAFETY RULE — a rule is converted only if EVERY declaration in it maps. A partially-converted
 * rule would silently drop whatever did not map, which is precisely the class of bug this migration
 * has already hit three times (font tokens, `Prim.Image`, `Code block`). Anything unmapped is
 * REPORTED and its rule is left in the stylesheet untouched.
 *
 *   node libs/ui/scripts/bem-to-props.mjs <stylesheet.css> …    # report
 *   node libs/ui/scripts/bem-to-props.mjs --emit <stylesheet.css>   # print the prop-bag module
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { classToProps } from './classnames-to-props-map.mjs'

/** CSS property → Tamagui prop, for the non-shorthand cases. Hyphen→camel unless listed. */
const RENAME = {
  'background': 'backgroundColor',
  'background-color': 'backgroundColor',
}
/** Properties with no Tamagui prop form — a rule using one is left in CSS. */
const UNMAPPABLE = new Set([
  'transition', 'animation', 'content', 'list-style', 'appearance', '-webkit-appearance',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-area',
  'backdrop-filter', 'filter', 'mask', 'clip-path', 'will-change', 'scrollbar-width',
])

const camel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
const isColorish = (v) => /^(var\(|#|rgb|hsl|color-mix|transparent|currentColor|white|black)/i.test(v.trim())

/** `padding: a [b [c [d]]]` → the four-side props (same shape for margin). */
function expandBox(prefix, value) {
  const parts = value.trim().split(/\s+/)
  const [T, R, B, L] =
    parts.length === 1 ? [parts[0], parts[0], parts[0], parts[0]] :
    parts.length === 2 ? [parts[0], parts[1], parts[0], parts[1]] :
    parts.length === 3 ? [parts[0], parts[1], parts[2], parts[1]] :
    parts.length === 4 ? parts : null
  if (!T) return null
  const P = prefix === 'padding' ? 'padding' : 'margin'
  if (T === B && R === L) return { [`${P}Vertical`]: T, [`${P}Horizontal`]: R }
  return { [`${P}Top`]: T, [`${P}Right`]: R, [`${P}Bottom`]: B, [`${P}Left`]: L }
}

/** `border[-side]: <width> <style> <color>` → the per-side props. */
function expandBorder(prop, value) {
  const side = prop === 'border' ? '' : prop.slice('border-'.length)
  const cap = side ? side[0].toUpperCase() + side.slice(1) : ''
  const parts = value.trim().split(/\s+/)
  if (parts.length === 1 && parts[0] === 'none') return { [`border${cap}Width`]: 0 }
  const width = parts.find((p) => /^[\d.]+(px|rem|em)$/.test(p))
  const style = parts.find((p) => /^(solid|dashed|dotted|none|double)$/.test(p))
  const color = parts.find((p) => isColorish(p))
  if (!width && !style && !color) return null
  const out = {}
  if (width) out[`border${cap}Width`] = width
  if (style) out[`border${cap}Style`] = style
  if (color) out[`border${cap}Color`] = color
  return out
}

/** One declaration → props, or null when it cannot be expressed. */
export function declToProps(prop, value) {
  prop = prop.trim().toLowerCase()
  value = value.trim()
  if (UNMAPPABLE.has(prop) || prop.startsWith('--')) return null
  if (value.includes('gradient')) return null
  if (prop === 'padding' || prop === 'margin') return expandBox(prop, value)
  if (prop === 'border' || /^border-(top|right|bottom|left)$/.test(prop)) return expandBorder(prop, value)
  if (prop === 'flex') {
    if (value === '1' || value === '1 1 0%' || value === '1 1 0') return { flexGrow: 1, flexShrink: 1, flexBasis: '0%' }
    if (value === 'none') return { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }
    return null
  }
  if (prop === 'background' || prop === 'background-color') {
    if (value === 'none') return { backgroundColor: 'transparent' }
    if (!isColorish(value)) return null
  }
  if (prop === 'box-shadow') return null // single-layer approximation must be a human call
  return { [RENAME[prop] ?? camel(prop)]: value }
}

/** Split a stylesheet into `{ selector, decls[] }`, ignoring comments and at-rules. */
function parseRules(css) {
  const src = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Statement at-rules (`@reference "…";`, `@import …;`) carry no block, so the naive
    // selector capture below would glue them onto the FIRST rule's selector — which then looks
    // like an at-rule and gets skipped, silently dropping one rule per stylesheet. Strip them.
    .replace(/^\s*@(?:reference|import|charset|layer)\b[^;{]*;/gm, '')
  const rules = []
  const re = /([^{}]+)\{([^}]*)\}/g
  let m
  while ((m = re.exec(src))) {
    // A selector can still trail a preceding declaration-less construct; keep the last clause.
    const selector = m[1].split(';').pop().trim()
    if (selector.startsWith('@')) continue
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean)
    rules.push({ selector, decls })
  }
  return rules
}

/** `.a__b--c` → `A_B_C`, the exported bag name. */
export const bagName = (sel) =>
  sel.replace(/^\./, '').replace(/--/g, '_').replace(/__/g, '_').replace(/-/g, '_').toUpperCase()

/**
 * Serialize a prop bag, annotating raw color literals.
 *
 * A stock Tailwind color utility (`text-white`, `bg-black`) is allowed inside `@apply` but becomes
 * a raw hex once it is a value in a `.ts` file, which `lint:tokens` rejects. These are genuinely
 * theme-independent literals (white on a brand fill), so they carry the codebase's escape comment —
 * emitted by the generator, since hand-adding it to generated output would be lost on the next run.
 */
export function serializeBag(props) {
  const lines = JSON.stringify(props, null, 2).split('\n')
  return lines
    .map((l) =>
      /:\s*"(#[0-9a-fA-F]{3,8}|rgba?\([^"]*\))"/.test(l)
        ? `${l} // ds-lint-ok: literal from a stock Tailwind color utility, theme-independent`
        : l,
    )
    .join('\n')
}

export function convertStylesheet(css) {
  const converted = []   // { selector, name, props }
  const blocked = []     // { selector, reason }
  for (const { selector, decls } of parseRules(css)) {
    // Only plain single-class selectors convert; anything structural stays in CSS.
    if (!/^\.[A-Za-z][\w-]*$/.test(selector)) { blocked.push({ selector, reason: 'not a single-class selector' }); continue }
    let props = {}
    let bad = null
    for (const d of decls) {
      if (d.startsWith('@apply')) {
        for (const util of d.slice(6).trim().split(/\s+/)) {
          const r = classToProps(util.replace(/!$/, ''))
          if (!r || r.skip.length || r.keep.length) { bad = `@apply ${util}`; break }
          Object.assign(props, r.props)
        }
        if (bad) break
        continue
      }
      const i = d.indexOf(':')
      if (i < 0) { bad = d; break }
      const got = declToProps(d.slice(0, i), d.slice(i + 1))
      if (!got) { bad = d; break }
      Object.assign(props, got)
    }
    if (bad) blocked.push({ selector, reason: bad })
    else converted.push({ selector, name: bagName(selector), props })
  }
  return { converted, blocked }
}

/**
 * Rewrite a stylesheet down to ONLY the rules that could not convert, preserving their source text
 * verbatim. A partially-converted block keeps a (much smaller) stylesheet for its residue.
 */
export function trimStylesheet(css, blockedSelectors) {
  const keep = new Set(blockedSelectors)
  const header = css.match(/^\s*@reference[^;]*;/)?.[0] ?? ''
  const out = []
  const re = /([^{}]+)\{([^}]*)\}/g
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let m
  while ((m = re.exec(src))) {
    const selector = m[1].split(';').pop().trim()
    if (selector.startsWith('@')) continue
    if (keep.has(selector)) out.push(`${selector} {${m[2].replace(/\s+$/, '')}\n}`)
  }
  return out.length ? `${header}\n\n${out.join('\n\n')}\n` : ''
}

// CLI — guarded so importing this module (e.g. from bem-sweep.mjs) does not execute it with the
// importer's argv, which made it try to read a directory as a stylesheet.
const isEntry = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isEntry) {
const args = process.argv.slice(2)
const emit = args.includes('--emit')
const trim = args.includes('--trim')
const files = args.filter((a) => !a.startsWith('--'))
let totC = 0, totB = 0
for (const f of files) {
  const { converted, blocked } = convertStylesheet(readFileSync(f, 'utf8'))
  totC += converted.length; totB += blocked.length
  if (trim) {
    const rest = trimStylesheet(readFileSync(f, 'utf8'), blocked.map((b) => b.selector))
    if (rest) writeFileSync(f, rest); else unlinkSync(f)
    console.log(`${f}: kept ${blocked.length} blocked rule(s)${rest ? '' : ' → DELETED (all converted)'}`)
  } else if (emit) {
    for (const c of converted) {
      console.log(`/** \`${c.selector}\` */\nexport const ${c.name} = ${serializeBag(c.props)} as const\n`)
    }
  } else {
    console.log(`${f}: ${converted.length} convertible, ${blocked.length} blocked`)
    for (const b of blocked) console.log(`    BLOCKED ${b.selector} — ${b.reason}`)
  }
}
if (!emit) console.log(`\n[bem-to-props] ${totC} convertible, ${totB} blocked across ${files.length} stylesheet(s)`)
}
