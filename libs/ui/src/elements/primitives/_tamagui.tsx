import * as React from 'react'
// WEB primitives use the WEB config (empty theme → no theme-var injection; colors come from
// theme.css/Tailwind). The `*.native.tsx` forks use the colored `tamagui.config`. See tamagui.config.ts.
import { styled, View, createComponent } from '../../theme/tamagui.config'

/**
 * Shared factory for the WEB Tamagui primitives (Phase-1 / Part III of the migration).
 *
 * These replace the Phase-0 passthrough wrappers. Each is a `forwardRef` around a `styled(View|Text)`
 * so the surfaces keep the SAME import + a superset of the same prop shape: the DOM props they always
 * passed (`className`, `onClick`, `children`, `style`, `id`, `role`, `data-*`, `aria-*`, `ref`) PLUS
 * the Tamagui layout props the B2 codemod lifts out of Tailwind classes (`alignItems`,
 * `justifyContent`, `flexGrow/Shrink/Basis`, `flexWrap`, `minWidth`, `alignSelf`, …). Tamagui splits
 * style props from DOM props internally, so we can spread everything onto the styled component.
 *
 * WEB block-compat resets (`flexShrink:1`, `minWidth/minHeight:'auto'`) make a `<Row>` compute like a
 * `<div class="flex">` and `<Col>` like `<div class="flex flex-col">` (proven byte-for-byte in
 * `tests/visual/equivalence.spec.ts` and the `apps/web/b0-probe` surface slice). The `*.native.tsx`
 * forks keep the RN defaults. See docs/react-native-tamagui-migration.md Part III (B1/B2).
 *
 * Typing note: the styled components are cast to `React.ComponentType<any>` on purpose — the repo
 * carries both `@types/react@18` (libs/ui) and `@types/react@19` (hoisted for react-native), whose
 * `ReactNode` unions differ, which makes Tamagui's richly-typed components unusable as JSX under a
 * bare `tsc`. The public prop TYPE below is hand-declared so surfaces get real prop-checking.
 */

/** The Tamagui layout style-props the codemod may lift onto a primitive (curated, web + native). */
export type LayoutStyleProps = {
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline'
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline'
  flexWrap?: 'wrap' | 'nowrap' | 'wrap-reverse'
  flex?: number
  flexGrow?: number
  flexShrink?: number
  flexBasis?: number | string
  minWidth?: number | string
  minHeight?: number | string
  maxWidth?: number | string
  maxHeight?: number | string
  gap?: number | string
}

/**
 * A Tamagui pseudo-style object (`hoverStyle`/`pressStyle`/`focusStyle`/`focusVisibleStyle`/
 * `disabledStyle`) — a permissive bag of style props, so the manual `hover:`/`focus:`/`active:`/
 * `disabled:` variant migrations (§5) type-check without re-listing the whole style surface.
 */
export type PseudoStyleProps = { [prop: string]: string | number | undefined }

/**
 * The remaining Tamagui style props the P3 codemod (`classnames-to-props`) can lift onto a
 * primitive, on top of the layout/text/margin trio: spacing, dimensions, borders, colors, position,
 * per-face typography, transforms and the pseudo-style props. Values are `number | string` so a
 * literal (`width={200}`) and a `$token` (`padding="$4"`) both type-check. This is what widens the
 * primitives to the idiomatic Tamagui style-prop surface (docs/tamagui-idiomatic-migration.md §5/§6).
 * `display`/`whiteSpace`/`wordWrap`/`overflow*`/`textOverflow` deliberately stay in `TextStyleProps`
 * (their curated unions) — every primitive mixes BOTH, so the surfaces get the union there and the
 * open surface here without an intersection clash.
 */
