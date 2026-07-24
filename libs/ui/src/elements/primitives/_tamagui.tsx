import * as React from 'react'
// WEB primitives use the WEB config (empty theme → no theme-var injection; colors come from
// theme.css/Tailwind). The `*.native.tsx` forks use the colored `tamagui.config`. See tamagui-web.config.ts.
import { styled, View, createComponent } from '../../theme/tamagui-web.config'

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

export type LayoutPrimitiveProps = React.HTMLAttributes<HTMLDivElement> & LayoutStyleProps

const webBlockCompat = { flexShrink: 1, minWidth: 'auto', minHeight: 'auto' } as const

/** Row — `styled(View,{flexDirection:'row'})` ≡ `<div class="flex">`. */
const RowStyled = styled(View, { name: 'Row', flexDirection: 'row', ...webBlockCompat }) as unknown as React.ComponentType<any>
/** Col — `styled(View,{flexDirection:'column'})` ≡ `<div class="flex flex-col">`. */
const ColStyled = styled(View, { name: 'Col', flexDirection: 'column', ...webBlockCompat }) as unknown as React.ComponentType<any>
/** Box — `styled(View,{display:'block'})` ≡ a block `<div>`. */
const BoxStyled = styled(View, { name: 'Box', display: 'block', ...webBlockCompat }) as unknown as React.ComponentType<any>

export const Row = React.forwardRef<HTMLDivElement, LayoutPrimitiveProps>((props, ref) =>
  React.createElement(RowStyled, { ...props, ref }),
)
Row.displayName = 'Row'

export const Col = React.forwardRef<HTMLDivElement, LayoutPrimitiveProps>((props, ref) =>
  React.createElement(ColStyled, { ...props, ref }),
)
Col.displayName = 'Col'

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
  display?: 'inline' | 'block' | 'inline-block' | 'flex' | 'inline-flex' | 'none' | 'contents'
  whiteSpace?: 'normal' | 'nowrap' | 'pre' | 'pre-wrap' | 'pre-line' | 'break-spaces' | 'inherit'
  wordWrap?: 'normal' | 'break-word' | 'inherit'
  overflow?: 'visible' | 'hidden' | 'clip' | 'scroll' | 'auto'
  textOverflow?: 'clip' | 'ellipsis'
}

export type TextAs =
  | 'span' | 'p' | 'strong' | 'em' | 'b' | 'i' | 'small' | 'label'
  | 'code' | 'kbd' | 'dt' | 'dd' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

export type TextPrimitiveProps = React.HTMLAttributes<HTMLElement> &
  TextStyleProps & {
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
const BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'dd'] as const
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
  return React.createElement(Comp, { ...props, ref })
})
Text.displayName = 'Text'

export { BoxStyled }
