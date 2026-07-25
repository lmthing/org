/**
 * classnames-to-props-map.mjs — the pure utility→prop translation table for the P3 codemod
 * (docs/tamagui-idiomatic-migration.md §5). NO filesystem / AST deps so it is unit-tested
 * directly (classnames-to-props.test.mjs) — the objective correctness gate that lets the
 * class→prop rewrite be trusted at 1281-usage scale without a human eyeballing every diff.
 *
 * `classToProps(className)` splits a static Tailwind class string and returns:
 *   { props, keep, skip }
 *     props — Tamagui style props to add (base + variant-nested style objects).
 *     keep  — classes deliberately left as className (no faithful prop, e.g. an alpha modifier
 *             or an animation that needs a driver) — the app still styles them via theme.css
 *             until theme.css is deleted last (§5 strangler-fig).
 *     skip  — classes the codemod could not map AND that must be reviewed by a human.
 *
 * The `$token` names line up 1:1 with the generated Tamagui scales (SPIKE B): `p-4 → $4`,
 * `text-sm → $sm`, `font-bold → $bold`, `rounded-xl → $radius-xl`, `bg-foreground → $foreground`.
 */

// ── scales the tokens reference (must match libs/css tamagui-tokens.mjs) ─────────────────────
/** Tailwind's unitless `leading-*` keywords → their literal ratios. */
const LEADING = { none: 1, tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625, loose: 2 }