export type BoxStyleProps = {
  // spacing (padding; margins live in MarginStyleProps)
  padding?: number | string
  paddingTop?: number | string
  paddingRight?: number | string
  paddingBottom?: number | string
  paddingLeft?: number | string
  paddingHorizontal?: number | string
  paddingVertical?: number | string
  paddingStart?: number | string
  paddingEnd?: number | string
  // dimensions
  width?: number | string
  height?: number | string
  // flex extras beyond LayoutStyleProps
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  alignContent?:
    | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'space-between' | 'space-around'
  columnGap?: number | string
  rowGap?: number | string
  // grid — real Tamagui web style props (`_gridTemplateColumns-…`), verified in index.test.tsx.
  // The codemod maps `grid-cols-*`/`grid-rows-*` onto them.
  gridTemplateColumns?: string
  gridTemplateRows?: string
  // borders
  borderWidth?: number | string
  borderTopWidth?: number | string
  borderRightWidth?: number | string
  borderBottomWidth?: number | string
  borderLeftWidth?: number | string
  borderColor?: string
  borderTopColor?: string
  borderRightColor?: string
  borderBottomColor?: string
  borderLeftColor?: string
  borderRadius?: number | string
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none'
  // Per-side styles — real props (`_bbs-solid` &c). Needed once inline `border-bottom: 1px solid …`
  // shorthands were lifted out of `style`, which expands to the per-side width/style/colour trio.
  borderTopStyle?: 'solid' | 'dashed' | 'dotted' | 'none'
  borderRightStyle?: 'solid' | 'dashed' | 'dotted' | 'none'
  borderBottomStyle?: 'solid' | 'dashed' | 'dotted' | 'none'
  borderLeftStyle?: 'solid' | 'dashed' | 'dotted' | 'none'
  // colors / effects
  backgroundColor?: string
  color?: string
  opacity?: number
  cursor?: string
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only'
  /**
   * The RN-shaped shadow quartet. Tamagui compiles these to a single web `box-shadow` (one `_bxsh-`
   * atomic, verified in `primitives/index.test.tsx`), which is why
   * the overlays (dialog/sheet/dropdown/card/drawer/toast) express elevation this way instead of a
   * `box-shadow` string — pinned in `nav/app-sidebar/index.test.tsx` ("a single-layer Tamagui
   * shadow, not a box-shadow string"). They were in use across 10 files but undeclared here, so a
   * real `tsc` scored every one of them against the `$`-bag index signature and failed.
   */
  shadowColor?: string
  shadowOffset?: { width: number; height: number }
  shadowRadius?: number
  shadowOpacity?: number
  // typography (per-face; also valid on a `.is_Text` Box)
  fontFamily?: string
  fontSize?: number | string
  fontWeight?: number | string
  fontStyle?: 'normal' | 'italic'
  lineHeight?: number | string
  letterSpacing?: number | string
  textAlign?: 'left' | 'right' | 'center' | 'justify' | 'start' | 'end'
  textDecorationLine?: 'none' | 'underline' | 'line-through' | 'underline line-through'
  textTransform?: 'none' | 'capitalize' | 'uppercase' | 'lowercase'
  // position
  position?: 'absolute' | 'relative' | 'fixed' | 'static' | 'sticky'
  top?: number | string
  right?: number | string
  bottom?: number | string
  left?: number | string
  inset?: number | string
  zIndex?: number | string
  // transforms
  transform?: string
  x?: number
  y?: number
  scale?: number
  rotate?: string
  /**
   * The animation driver's named transition (`quick`/`medium`/`slow`/`none`, declared in
   * `theme/tamagui.config.ts`). NOTE the prop is `transition`, NOT `animation` — Tamagui 2.5
   * renamed it, and `animation` is silently ignored (`useComponentState` gates on
   * `'transition' in props`). `animateOnly` narrows it, and its entries must be **hyphenated CSS**
   * property names: `background-color` works, `backgroundColor` emits an invalid declaration that
   * the browser drops. Both pinned in `primitives/index.test.tsx`.
   */
  transition?: 'none' | 'quick' | 'medium' | 'slow'
  animateOnly?: readonly string[]
  // pseudo-styles (state variants, §5)
  hoverStyle?: PseudoStyleProps
  pressStyle?: PseudoStyleProps
  focusStyle?: PseudoStyleProps
  focusVisibleStyle?: PseudoStyleProps
  disabledStyle?: PseudoStyleProps
  /**
   * Media (`$sm`), hover-group (`$group-row-hover`) and sub-theme (`$dark`) style bags. Tamagui
   * derives the valid set from the config AT RUNTIME, so it is open-ended; a `$`-prefixed index
   * signature keeps them type-checked as style bags without hand-mirroring the media list here.
   * `libs/ui` only runs a syntax-level `tsc`, so these went unchecked until `apps/web` — which does
   * typecheck — started using them.
   */
  [prop: `$${string}`]: PseudoStyleProps | undefined
}

export type LayoutPrimitiveProps = React.HTMLAttributes<HTMLDivElement> &
  LayoutStyleProps &
  TextStyleProps &
  MarginStyleProps &
  BoxStyleProps

const webBlockCompat = { flexShrink: 1, minWidth: 'auto', minHeight: 'auto' } as const

/** Row — `styled(View,{flexDirection:'row'})` ≡ `<div class="flex">`. */
const RowStyled = styled(View, { name: 'Row', flexDirection: 'row', ...webBlockCompat }) as unknown as React.ComponentType<any>
/** Col — `styled(View,{flexDirection:'column'})` ≡ `<div class="flex flex-col">`. */
const ColStyled = styled(View, { name: 'Col', flexDirection: 'column', ...webBlockCompat }) as unknown as React.ComponentType<any>

export const Row = React.forwardRef<HTMLDivElement, LayoutPrimitiveProps>((props, ref) =>
  React.createElement(RowStyled, { ...props, ref }),
)
Row.displayName = 'Row'

export const Col = React.forwardRef<HTMLDivElement, LayoutPrimitiveProps>((props, ref) =>
  React.createElement(ColStyled, { ...props, ref }),
)
Col.displayName = 'Col'


// ── Font-scale token resolution ──────────────────────────────────────────────────────────────────
//
// Tamagui keys the `$`-named FONT scales (`fontSize`/`fontWeight`/`lineHeight`/`letterSpacing`) off
// the component's font FAMILY — `$sm` means "the `sm` step of this component's font". With no
// `fontFamily` assigned there is no scale to look `$sm` up in, so Tamagui resolves it to nothing and
// **silently drops the prop** (no class emitted, no warning). A raw number still works, and — worse
// — a numeric-looking token like `$5` falls through to the SPACE scale and yields a wrong size.
//
// That makes `fontSize="$sm"` a silent no-op, which is exactly the shape the P3 codemod and the
// element-layer swap emit when they lift `text-sm`/`font-medium`/`leading-*`/`tracking-*` off a
// className. So the primitives default `fontFamily` to `$body` — but ONLY when the caller passes a
// `$`-token font-scale prop and no family of its own. Scoping it that way keeps the fix to the
// call sites that are broken today: a primitive with no font props still INHERITS its font exactly
// as `.is_Text` intends (the whole reason these primitives avoid the `.is_View` base), and an
// explicit `fontFamily="$mono"` (the Code element, terminals) still wins.
//
// See docs/tamagui-idiomatic-migration.md §5/§6.
const FONT_SCALE_PROPS = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'] as const

// Constrained to `object`, NOT `Record<string, unknown>`: every caller passes a props type built
// from a React `*HTMLAttributes` INTERFACE, and an interface has no implicit index signature, so it
// is not assignable to `Record<string, unknown>` (only type ALIASES are). The bodies index through
// an explicit cast instead.
function withFontScale<T extends object>(props: T): T {
  const p = props as Record<string, unknown>
  if (p['fontFamily'] !== undefined) return props
  const needsFamily = FONT_SCALE_PROPS.some(
    (k) => typeof p[k] === 'string' && (p[k] as string).startsWith('$'),
  )
  // fontFamily must come FIRST: Tamagui resolves props in order, and a `$` font-scale token is
  // looked up against whatever family is already set — a family applied afterwards is too late.
  return needsFamily ? ({ fontFamily: '$body', ...props } as T) : props
}

// ── Text ────────────────────────────────────────────────────────────────────────────────────────
//
// A Tamagui `styled(Text)` that reproduces a plain host tag's typography + text-flow on web.
//
// `.is_Text` (the unlayered Tamagui base) imposes THREE props a plain `<span>`/`<p>` does NOT have —
// `display: inline`, `white-space: pre-wrap`, `word-wrap: break-word` — and, being unlayered, they beat
// Tailwind utilities (the same coexistence rule B0 found for `.is_View`). So the primitive neutralises
// exactly those three back to plain-tag semantics, PROVEN ≡ raw tags across every `as` variant + the
// conflict classes in `apps/web/b0-probe/text-variants.mjs` (21/21 match):
//   - `white-space`/`word-wrap` → `'inherit'` reproduces "the tag has no rule of its own" (both are
//     INHERITED CSS props: at the root they resolve to `normal`, and a nested Text inherits its parent
//     just like a `<span>` — the inheritance case is in the probe).
//   - `display` is set PER TAG below (block tags → `block`; inline tags → `inline`), so `as="p"`/`h1`
//     match a real (preflight-reset) `<p>`/`<h1>` instead of collapsing to inline.
// A caller-passed style prop overrides the default (spread AFTER `display`), which is how the B3.1
// codemod lifts the conflicting Tailwind classes (`block`/`hidden`/`whitespace-*`/`break-words`/
// `truncate`) onto props. `word-break` (`break-all`) is NOT touched by `.is_Text`, so it stays a class.
export type TextStyleProps = {
  display?:
    | 'inline' | 'block' | 'inline-block' | 'flex' | 'inline-flex' | 'grid' | 'inline-grid'
    | 'table' | 'list-item' | 'flow-root' | 'contents' | 'none'
  whiteSpace?: 'normal' | 'nowrap' | 'pre' | 'pre-wrap' | 'pre-line' | 'break-spaces' | 'inherit'
  wordWrap?: 'normal' | 'break-word' | 'inherit'
  overflow?: 'visible' | 'hidden' | 'clip' | 'scroll' | 'auto'
  // Per-axis overflow — real props (`_ox-`/`_oy-`). The codemod emits them from `overflow-x/y`
  // utilities and from lifted inline styles; only the shorthand was declared before.
  overflowX?: 'visible' | 'hidden' | 'clip' | 'scroll' | 'auto'
  overflowY?: 'visible' | 'hidden' | 'clip' | 'scroll' | 'auto'
  textOverflow?: 'clip' | 'ellipsis'
}