const SPACE_KEYS = new Set([
  '0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '7', '8', '9', '10', '11', '12',
  '14', '16', '20', '24', '28', '32', '36', '40', '44', '48', '52', '56', '60', '64', '72', '80',
  '96', 'px',
])
const FONT_SIZES = new Set(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'])
const FONT_WEIGHTS = {
  thin: 'thin', extralight: 'extralight', light: 'light', normal: 'normal', medium: 'medium',
  semibold: 'semibold', bold: 'bold', extrabold: 'extrabold', black: 'black',
}
const TRACKING = new Set(['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'])
const RADII = { none: 0, sm: '$radius-sm', DEFAULT: '$radius', md: '$radius-md', lg: '$radius-lg', xl: '$radius-xl', '2xl': '$radius-xl', '3xl': '$radius-xl', full: '$radius-full' }
// Tailwind max-width scale (rem→px). Not the spacing scale, so a dedicated map.
const MAX_WIDTH = { none: 'none', xs: 320, sm: 384, md: 448, lg: 512, xl: 576, '2xl': 672, '3xl': 768, '4xl': 896, '5xl': 1024, '6xl': 1152, '7xl': 1280, full: '100%', min: 'min-content', max: 'max-content', fit: 'fit-content', prose: 672 }

const ALIGN = { start: 'flex-start', end: 'flex-end', center: 'center', between: 'space-between', around: 'space-around', evenly: 'space-evenly', stretch: 'stretch', baseline: 'baseline' }
const ITEMS = { start: 'flex-start', end: 'flex-end', center: 'center', baseline: 'baseline', stretch: 'stretch' }
// Tailwind's cursor utilities are named after the CSS keyword, so `cursor-<kw>` → `cursor: '<kw>'`
// for the whole family. Listed explicitly so a typo'd class is REPORTED, not passed through.
// Tailwind duration → the animation driver's transition NAME. Only the durations the surfaces
// actually used are mapped; anything else is reported rather than rounded to the nearest name.
const DURATION_NAME = { 0: 'none', 150: 'quick', 200: 'medium', 300: 'slow' }
const CURSORS = new Set([
  'auto', 'default', 'pointer', 'wait', 'text', 'move', 'help', 'not-allowed', 'none',
  'context-menu', 'progress', 'cell', 'crosshair', 'vertical-text', 'alias', 'copy', 'no-drop',
  'grab', 'grabbing', 'all-scroll', 'col-resize', 'row-resize', 'n-resize', 'e-resize', 's-resize',
  'w-resize', 'ne-resize', 'nw-resize', 'se-resize', 'sw-resize', 'ew-resize', 'ns-resize',
  'nesw-resize', 'nwse-resize', 'zoom-in', 'zoom-out',
])
// `rounded-{side}-*` corner groups → the Tamagui per-corner props.
const RADIUS_SIDES = {
  t: ['borderTopLeftRadius', 'borderTopRightRadius'],
  r: ['borderTopRightRadius', 'borderBottomRightRadius'],
  b: ['borderBottomLeftRadius', 'borderBottomRightRadius'],
  l: ['borderTopLeftRadius', 'borderBottomLeftRadius'],
  tl: ['borderTopLeftRadius'],
  tr: ['borderTopRightRadius'],
  bl: ['borderBottomLeftRadius'],
  br: ['borderBottomRightRadius'],
}

// A design-token color name → `$token`. Everything the parity test proves exists.
// (We don't hard-code the list; any bg-/text-/border- value that is a bare token name maps to
//  `$name`, an arbitrary `[..]` maps to a literal, and an alpha `/NN` modifier is kept.)
const isArbitrary = (v) => /^\[.+\]$/.test(v)
const arbitraryValue = (v) => v.slice(1, -1).replace(/_/g, ' ')

/** Space token: numeric/px/half-steps → `$key`; `[10px]` → literal; else null (skip). */
function spaceToken(raw) {
  if (raw === 'auto') return 'auto'
  if (isArbitrary(raw)) return arbitraryValue(raw)
  if (SPACE_KEYS.has(raw)) return `$${raw}`
  return null
}

function sizeToken(raw) {
  if (isArbitrary(raw)) return arbitraryValue(raw)
  if (raw === 'full') return '100%'
  if (raw === 'screen') return '100vh'
  if (raw === 'auto') return 'auto'
  // Intrinsic sizing keywords — `w-fit`, `h-min`, `w-max`.
  if (raw === 'fit') return 'fit-content'
  if (raw === 'min') return 'min-content'
  if (raw === 'max') return 'max-content'
  if (SPACE_KEYS.has(raw)) return `$${raw}`
  const frac = raw.match(/^(\d+)\/(\d+)$/)
  if (frac) return `${((Number(frac[1]) / Number(frac[2])) * 100).toFixed(6).replace(/\.?0+$/, '')}%`
  return null
}

/** color value → prop value. token name → `$name`; `[..]` → literal; alpha `/NN` → null (keep). */
function colorToken(raw) {
  // Alpha modifier (`bg-primary/20`, `border-agent/50`). There is no `$token/NN` form, but the
  // element conversions all express it the same way — a web `color-mix` over the underlying CSS
  // var (see Badge `success`, Button `primary` hover, AppLinks hover). Emit that, so the codemod
  // and the hand-written elements agree. `lm-*` works here too: its var is what gets mixed.
  if (raw.includes('/')) {
    const [name, pct] = raw.split('/')
    if (!/^\d+$/.test(pct) || isArbitrary(name)) return null
    if (/^(inherit|current|transparent)$/.test(name)) return null
    // `black`/`white` have no CSS var to mix, so the value would be a raw literal that
    // `lint:tokens` rejects in a `.tsx` (and a codemod cannot emit the `ds-lint-ok` escape into a
    // JSX attribute). The only use is the `bg-black/50` dialog wash, already hand-written on the
    // Dialog element with the escape. Keep those.
    if (/^(white|black)$/.test(name)) return null
    return `color-mix(in srgb, var(--${name}) ${pct}%, transparent)`
  }
  if (isArbitrary(raw)) return arbitraryValue(raw)
  if (/^(inherit|current|transparent|white|black)$/.test(raw)) {
    return { inherit: 'inherit', current: 'currentColor', transparent: 'transparent', white: '#fff', black: '#000' }[raw]
  }
  // `lm-*` is the runtime per-space palette. It is NOT a Tamagui token — `$lm-accent` resolves to
  // nothing — and it must NOT be rewritten to the token it happens to alias today
  // (`--lm-accent: var(--agent)`), because `applyThemeTokens` (theme.ts) overrides `--lm-*`
  // directly from a space's theme.json: mapping to `$agent` would silently disconnect per-space
  // theming. Emit the CSS var instead. Tamagui accepts a raw `var(...)` string on web — that is
  // exactly the SPIKE-A1 mechanism the colour tokens themselves use — so the class becomes a prop
  // while the runtime override keeps working.
  if (/^lm-/.test(raw)) return `var(--${raw})`
  return `$${raw}`
}

// Static single-class → { prop: value } (base, no variant). Returns:
//   object  → props to set
//   'keep'  → leave as className (faithful, but base-fought / paint kept during coexistence)
//   null    → unmapped, report for manual review
function baseClass(cls) {
  let m0
  // `!important` prefix (`!hidden`, `!flex`, `md:!hidden`). These exist ONLY to out-specify
  // Tamagui's own unlayered `.is_Box { display:flex }` base rule — a problem a style PROP does not
  // have, because props always beat classes. So strip the bang and map the rest; if the remainder
  // is itself unmapped the caller still reports/keeps the ORIGINAL token, bang included.
  if (cls.startsWith('!')) return baseClass(cls.slice(1))

  // display
  const DISPLAY ={ block: 'block', 'inline-block': 'inline-block', inline: 'inline', flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid', 'inline-grid': 'inline-grid', hidden: 'none', contents: 'contents' }
  if (cls in DISPLAY) return { display: DISPLAY[cls] }

  // flex-direction / wrap
  if (cls === 'flex-row') return { flexDirection: 'row' }
  if (cls === 'flex-row-reverse') return { flexDirection: 'row-reverse' }
  if (cls === 'flex-col') return { flexDirection: 'column' }
  if (cls === 'flex-col-reverse') return { flexDirection: 'column-reverse' }
  if (cls === 'flex-wrap') return { flexWrap: 'wrap' }
  if (cls === 'flex-nowrap') return { flexWrap: 'nowrap' }
  if (cls === 'flex-wrap-reverse') return { flexWrap: 'wrap-reverse' }
  if (cls === 'flex-1') return { flexGrow: 1, flexShrink: 1, flexBasis: '0%' }
  if (cls === 'flex-auto') return { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' }
  if (cls === 'flex-initial') return { flexGrow: 0, flexShrink: 1, flexBasis: 'auto' }
  if (cls === 'flex-none') return { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }
  if (cls === 'grow') return { flexGrow: 1 }
  if (cls === 'grow-0') return { flexGrow: 0 }
  if (cls === 'shrink') return { flexShrink: 1 }
  if (cls === 'shrink-0') return { flexShrink: 0 }
  // Legacy Tailwind v2/v3 spellings still present in the surfaces.
  if (cls === 'flex-shrink-0') return { flexShrink: 0 }
  if (cls === 'flex-shrink') return { flexShrink: 1 }
  if (cls === 'flex-grow-0') return { flexGrow: 0 }
  if (cls === 'flex-grow') return { flexGrow: 1 }

  // `shadow-*` → the SAME single-layer Tamagui approximations the hand conversions used for
  // card/dialog/dropdown/sheet, so the codemod and those elements stay consistent. Shadow black
  // follows the codebase's opaque-black-with-alpha convention (theme-independent, not a token).
  if (cls === 'shadow-none') return { shadowColor: 'transparent', shadowRadius: 0 }
  if (cls === 'shadow-sm') return { shadowColor: 'rgba(0,0,0,0.05)', shadowOffset: { width: 0, height: 1 }, shadowRadius: 2 }
  if (cls === 'shadow' || cls === 'shadow-md') return { shadowColor: 'rgba(0,0,0,0.1)', shadowOffset: { width: 0, height: 4 }, shadowRadius: 6 }
  if (cls === 'shadow-lg') return { shadowColor: 'rgba(0,0,0,0.1)', shadowOffset: { width: 0, height: 10 }, shadowRadius: 15 }
  if (cls === 'shadow-xl') return { shadowColor: 'rgba(0,0,0,0.1)', shadowOffset: { width: 0, height: 20 }, shadowRadius: 25 }

  // text flow — `whiteSpace` is a real Tamagui web style prop (the primitives already type it),
  // and the codemod needs it because `.is_Text` sets `white-space` unlayered, so a class loses.
  if (cls === 'whitespace-normal') return { whiteSpace: 'normal' }
  if (cls === 'whitespace-nowrap') return { whiteSpace: 'nowrap' }
  if (cls === 'whitespace-pre') return { whiteSpace: 'pre' }
  if (cls === 'whitespace-pre-wrap') return { whiteSpace: 'pre-wrap' }
  if (cls === 'whitespace-pre-line') return { whiteSpace: 'pre-line' }
  if (cls === 'whitespace-break-spaces') return { whiteSpace: 'break-spaces' }
  if (cls === 'outline-none') return { outlineWidth: 0, outlineStyle: 'none' }
  if (cls === 'resize') return { resize: 'both' }
  if (cls === 'resize-y') return { resize: 'vertical' }
  if (cls === 'resize-x') return { resize: 'horizontal' }
  if (cls === 'resize-none') return { resize: 'none' }

  // misc single-value utilities. `cursor` is a real Tamagui web style prop (`_cur-<value>`), and
  // every Tailwind cursor utility is named after its CSS keyword, so the whole family maps 1:1.
  const cur = cls.match(/^cursor-(.+)$/)
  if (cur && CURSORS.has(cur[1])) return { cursor: cur[1] }
  if (cls === 'select-none') return { userSelect: 'none' }
  if (cls === 'select-text') return { userSelect: 'text' }
  if (cls === 'pointer-events-none') return { pointerEvents: 'none' }
  if (cls === 'pointer-events-auto') return { pointerEvents: 'auto' }
  if (cls === 'object-cover') return { objectFit: 'cover' }
  if (cls === 'object-contain') return { objectFit: 'contain' }

  // alignment
  let m
  if ((m = cls.match(/^size-(.+)$/)) && SPACE_KEYS.has(m[1])) return { width: `$${m[1]}`, height: `$${m[1]}` }
  if ((m = cls.match(/^items-(\w+)$/)) && ITEMS[m[1]]) return { alignItems: ITEMS[m[1]] }
  if ((m = cls.match(/^justify-(\w+)$/)) && ALIGN[m[1]]) return { justifyContent: ALIGN[m[1]] }
  if ((m = cls.match(/^self-(\w+)$/)) && (m[1] === 'auto' ? true : ITEMS[m[1]])) return { alignSelf: m[1] === 'auto' ? 'auto' : ITEMS[m[1]] }
  if ((m = cls.match(/^content-(\w+)$/)) && ALIGN[m[1]]) return { alignContent: ALIGN[m[1]] }

  // gap / padding / margin
  if ((m = cls.match(/^gap-x-(.+)$/))) { const v = spaceToken(m[1]); return v == null ? null : { columnGap: v } }
  if ((m = cls.match(/^gap-y-(.+)$/))) { const v = spaceToken(m[1]); return v == null ? null : { rowGap: v } }
  if ((m = cls.match(/^gap-(.+)$/))) { const v = spaceToken(m[1]); return v == null ? null : { gap: v } }
  const PAD = { p: 'padding', px: 'paddingHorizontal', py: 'paddingVertical', pt: 'paddingTop', pr: 'paddingRight', pb: 'paddingBottom', pl: 'paddingLeft', ps: 'paddingStart', pe: 'paddingEnd' }
  const MAR = { m: 'margin', mx: 'marginHorizontal', my: 'marginVertical', mt: 'marginTop', mr: 'marginRight', mb: 'marginBottom', ml: 'marginLeft', ms: 'marginStart', me: 'marginEnd' }
  if ((m = cls.match(/^(-?)(p[xytrbles]?)-(.+)$/)) && PAD[m[2]]) { const v = spaceToken(m[3]); return v == null ? null : { [PAD[m[2]]]: m[1] ? negate(v) : v } }
  if ((m = cls.match(/^(-?)(m[xytrbles]?)-(.+)$/)) && MAR[m[2]]) { const v = spaceToken(m[3]); return v == null ? null : { [MAR[m[2]]]: m[1] ? negate(v) : v } }

  // width / height / min / max
  if ((m = cls.match(/^w-(.+)$/))) { const v = sizeToken(m[1]); return v == null ? null : { width: v } }
  if ((m = cls.match(/^h-(.+)$/))) { const v = sizeToken(m[1]); return v == null ? null : { height: v } }
  if ((m = cls.match(/^min-w-(.+)$/))) { const v = m[1] === '0' ? 0 : sizeToken(m[1]); return v == null ? null : { minWidth: v } }
  if ((m = cls.match(/^min-h-(.+)$/))) { const v = m[1] === '0' ? 0 : sizeToken(m[1]); return v == null ? null : { minHeight: v } }
  if ((m = cls.match(/^max-w-(.+)$/))) { const v = m[1] in MAX_WIDTH ? MAX_WIDTH[m[1]] : (isArbitrary(m[1]) ? arbitraryValue(m[1]) : null); return v == null ? null : { maxWidth: v } }
  if ((m = cls.match(/^max-h-(.+)$/))) { const v = sizeToken(m[1]); return v == null ? null : { maxHeight: v } }

  // colors
  if ((m = cls.match(/^bg-(.+)$/))) { const v = colorToken(m[1]); return v == null ? 'keep' : { backgroundColor: v } }
  if ((m = cls.match(/^text-(.+)$/))) {
    // text-* is overloaded: size, color, or alignment.
    if (FONT_SIZES.has(m[1])) return { fontSize: `$${m[1]}` }
    if (['left', 'center', 'right', 'justify', 'start', 'end'].includes(m[1])) return { textAlign: m[1] }
    // An ARBITRARY value is overloaded the same way: `text-[11px]` is a size, `text-[#fff]` is a
    // colour. Falling straight through to the colour branch produced `color="11px"` — invalid CSS
    // that the browser drops, AND the font size silently lost. 31 of those shipped.
    if (isArbitrary(m[1])) {
      const v = arbitraryValue(m[1])
      return /^-?[\d.]+(px|rem|em|%|pt|ch|ex|vw|vh)?$/.test(v) ? { fontSize: v } : { color: v }
    }
    const v = colorToken(m[1]); return v == null ? 'keep' : { color: v }
  }
  // border WIDTH — `border` | `border-{0,2,4,8}` | directional `border-{t,r,b,l,x,y}(-{0,2,4,8})?`.
  // Must run BEFORE the border-<color> fallback, else `border-t` is misread as the color token `$t`.
  if ((m = cls.match(/^border(?:-([trblxy]))?(?:-(\d+))?$/))) {
    const W = { '0': 0, '1': 1, '2': 2, '4': 4, '8': 8 }
    const side = m[1]
    const w = m[2] == null ? 1 : (m[2] in W ? W[m[2]] : null)
    if (w == null) return 'keep'
    if (!side) return { borderWidth: w }
    const SIDES = {
      t: ['borderTopWidth'], r: ['borderRightWidth'], b: ['borderBottomWidth'], l: ['borderLeftWidth'],
      x: ['borderLeftWidth', 'borderRightWidth'], y: ['borderTopWidth', 'borderBottomWidth'],
    }
    const out = {}; for (const k of SIDES[side]) out[k] = w; return out
  }
  // border COLOR — `border-<token>` (bare token name → $token, else keep).
  if ((m = cls.match(/^border-(.+)$/))) {
    const v = colorToken(m[1]); return v == null ? 'keep' : { borderColor: v }
  }

  // typography
  if ((m = cls.match(/^font-(\w+)$/))) {
    if (m[1] in FONT_WEIGHTS) return { fontWeight: `$${FONT_WEIGHTS[m[1]]}` }
    if (['sans', 'display', 'mono', 'body', 'heading'].includes(m[1])) {
      const fam = { sans: '$body', body: '$body', display: '$heading', heading: '$heading', mono: '$mono' }[m[1]]
      return { fontFamily: fam }
    }
    return null
  }
  // `leading-*` is either the numeric $space scale, an arbitrary value, or one of Tailwind's
  // unitless keywords — the keywords have no token, so they map to their literal ratio.
  if ((m = cls.match(/^leading-(.+)$/))) {
    if (SPACE_KEYS.has(m[1])) return { lineHeight: `$${m[1]}` }
    if (isArbitrary(m[1])) return { lineHeight: arbitraryValue(m[1]) }
    if (LEADING[m[1]] !== undefined) return { lineHeight: LEADING[m[1]] }
    return null
  }
  if ((m = cls.match(/^tracking-(\w+)$/)) && TRACKING.has(m[1])) return { letterSpacing: `$${m[1]}` }
  if (cls === 'uppercase') return { textTransform: 'uppercase' }
  if (cls === 'lowercase') return { textTransform: 'lowercase' }
  if (cls === 'capitalize') return { textTransform: 'capitalize' }
  if (cls === 'normal-case') return { textTransform: 'none' }
  if (cls === 'italic') return { fontStyle: 'italic' }
  if (cls === 'not-italic') return { fontStyle: 'normal' }
  if (cls === 'underline') return { textDecorationLine: 'underline' }
  if (cls === 'line-through') return { textDecorationLine: 'line-through' }
  if (cls === 'no-underline') return { textDecorationLine: 'none' }
  if (cls === 'truncate') return { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
  // `wordWrap` IS a Tamagui style prop (`_ww-…`) — `wordBreak` and `listStyleType` are NOT, and are
  // silently dropped, so they stay unmapped and get an inline `style` by hand. Verified in
  // `elements/primitives/index.test.tsx`.
  if (cls === 'break-words') return { wordWrap: 'break-word' }
  if (cls === 'break-normal') return { wordWrap: 'normal' }
  // `line-clamp-N` needs the `-webkit-box` triple. Tamagui passes `Webkit*` keys straight through
  // to its atomic CSS (also verified), so the whole utility converts.
  if ((m = cls.match(/^line-clamp-(\d+)$/))) {
    return { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: Number(m[1]), overflow: 'hidden' }
  }
  if (cls === 'line-clamp-none') return { WebkitLineClamp: 'none' }

  // grid — `gridTemplateColumns` is a real Tamagui web style prop (verified). Tailwind's numeric
  // form expands to its own `repeat()`; the arbitrary form passes its value through.
  if ((m = cls.match(/^grid-cols-\[(.+)\]$/))) return { gridTemplateColumns: arbitraryValue(`[${m[1]}]`) }
  if ((m = cls.match(/^grid-cols-(\d+)$/))) return { gridTemplateColumns: `repeat(${m[1]}, minmax(0, 1fr))` }
  if (cls === 'grid-cols-none') return { gridTemplateColumns: 'none' }
  if ((m = cls.match(/^grid-rows-(\d+)$/))) return { gridTemplateRows: `repeat(${m[1]}, minmax(0, 1fr))` }

  // `translate-{x,y}-*` → the `transform` string prop (`_tr-…`, verified). ONE axis per element:
  // two translate utilities on the same element would overwrite each other here, so the second is
  // reported rather than silently lost — see the guard in `applyBase`.
  if ((m = cls.match(/^(-?)translate-(x|y)-(.+)$/))) {
    const v = sizeToken(m[3])
    return v == null ? null : { transform: `translate${m[2].toUpperCase()}(${m[1] ? negate(v) : v})` }
  }

  // radius / border-radius — whole box, one corner group, or an arbitrary value.
  if ((m = cls.match(/^rounded-\[(.+)\]$/))) return { borderRadius: arbitraryValue(`[${m[1]}]`) }
  if ((m = cls.match(/^rounded-(t|r|b|l|tl|tr|bl|br)(-(\w+))?$/))) {
    const key = m[3] || 'DEFAULT'
    if (!(key in RADII)) return null
    return Object.fromEntries(RADIUS_SIDES[m[1]].map((p) => [p, RADII[key]]))
  }
  if ((m = cls.match(/^rounded(-(\w+))?$/))) { const key = m[2] || 'DEFAULT'; if (key in RADII) return { borderRadius: RADII[key] }; return null }

  // position / inset / z
  if (['absolute', 'relative', 'fixed', 'sticky', 'static'].includes(cls)) return { position: cls }
  const POS = { top: 'top', right: 'right', bottom: 'bottom', left: 'left' }
  // `sizeToken`, not `spaceToken`: insets take fractions too (`left-1/2` → `50%`).
  if ((m = cls.match(/^(-?)(top|right|bottom|left)-(.+)$/))) { const v = sizeToken(m[3]); return v == null ? null : { [POS[m[2]]]: m[1] ? negate(v) : v } }
  if ((m = cls.match(/^(-?)inset-(.+)$/))) { const v = m[2] === 'full' ? '100%' : spaceToken(m[2]); return v == null ? null : { top: v, right: v, bottom: v, left: v } }
  if ((m = cls.match(/^z-(\d+|auto)$/))) return { zIndex: m[1] === 'auto' ? 'auto' : Number(m[1]) }

  // overflow / opacity
  if ((m = cls.match(/^overflow-(auto|hidden|visible|scroll)$/))) return { overflow: m[1] }
  if ((m = cls.match(/^overflow-x-(auto|hidden|visible|scroll)$/))) return { overflowX: m[1] }
  if ((m = cls.match(/^overflow-y-(auto|hidden|visible|scroll)$/))) return { overflowY: m[1] }
  if ((m = cls.match(/^opacity-(\d+)$/))) return { opacity: Number(m[1]) / 100 }

  // `ring-*` → the outline props the element conversions already use for focus rings
  // (`Button`/`Input`/`Select` all write `focusVisibleStyle: { outlineWidth, outlineStyle,
  // outlineColor }`). Tailwind implements a ring as a box-shadow; an outline is the faithful
  // Tamagui form and is what this codebase standardised on by hand.
  if (cls === 'ring') return { outlineWidth: 3, outlineStyle: 'solid' }
  if ((m = cls.match(/^ring-(\d+)$/))) return { outlineWidth: Number(m[1]), outlineStyle: 'solid' }
  if ((m = cls.match(/^ring-offset-(\d+)$/))) return { outlineOffset: Number(m[1]) }
  if ((m = cls.match(/^ring-(.+)$/))) { const v = colorToken(m[1]); return v == null ? null : { outlineColor: v } }

  // arbitrary tracking — `tracking-[0.16em]`
  if ((m = cls.match(/^tracking-\[(.+)\]$/))) return { letterSpacing: m[1] }

  // ── KNOWN-unmappable → 'keep', not null ────────────────────────────────────────────────────
  //
  // The difference matters: `null` means "unrecognised", and the transform bails on the WHOLE
  // element so a human migrates it deliberately. `'keep'` means "recognised, and deliberately
  // staying as a className for now" — the element still migrates, this class just rides along.
  //
  // These families were all falling through to `null`, which held the mappable classes BESIDE
  // them hostage: `text-sm px-3 rounded-lg transition-colors` migrated nothing because of the
  // last token. They are all classes this migration has consciously deferred, and Tailwind still
  // ships their CSS, so keeping them is faithful.
  // `transition-*` / `duration-*` → the animation driver's named transition. The names mirror the
  // Tailwind durations 1:1 (`quick` 150ms = Tailwind's default, `medium` 200ms, `slow` 300ms), so
  // this is a rename rather than a redesign. `duration-*` only sets the NAME, which is why it is
  // merged rather than emitted as its own prop; a `duration` without a `transition-*` beside it is
  // meaningless and stays reported.
  if (cls === 'transition' || cls === 'transition-all') return { transition: 'quick' }
  if (cls === 'transition-colors') {
    return { transition: 'quick', animateOnly: ['color', 'background-color', 'border-color'] }
  }
  if (cls === 'transition-opacity') return { transition: 'quick', animateOnly: ['opacity'] }
  if (cls === 'transition-transform') return { transition: 'quick', animateOnly: ['transform'] }
  if (cls === 'transition-shadow') return { transition: 'quick', animateOnly: ['box-shadow'] }
  if (cls === 'transition-none') return { transition: 'none' }
  if ((m0 = cls.match(/^duration-(\d+)$/))) {
    const name = DURATION_NAME[m0[1]]
    return name ? { transition: name } : null
  }
  // `ease-*`/`delay-*` have no prop form — the driver's easing is baked into the named transition.
  if (/^(ease|delay)(-|$)/.test(cls)) return 'keep'
  if (/^animate(-|$)/.test(cls)) return 'keep'   // keyframes are not the driver's job (§5)
  if (/^lm-/.test(cls)) return 'keep'                                             // runtime `--lm-*` palette / keyframes
  if (/^prose(-|$)/.test(cls)) return 'keep'                                      // @tailwindcss/typography, styles injected HTML
  if (/^(space-[xy])-/.test(cls)) return 'keep'                                   // child margins, NOT `gap` — different semantics
  if (/^(backdrop-)?(blur|filter|brightness|contrast|saturate)(-|$)/.test(cls)) return 'keep'
  if (cls === 'group' || /^group-/.test(cls)) return 'keep'                       // Tailwind group-hover; Tamagui `group` is a separate rewrite
  if (cls === 'sr-only' || cls === 'not-sr-only') return 'keep'

  return null
}

function negate(v) {
  if (typeof v === 'number') return -v
  if (typeof v === 'string' && v.startsWith('$')) return `-${v}`
  if (typeof v === 'string' && /^\d/.test(v)) return `-${v}`
  return v
}

// variant prefix → how it nests. `null` value means "handled specially below".
const VARIANT_STYLE = {
  hover: 'hoverStyle',
  focus: 'focusStyle',
  'focus-visible': 'focusVisibleStyle',
  'focus-within': 'focusWithinStyle',
  active: 'pressStyle',
  disabled: 'disabledStyle',
}
// Tailwind breakpoint → Tamagui media prop (mobile-first min-width, 1:1 by name — SPIKE B).
const MEDIA = { sm: '$sm', md: '$md', lg: '$lg', xl: '$xl', '2xl': '$xxl' }

/**
 * Translate a full (static) className string. Variant-prefixed classes route into nested style
 * objects (`hoverStyle`, `$gtSm`, …); `dark:` classes are dropped (the `$token` already flips with
 * the theme) unless they set a value that differs in dark — those are reported for a `dark`
 * sub-theme (rare) — here we KEEP them so the theme.css `dark:` rule keeps applying meanwhile.
 */
export function classToProps(className) {
  const props = {}
  const keep = []
  const skip = []
  const nested = {} // styleKey → { prop: val }

  for (const raw of className.split(/\s+/).filter(Boolean)) {
    const colon = raw.indexOf(':')
    if (colon === -1) {
      applyBase(raw, props, keep, skip)
      continue
    }
    const variant = raw.slice(0, colon)
    const rest = raw.slice(colon + 1)
    if (variant === 'dark') {
      // `$token` colors flip with the theme automatically; keep dark: overrides on className so the
      // theme.css rule keeps applying until a `dark` sub-theme is authored (§5).
      keep.push(raw)
      continue
    }
    // `placeholder:` is not a nested style object — Tamagui exposes the pseudo-element as a single
    // prop (`placeholderTextColor`), which the form-control primitives translate to the CSS var
    // Tamagui's own `.is_Input::placeholder` rule reads. So `placeholder:text-muted-foreground`
    // becomes a flat prop, not a `placeholderStyle` bag.
    if (variant === 'placeholder') {
      const c = rest.match(/^text-(.+)$/)
      const v = c && colorToken(c[1])
      if (v) props.placeholderTextColor = v
      else skip.push(raw)
      continue
    }
    if (variant in VARIANT_STYLE) {
      const styleKey = VARIANT_STYLE[variant]
      const r = baseClass(rest)
      if (r && typeof r === 'object') Object.assign((nested[styleKey] ||= {}), r)
      else skip.push(raw) // 'keep'/null under a variant can't stay a plain className faithfully
      continue
    }
    if (variant in MEDIA) {
      const styleKey = MEDIA[variant]
      const r = baseClass(rest)
      if (r && typeof r === 'object') Object.assign((nested[styleKey] ||= {}), r)
      else skip.push(raw)
      continue
    }
    if (variant === 'group-hover') {
      // Tailwind's group-hover keys off the `group` CLASS on an ancestor; Tamagui's `$group-hover`
      // keys off a `group` PROP, which stamps a different marker (`t_group`). Converting the child
      // alone produces a selector that can never match — a silent, invisible-until-hovered break.
      // The parent is a separate element the codemod cannot reach, so report BOTH halves for a
      // deliberate hand migration. Proven in `elements/primitives/index.test.tsx`.
      skip.push(raw)
      continue
    }
    // `prose-<el>:` styles HTML the component does not author (@tailwindcss/typography descendant
    // selectors), so there is no element to put a prop on. The base `prose` class is already a
    // `keep`; its variants have to be too, or one of them holds the whole element hostage.
    if (/^prose-/.test(variant)) { keep.push(raw); continue }
    skip.push(raw) // unknown variant (peer-, aria-, data-, …) → manual
  }

  for (const [k, v] of Object.entries(nested)) props[k] = v
  return { props, keep, skip }
}

function applyBase(raw, props, keep, skip) {
  const r = baseClass(raw)
  if (r === 'keep') keep.push(raw)
  else if (r === null) skip.push(raw)
  else if (r.transform !== undefined && props.transform !== undefined) {
    // CSS composes multiple transforms in ONE declaration; a second `translate-*`/`rotate-*` on the
    // same element would overwrite the first here. Report it instead of losing it silently.
    skip.push(raw)
  } else Object.assign(props, r)
}

export const __internal = { baseClass, spaceToken, sizeToken, colorToken }