/**
 * Margin props the codemod lifts off `Prim.Text`/`Pressable`. The `.is_Text` base sets `margin: 0`
 * UNLAYERED (beating Tailwind `m*` utilities), so a surface margin class must move to a prop (rem
 * string matching the Tailwind scale). Custom-CSS margins (BEM `@apply`) are NOT affected — they win
 * by source order. Proven ≡ Tailwind in `apps/web/b0-probe/text-variants.mjs` (`margin-*`).
 */
export type MarginStyleProps = {
  margin?: number | string
  marginTop?: number | string
  marginRight?: number | string
  marginBottom?: number | string
  marginLeft?: number | string
  marginHorizontal?: number | string
  marginVertical?: number | string
}

export type TextAs =
  | 'span' | 'p' | 'strong' | 'em' | 'b' | 'i' | 'small' | 'label'
  | 'code' | 'kbd' | 'dt' | 'dd' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'pre'

export type TextPrimitiveProps = React.HTMLAttributes<HTMLElement> &
  TextStyleProps &
  MarginStyleProps &
  LayoutStyleProps &
  BoxStyleProps & {
    /** Inline text tag to render. Defaults to `span` (or `p` when `block`). */
    as?: TextAs
    /** Convenience: render a block `<p>` instead of an inline `<span>`. */
    block?: boolean
    /** Passed through when `as="label"`. */
    htmlFor?: string
  }

// One Tamagui component PER host tag, built with `createComponent({ Component: tag, isText: true })`.
// Why per-tag and not one `styled(Text)` + a runtime `tag` prop: Tamagui's `tag` prop is a COMPILE-TIME
// hint (consumed by @tamagui/static); at runtime — jsdom tests, SSR, any non-extracted path — a
// `styled(Text)` renders `<span>` regardless, silently dropping the semantic tag (headings/labels →
// a11y regression). `createComponent({ Component: 'h1', isText: true, acceptsClassName: true })` binds
// the REAL host element at build of the component, so `<h1>`/`<p>`/`<label>` are runtime-guaranteed,
// while `isText: true` gives the `.is_Text` text base (NOT `.is_View`, which would force
// font-family + line-height — the B2 collision). `display` is baked per tag (inline tags → `inline`,
// block tags → `block`) so `as="p"`/`h1` match a preflight-reset `<p>`/`<h1>`; a caller-lifted
// `display`/`whiteSpace`/… (from the B3.1 codemod) overrides it (spread AFTER the defaults).
const INLINE_TAGS = ['span', 'strong', 'em', 'b', 'i', 'small', 'label', 'code', 'kbd'] as const
// `pre` is a BLOCK text tag: the idiomatic `Code block` renders `<Prim.Text as="pre">`, and an
// unmapped `as` silently falls back to `span` — which drops both the `<pre>` semantics and its
// `white-space: pre` text-flow. (`elements/typography/code` regression-tested in its index.test.tsx.)
const BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'dd', 'pre'] as const
const baseTextResets = { whiteSpace: 'inherit', wordWrap: 'inherit' } as const

const makeTextTag = (tag: string, display: 'inline' | 'block') =>
  createComponent({
    // A host-tag string as `Component` is exactly what Tamagui's own `styledHtml` passes (it renders
    // that real element); the public type wants a component, so cast like `styledHtml` does.
    Component: tag as never,
    isText: true,
    isReactNative: false,
    acceptsClassName: true,
    componentName: 'Text',
    defaultProps: { display, ...baseTextResets },
  }) as unknown as React.ComponentType<any>

const TAG_COMPONENTS: Record<string, React.ComponentType<any>> = {}
for (const t of INLINE_TAGS) TAG_COMPONENTS[t] = makeTextTag(t, 'inline')
for (const t of BLOCK_TAGS) TAG_COMPONENTS[t] = makeTextTag(t, 'block')

export const Text = React.forwardRef<HTMLElement, TextPrimitiveProps>(({ as, block, ...props }, ref) => {
  const tag = as ?? (block ? 'p' : 'span')
  const Comp = TAG_COMPONENTS[tag] ?? TAG_COMPONENTS.span
  return React.createElement(Comp, { ...withFontScale(props), ref })
})
Text.displayName = 'Text'

// ── Pressable ───────────────────────────────────────────────────────────────────────────────────
//
// The clickable primitive (`<button>` / `<a>` / `<div role>`). Same design as `Text`, and for the
// same two reasons: (1) per-tag `createComponent` so the REAL host element is runtime-guaranteed (the
// `tag` prop is compile-only); (2) **`isText: true`** — a `<button>` carries `text-sm`/`text-xs`, and
// the `.is_View` base would force `font-family` + `line-height` onto it (the B2 collision), whereas the
// `.is_Text` base leaves font/line-height alone so the button inherits them like a preflight-reset
// `<button>` does. `.is_Text` sets NO flex-shrink / min-width (unlike `.is_View`), so a button as a flex
// child shrinks like a raw one with no compat resets needed. The button UA reset (border/background/
// appearance/cursor) comes from Tailwind PREFLIGHT targeting the real `<button>` tag — applied to the
// Tamagui button identically. `display` is baked per tag to a plain tag's default (button →
// `inline-block`, a → `inline`, div → `block`); a caller-lifted `display`/`whiteSpace`/… (from the
// codemod / wrapper components like chat's `<Button>`, which pass `display="inline-flex"`) overrides it.
// `items-*`/`justify-*`/`gap-*` stay classes — `.is_Text` never sets them, so there is no conflict.
export type PressableAs = 'button' | 'a' | 'div'
export type PressablePrimitiveProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  Pick<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    'href' | 'target' | 'rel' | 'download' | 'referrerPolicy' | 'hrefLang'
  > &
  TextStyleProps &
  LayoutStyleProps &
  MarginStyleProps &
  BoxStyleProps & {
    /** Host tag to render. Defaults to `button`. Use `a` for links, `div` for clickable boxes. */
    as?: PressableAs
  }

const PRESSABLE_DISPLAY: Record<PressableAs, 'inline-block' | 'inline' | 'block'> = {
  button: 'inline-block',
  a: 'inline',
  div: 'block',
}

const makePressableTag = (tag: PressableAs) =>
  createComponent({
    Component: tag as never,
    isText: true,
    isReactNative: false,
    acceptsClassName: true,
    componentName: 'Pressable',
    defaultProps: { display: PRESSABLE_DISPLAY[tag], ...baseTextResets },
  }) as unknown as React.ComponentType<any>

const PRESSABLE_COMPONENTS: Record<PressableAs, React.ComponentType<any>> = {
  button: makePressableTag('button'),
  a: makePressableTag('a'),
  div: makePressableTag('div'),
}

export const Pressable = React.forwardRef<HTMLElement, PressablePrimitiveProps>(({ as, ...props }, ref) => {
  const Comp = PRESSABLE_COMPONENTS[as ?? 'button'] ?? PRESSABLE_COMPONENTS.button
  return React.createElement(Comp, { ...withFontScale(props), ref })
})
Pressable.displayName = 'Pressable'

// ── Box (block container) ─────────────────────────────────────────────────────────────────────────
//
// SAME per-tag `createComponent` + **`isText: true`** design as Text/Pressable — deliberately NOT
// `styled(View)`. A `styled(View)` block Box carries `.is_View`, whose shared rule ALSO forces
// `font-family` + `line-height` onto EVERY box (wrong for a plain `<div>`, which INHERITS both; proven
// in `apps/web/b0-probe/box-variants` — `.is_View` breaks a `font-mono`/`text-*` box, `.is_Text`
// matches). `.is_Text` forces none of font/line-height/flex-shrink/min-width, so a block Box reproduces
// a plain div AND the flex-child classes (`shrink-*`/`min-*`/`self-*`/`items-*`) just work as classes.
// Its collisions are `.is_Text`'s unlayered `margin: 0` (lifted to props by the codemod) and — the
// reason B3.3 needed a design-system change — the boosted default `display:block` overriding `display`
// set by the design system's own `@apply flex/grid` component/BEM CSS; those `@apply` display utilities
// were made `!important` (Tailwind `!` modifier) so author CSS wins. `display` defaults to `block`
// (`summary` → `list-item`).
export type BoxAs =
  | 'div' | 'section' | 'nav' | 'header' | 'footer' | 'aside' | 'article' | 'main'
  | 'figure' | 'figcaption' | 'blockquote' | 'details' | 'summary' | 'dl' | 'fieldset'

export type BoxPrimitiveProps = React.HTMLAttributes<HTMLElement> &
  TextStyleProps &
  LayoutStyleProps &
  MarginStyleProps &
  BoxStyleProps & {
    /** Semantic host tag to render. Defaults to `div`. */
    as?: BoxAs
    /** `<details open>` support. */
    open?: boolean
  }

const BOX_TAGS: BoxAs[] = [
  'div', 'section', 'nav', 'header', 'footer', 'aside', 'article', 'main',
  'figure', 'figcaption', 'blockquote', 'details', 'summary', 'dl', 'fieldset',
]

const makeBoxTag = (tag: BoxAs) =>
  createComponent({
    Component: tag as never,
    isText: true,
    isReactNative: false,
    acceptsClassName: true,
    componentName: 'Box',
    defaultProps: { display: tag === 'summary' ? 'list-item' : 'block', ...baseTextResets },
  }) as unknown as React.ComponentType<any>

const BOX_COMPONENTS: Record<string, React.ComponentType<any>> = {}
for (const t of BOX_TAGS) BOX_COMPONENTS[t] = makeBoxTag(t)

export const Box = React.forwardRef<HTMLElement, BoxPrimitiveProps>(({ as, ...props }, ref) => {
  const Comp = BOX_COMPONENTS[as ?? 'div'] ?? BOX_COMPONENTS.div
  return React.createElement(Comp, { ...withFontScale(props), ref })
})
Box.displayName = 'Box'

// ── Link / Form / List / ListItem ────────────────────────────────────────────────────────────────
//
// Container/text leaf primitives, same per-tag `createComponent` + `isText:true` design (so a plain
// `<a>`/`<form>`/`<ul>`/`<li>` is reproduced: font/line-height inherit, margins lift to props, display
// per tag). `.is_Text` sets no list-style, so `list-disc`/`list-decimal`/`ml-*` on a List work as
// classes (margins lifted). (The pure-host replaced/form/table leaves — Image/controls/media/table/svg
// — stay web-passthrough + native-fork: a Tamagui wrapper adds nothing on web for those and would break
// replaced-content/form/table semantics; native already renders them via their `.native.tsx` forks.)

const makeLeaf = (tag: string, display: string, name: string) =>
  createComponent({
    Component: tag as never,
    isText: true,
    isReactNative: false,
    acceptsClassName: true,
    componentName: name,
    defaultProps: { display, ...baseTextResets },
  }) as unknown as React.ComponentType<any>

export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & TextStyleProps & MarginStyleProps & LayoutStyleProps & BoxStyleProps
const LinkComp = makeLeaf('a', 'inline', 'Link')
export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>((props, ref) =>
  React.createElement(LinkComp, { ...withFontScale(props), ref }),
)
Link.displayName = 'Link'

export type FormProps = React.FormHTMLAttributes<HTMLFormElement> & TextStyleProps & MarginStyleProps & LayoutStyleProps & BoxStyleProps
const FormComp = makeLeaf('form', 'block', 'Form')
export const Form = React.forwardRef<HTMLFormElement, FormProps>((props, ref) =>
  React.createElement(FormComp, { ...withFontScale(props), ref }),
)
Form.displayName = 'Form'

export type ListProps = React.HTMLAttributes<HTMLElement> &
  TextStyleProps &
  MarginStyleProps &
  // `LayoutStyleProps` (gap/flex/min-max) — the only primitive that was missing it, so a `<ul>`
  // used as a flex or grid container could not take `gap`. `ListItem` already had it.
  LayoutStyleProps &
  BoxStyleProps & { /** Render an ordered `<ol>` instead of an unordered `<ul>`. */ ordered?: boolean }
const UlComp = makeLeaf('ul', 'block', 'List')
const OlComp = makeLeaf('ol', 'block', 'List')
export const List = React.forwardRef<HTMLElement, ListProps>(({ ordered, ...props }, ref) =>
  React.createElement(ordered ? OlComp : UlComp, { ...withFontScale(props), ref }),
)
List.displayName = 'List'

export type ListItemProps = React.LiHTMLAttributes<HTMLLIElement> & TextStyleProps & MarginStyleProps & LayoutStyleProps & BoxStyleProps
const LiComp = makeLeaf('li', 'list-item', 'ListItem')
export const ListItem = React.forwardRef<HTMLLIElement, ListItemProps>((props, ref) =>
  React.createElement(LiComp, { ...withFontScale(props), ref }),
)
ListItem.displayName = 'ListItem'

// ── Form controls (TextField / TextArea / Select) ────────────────────────────────────────────────
//
// The idiomatic element layer needs `elements/forms/{input,textarea,select}` to carry their design
// tokens as style PROPS rather than a BEM className, and a prop only reaches the DOM if the control
// is a Tamagui component. These were the last pure-host passthroughs on the styling path.
//
// Built with the same per-tag `createComponent` as Text/Pressable/Box — the real `<input>`/
// `<textarea>`/`<select>` is bound at component-build time, so the semantics and form behaviour are
// runtime-guaranteed (Tamagui's `tag` prop is compile-time only). The difference is
// **`isInput: true`** instead of `isText`: it gives the `.is_Input` base, which is what wires
// `placeholderTextColor`/`selectionColor` through to `::placeholder`/`::selection` — the
// `placeholder:text-muted-foreground` utility the form BEM blocks relied on has no other expression
// as a prop. Font/line-height are left to inherit, exactly as `.is_Text` does for the other leaves.
//
// `<input>` is a void element: `defaultProps` set no `display`-driven children and callers pass
// none. `<select>` DOES take children (its `<option>`s) and they pass straight through.
// `Option` stays a pure host passthrough — it is never styled, and Tamagui wrapping an `<option>`
// would only risk its parent-`<select>` semantics.
//
// See docs/tamagui-idiomatic-migration.md §6 (P4 — primitives go idiomatic).

/** Style props valid on a form control — the Box surface plus the two Tamagui pseudo-element hooks. */
export type ControlStyleProps = LayoutStyleProps &
  MarginStyleProps &
  BoxStyleProps & {
    /** Colour of `::placeholder` (via the `.is_Input` base). Replaces `placeholder:text-*`. */
    placeholderTextColor?: string
    /** Colour of `::selection` (via the `.is_Input` base). */
    selectionColor?: string
    /** `resize` is web-only and has no RN analogue, so it is not in `BoxStyleProps`. */
    resize?: 'none' | 'both' | 'horizontal' | 'vertical'
  }

// `componentName` is NOT cosmetic here: Tamagui emits the base class as `.is_<componentName>`, and
// its built-in stylesheet wires the pseudo-elements through `.is_Input::placeholder,
// .is_TextArea::placeholder` / `.is_Input::selection, .is_TextArea::selection`. Naming the input
// component `Input` (not `TextField`) is what makes `placeholderTextColor`/`selectionColor` actually
// reach `::placeholder`/`::selection`.
const makeControl = (tag: 'input' | 'textarea' | 'select', name: string) =>
  createComponent({
    Component: tag as never,
    isText: true,
    isReactNative: false,
    acceptsClassName: true,
    componentName: name,
  }) as unknown as React.ComponentType<any>

const TextFieldComp = makeControl('input', 'Input')
const TextAreaComp = makeControl('textarea', 'TextArea')
const SelectComp = makeControl('select', 'Select')

/**
 * Three control style props have no Tamagui style-prop path on a `createComponent` host tag and
 * would otherwise be forwarded to the DOM as unknown attributes (`placeholdertextcolor="$muted-…"`,
 * which React warns about and browsers ignore):
 *
 * - `placeholderTextColor` / `selectionColor` target PSEUDO-ELEMENTS. Tamagui's own base stylesheet
 *   already carries `.is_Input::placeholder, .is_TextArea::placeholder { color: var(--t_placeholderColor) }`
 *   (and the `::selection` twin), so the value is delivered by setting that CSS VAR on the element —
 *   which is why these components are named `Input`/`TextArea` (the selector is `.is_<componentName>`).
 * - `resize` is a web-only CSS property with no React Native analogue, so Tamagui has no style key
 *   for it; it goes straight to `style`.
 *
 * `$token` values resolve through the SPIKE-A1 var-backed colors (`$muted-foreground` →
 * `var(--muted-foreground)`), so runtime/per-space themes keep working.
 */
const cssValue = (v: string) => (v.startsWith('$') ? `var(--${v.slice(1)})` : v)

function withControlShim<T extends object>(props: T): T {
  const { placeholderTextColor, selectionColor, resize, style, ...rest } = props as Record<string, unknown>
  if (placeholderTextColor === undefined && selectionColor === undefined && resize === undefined) {
    return props
  }
  return {
    ...rest,
    style: {
      ...(placeholderTextColor !== undefined
        ? { '--t_placeholderColor': cssValue(String(placeholderTextColor)) }
        : {}),
      ...(selectionColor !== undefined
        ? { '--t_selectionColor': cssValue(String(selectionColor)) }
        : {}),
      ...(resize !== undefined ? { resize } : {}),
      ...(style as object),
    },
  } as unknown as T
}

// ── Image ────────────────────────────────────────────────────────────────────────────────────────
//
// `<img>` was left a pure host passthrough on the grounds that a Tamagui wrapper "adds nothing on
// web and would break replaced-content semantics". The first half turned out to be false and the
// second half does not apply to the per-tag `createComponent` build: the P3 codemod treats `Image`
// as a style-prop target, so it had been rewriting `className="h-5 w-5 object-cover"` into
// `height="$5" width="$5" objectFit="cover"` on a host `<img>` — where those are not styles at all,
// just unknown DOM attributes. Every codemod-touched image has been silently unstyled since.
//
// Built exactly like the form controls, so the real `<img>` (and its replaced-content behaviour) is
// runtime-guaranteed while the style props actually apply. `objectFit` is web-only and has no RN
// style key, so it rides on `style` via the shim below.
export type ImagePrimitiveProps = React.ImgHTMLAttributes<HTMLImageElement> &
  LayoutStyleProps &
  MarginStyleProps &
  BoxStyleProps & {
    objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'
  }

const ImageComp = createComponent({
  Component: 'img' as never,
  isText: true,
  isReactNative: false,
  acceptsClassName: true,
  componentName: 'Image',
}) as unknown as React.ComponentType<any>

function withImageShim<T extends object>(props: T): T {
  const { objectFit, style, ...rest } = props as Record<string, unknown>
  if (objectFit === undefined) return props
  return { ...rest, style: { objectFit, ...(style as object) } } as unknown as T
}

export const Image = React.forwardRef<HTMLImageElement, ImagePrimitiveProps>((props, ref) =>
  React.createElement(ImageComp, { ...withFontScale(withImageShim(props)), ref }),
)
Image.displayName = 'Image'

export type TextFieldPrimitiveProps = React.InputHTMLAttributes<HTMLInputElement> & ControlStyleProps
export const TextField = React.forwardRef<HTMLInputElement, TextFieldPrimitiveProps>((props, ref) =>
  React.createElement(TextFieldComp, { ...withFontScale(withControlShim(props)), ref }),
)
TextField.displayName = 'TextField'

export type TextAreaPrimitiveProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & ControlStyleProps
export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaPrimitiveProps>((props, ref) =>
  React.createElement(TextAreaComp, { ...withFontScale(withControlShim(props)), ref }),
)
TextArea.displayName = 'TextArea'

export type SelectPrimitiveProps = React.SelectHTMLAttributes<HTMLSelectElement> & ControlStyleProps
export const Select = React.forwardRef<HTMLSelectElement, SelectPrimitiveProps>((props, ref) =>
  React.createElement(SelectComp, { ...withFontScale(withControlShim(props)), ref }),
)
Select.displayName = 'Select'

// ── Pre + the table family ───────────────────────────────────────────────────────────────────────
//
// These were `hostPrimitive` passthroughs, which forward props to a raw host tag — so every style
// prop was silently ignored and their callers had to keep classNames. `makeLeaf` gives each the
// same per-tag `createComponent` treatment as Link/Form/List: the real tag, `isText:true` so font
// and line-height inherit, and the tag's own `display` restored (Tamagui's base would otherwise
// force `flex`, which destroys table layout).
//
// `Pre` was the single biggest className holdout in the codebase (40 utilities across the chat
// renderers). The `Svg` family and the replaced media elements stay passthroughs: Tamagui treats
// `width`/`height` as STYLE, which is equivalent on `<svg>` but wrong on `<rect>`/`<circle>`, where
// they are geometry attributes — see the note in `svg.tsx`.
export type PreLeafProps = React.HTMLAttributes<HTMLPreElement> &
  TextStyleProps & MarginStyleProps & LayoutStyleProps & BoxStyleProps
const PreComp = makeLeaf('pre', 'block', 'Pre')
export const PreLeaf = React.forwardRef<HTMLPreElement, PreLeafProps>((props, ref) =>
  React.createElement(PreComp, { ...withFontScale(props), ref }),
)
PreLeaf.displayName = 'Pre'

export type TableLeafProps<E extends HTMLElement = HTMLElement, A = React.HTMLAttributes<E>> = A &
  TextStyleProps & MarginStyleProps & LayoutStyleProps & BoxStyleProps

/** One Tamagui-backed table leaf. `display` is the tag's own, not Tamagui's `flex` default. */
function makeTableLeaf<E extends HTMLElement, A>(tag: string, display: string, name: string) {
  const Comp = makeLeaf(tag, display, name)
  const Wrapped = React.forwardRef<E, TableLeafProps<E, A>>((props, ref) =>
    React.createElement(Comp, { ...withFontScale(props), ref }),
  )
  Wrapped.displayName = name
  return Wrapped
}

export const TableLeaf = makeTableLeaf<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>('table', 'table', 'Table')
export const TheadLeaf = makeTableLeaf<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>('thead', 'table-header-group', 'Thead')
export const TbodyLeaf = makeTableLeaf<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>('tbody', 'table-row-group', 'Tbody')
export const TfootLeaf = makeTableLeaf<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>('tfoot', 'table-footer-group', 'Tfoot')
export const TrLeaf = makeTableLeaf<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>('tr', 'table-row', 'Tr')
export const ThLeaf = makeTableLeaf<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>('th', 'table-cell', 'Th')
export const TdLeaf = makeTableLeaf<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>('td', 'table-cell', 'Td')
