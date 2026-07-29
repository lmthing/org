import * as React from 'react'
import { themes as TOKEN_THEMES } from '@lmthing/css/tamagui-tokens'
import { styled, View, Text as TamaguiText } from '../../theme/tamagui.config'

/**
 * Shared factory for the React Native forks of the Phase-0 primitives.
 *
 * Metro resolves `*.native.tsx` in preference to `*.tsx`, so these files are the mobile render
 * target while web keeps the proven passthrough `index.tsx` (the L2/L3 harness guards that web is
 * unchanged). They are built on the shared `tamagui.config` (`styled`/`View`/`Text`), so color /
 * radius / font come from the SAME tokens the web theme uses (Layer-1 parity).
 *
 * Prop compatibility: the native forks accept the SAME prop shape as the web primitives
 * (`React.HTMLAttributes`-derived) so a single surface component typechecks against both targets.
 * Web-only props that have no RN meaning (`className`, `htmlFor`, DOM event handlers) are accepted
 * and dropped/mapped by {@link nativeSafeProps} rather than rejected.
 *
 * **Every fork forwards its props through `nativeSafeProps`.** That is the native styling story for
 * the props axis: a surface writes `<Box padding="$4" backgroundColor="$background">` once, and it
 * renders on both targets because both are Tamagui. The forks originally destructured only
 * `style`/`children`, which meant a native screen mounted the right TREE with none of the styling —
 * invisible to web CI, and caught by the Metro render harness (`libs/ui/metro`). What remains of the
 * §1c decision is the CLASSNAME axis (surfaces still holding Tailwind classes), not this one.
 */

/**
 * Tamagui View/Text bases with RN-correct flex defaults (View is column, shrink 0 — RN native).
 *
 * Exported as a plain `React.ComponentType<any>` on purpose: the repo currently has BOTH
 * `@types/react@18` (libs/ui) and `@types/react@19` (hoisted, required by react-native 0.86) in
 * the tree, whose `ReactNode` unions differ (the `bigint` member), which makes Tamagui's richly-
 * typed components unusable as JSX under a bare `tsc`. The thin native forks don't need Tamagui's
 * style-prop typing — the mobile app uses Tamagui directly with consistent types — so we widen
 * here to keep the forks compiling in any react-types configuration.
 *
 * **This is also what every native-only file builds on, and why.** There is one tsconfig, so inside
 * a `.native.tsx` file TypeScript still resolves `Prim.Box` to the WEB component — whose props are
 * `HTMLAttributes`-derived and have no `onPress`, `accessibilityRole`, `onLongPress` or
 * `pressStyle`. Those are exactly the props a native-only file needs, so it reaches for `NativeView`
 * / `NativeText` (RN-typed, `any`-widened) rather than the public primitives. Use `Prim.*` in a fork
 * only where the prop bag really is the web-shaped public one — a trigger taking `onClick`, a title
 * taking children.
 */
export const NativeView: React.ComponentType<any> = styled(View, { name: 'NativeView' }) as unknown as React.ComponentType<any>

/**
 * `fontFamily: '$body'` is load-bearing, not decoration.
 *
 * A `$`-token font SIZE is looked up in the scale of the component's font face, so with no family
 * set Tamagui has no scale to resolve against and **drops `fontSize="$sm"` silently** — the text
 * renders at the platform default with no warning. Web never sees this: `theme.css` puts the family
 * on `.font_body`/`.is_View`, so every element already has one.
 *
 * Setting it here gives native the same starting point web has. `Pre` overrides it with `$mono`,
 * and any caller can.
 */
export const NativeText: React.ComponentType<any> = styled(TamaguiText, {
  name: 'NativeText',
  fontFamily: '$body',
}) as never

/** The raw styled() factory + base, re-exported for forks that need an explicit flexDirection. */
export { styled, View, TamaguiText }

/**
 * Map a web click handler onto RN's onPress without leaking DOM-only props into the RN element.
 *
 * **The event it hands over is EMPTY**, and it cannot be anything else: there is no DOM node and no
 * mouse behind a native press. So a shared `onClick` may use the fact that it fired and nothing
 * else — `e.target`, `e.currentTarget`, `e.clientX` are all `undefined` here, and reading one is a
 * crash on first tap rather than a degradation. The team composer did exactly that (`e.target.value`
 * to re-sync its `@` picker) and threw before a single character could be typed. Read component
 * state or a ref instead; both are real on either target.
 */
export function toPressHandler(
  onClick?: React.MouseEventHandler,
): (() => void) | undefined {
  if (!onClick) return undefined
  return () => onClick({} as unknown as React.MouseEvent)
}

/**
 * Attributes that mean something to a DOM node and nothing to a native one. Everything NOT listed
 * here is forwarded — including `role` and every `aria-*`, which Tamagui's native path translates
 * into `accessibilityRole`/`accessibilityLabel`/`accessibilityState`
 * (`@tamagui/core/src/createOptimizedView.native.tsx`). Dropping those would throw away the
 * accessibility the surfaces already write.
 */
const WEB_ONLY_ATTRIBUTES = new Set([
  'className',
  'htmlFor',
  // `as` picks an HTML tag. There are no tags on native; the fork already chose the RN element.
  'as',
  'dangerouslySetInnerHTML',
  'draggable',
  'contentEditable',
  'spellCheck',
  'suppressHydrationWarning',
])

/**
 * The event props a Tamagui/RN view understands. An `on*` prop outside this set is a DOM event
 * (`onKeyDown`, `onSubmit`, `onContextMenu`, …) and is dropped rather than forwarded — React Native
 * would keep an unknown `on*` prop as an ordinary prop on the native view, where it is dead weight
 * that looks like it is wired up.
 */
const NATIVE_EVENT_PROPS = new Set([
  'onPress', 'onPressIn', 'onPressOut', 'onLongPress',
  'onHoverIn', 'onHoverOut',
  'onFocus', 'onBlur',
  'onLayout',
  'onStartShouldSetResponder', 'onMoveShouldSetResponder',
  'onResponderGrant', 'onResponderMove', 'onResponderRelease', 'onResponderTerminate',
  'onResponderTerminationRequest',
])

/**
 * Translate the web one-line-truncation idiom into the React Native one.
 *
 * On web, "one line, cut with an ellipsis" is spelled `whiteSpace: 'nowrap'` +
 * `textOverflow: 'ellipsis'` + `overflow: 'hidden'` — three style properties, none of which exists
 * on native. React Native spells the same thing as two PROPS on the text element itself.
 *
 * Left untranslated it is not a cosmetic difference. Every truncating label in the product — the
 * chat header's session title, a message bubble, a sidebar row — simply wrapped instead, so a long
 * title took two lines and pushed the header's own controls out of the row.
 *
 * Returns the RN props when a caller asked for truncation, and nothing at all when it did not, so
 * text that is *supposed* to wrap keeps wrapping.
 */
export function textTruncationProps(props: Record<string, unknown>): Record<string, unknown> {
  const wantsOneLine = props.whiteSpace === 'nowrap' && props.textOverflow === 'ellipsis'
  return wantsOneLine ? { numberOfLines: 1, ellipsizeMode: 'tail' } : {}
}

/**
 * Make a web prop bag safe to spread onto a Tamagui/RN element — **without throwing the styling
 * away**.
 *
 * This is the whole point of the native forks: a surface writes `<Box padding="$4"
 * backgroundColor="$background">` once and both targets honour it, because both are Tamagui. The
 * forks that destructured only `style`/`children` silently dropped every one of those props on
 * native, which is why a native screen rendered as unstyled boxes.
 *
 * What it does:
 * - **forwards** style props, `$`-tokens, `style`, `role`/`aria-*`, `testID`, `disabled`, and the
 *   native event props above — i.e. everything Tamagui or RN can act on;
 * - **maps** `onClick` → `onPress` (an explicit `onPress` wins) and `onMouseEnter`/`onMouseLeave` →
 *   Tamagui's `onHoverIn`/`onHoverOut`, which are inert on a touch device and correct under
 *   react-native-web;
 * - **drops** the web-only attributes and DOM-only event handlers listed above;
 * - **supplies the flex DIRECTION that `display: 'flex'` implies on web** (see below).
 *
 * ### `display: 'flex'` does not mean the same thing on the two targets
 *
 * On web, `display: flex` with no `flex-direction` lays children out in a **row** — that is the CSS
 * initial value, and it is what ~58 shared style objects in this package were written against. On
 * React Native there is no such default: Yoga's initial `flexDirection` is **column**. So a single
 * shared component reading `display: 'flex', alignItems: 'center', gap: '$2'` — the sidebar section
 * header, the project dropdown trigger, the settings row — rendered as a row on web and a STACK on
 * native, silently, with no error and nothing in the type system to catch it.
 *
 * The second-order damage is worse than the layout: a label carrying the web truncation idiom
 * (`flexGrow: 1, flexBasis: '0%'`) has its main axis flipped to vertical, so `flexBasis: 0` sizes
 * its HEIGHT — and the text disappears completely. That is what made the sidebar render as bare
 * chevrons with no `Spaces` / `Conversations` label at all.
 *
 * Reproducing the web default here fixes every one of those sites at once and cannot be forgotten
 * at the next call site, which is the entire reason this seam exists. It only ever ADDS a direction
 * the surface never stated; an explicit `flexDirection` always wins.
 *
 * ### `position: 'fixed'` does not exist on React Native
 *
 * Yoga implements `relative`, `absolute` and `static` — there is no `fixed`, and a node given one
 * silently keeps the default `relative`. An overlay written the web way therefore stops overlaying
 * and takes part in normal flow instead: the chat `Drawer` pins all four insets and renders as a
 * modal sheet on web, but on a phone it laid out INLINE beside the transcript and shoved the
 * conversation off the side of the screen.
 *
 * `absolute` is the faithful translation. Native has no scrolling viewport for `fixed` to be fixed
 * against — an overlay is positioned against the root of the app either way — so the two coincide,
 * and this is exactly the kind of host-element translation the forks exist to own.
 */
export interface NativeSafePropsOptions {
  /**
   * What a bare `display: 'flex'` means for THIS fork — see {@link nativeSafeProps}. `row` for
   * every generic container, because that is what the surfaces were written against; `column` for
   * `Col`, whose whole identity is the other axis.
   */
  flexDirectionDefault?: 'row' | 'column'
}

export function nativeSafeProps(
  props: object,
  { flexDirectionDefault = 'row' }: NativeSafePropsOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let fromClick: (() => void) | undefined
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (WEB_ONLY_ATTRIBUTES.has(key)) continue
    if (key === 'onClick') {
      fromClick = toPressHandler(value as React.MouseEventHandler)
      continue
    }
    if (key === 'onMouseEnter') {
      out.onHoverIn = value
      continue
    }
    if (key === 'onMouseLeave') {
      out.onHoverOut = value
      continue
    }
    if (/^on[A-Z]/.test(key) && !NATIVE_EVENT_PROPS.has(key)) continue
    out[key] = value
  }
  if (fromClick && out.onPress === undefined) out.onPress = fromClick
  // `inline-flex` is the SAME instruction as `flex` for everything Yoga can express — the part that
  // differs, whether the box sits in the text flow, has no meaning on native. React Native accepts
  // only `flex`/`none`/`contents`, so the raw value was reaching Yoga as garbage AND, because it
  // was not literally `'flex'`, skipping the direction default below. Every multi-child `Button`
  // therefore stacked its icon above its label on a device (`display: 'inline-flex'` is in that
  // component's base style), as did 20 other shared sites.
  if (out.display === 'inline-flex') out.display = 'flex'
  if (out.display === 'flex' && out.flexDirection === undefined) {
    out.flexDirection = flexDirectionDefault
  }
  if (out.position === 'fixed') out.position = 'absolute'
  if (!isNativeLineHeight(out.lineHeight)) delete out.lineHeight
  for (const key of NUMERIC_ONLY_STYLE_PROPS) {
    if (key in out) {
      const scalar = toNativeScalar(out[key])
      if (scalar === undefined) delete out[key]
      else out[key] = scalar
    }
  }
  for (const key of COLOR_STYLE_PROPS) {
    if (typeof out[key] === 'string') out[key] = toNativeColor(out[key] as string)
  }
  // …and inside `style`, because a computed tint is usually written there rather than as a prop —
  // `AvatarFallback` builds `{backgroundColor: 'color-mix(…)', color: …}` from a spectrum key, which
  // is why every avatar on the phone was an uncoloured circle with uncoloured initials.
  if (out.style) out.style = withNativeColors(out.style)
  return out
}

/** Map the colour entries of a style object (or array of them) through {@link toNativeColor}. */
function withNativeColors(style: unknown): unknown {
  if (Array.isArray(style)) return style.map(withNativeColors)
  if (!style || typeof style !== 'object') return style
  let changed = false
  const out: Record<string, unknown> = { ...(style as Record<string, unknown>) }
  for (const key of COLOR_STYLE_PROPS) {
    const value = out[key]
    if (typeof value !== 'string') continue
    const native = toNativeColor(value)
    if (native !== value) {
      out[key] = native
      changed = true
    }
  }
  return changed ? out : style
}

/** Style props whose value is a colour, and which therefore may carry a `color-mix()`. */
const COLOR_STYLE_PROPS = [
  'backgroundColor',
  'color',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'shadowColor',
  'placeholderTextColor',
] as const

/** `color-mix(in srgb, <colour> <pct>%, transparent)` — the one form this codebase writes. */
const COLOR_MIX_WITH_TRANSPARENT =
  /^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/i

/** `var(--token)` / `var(--token, fallback)`. */
const CSS_VAR = /^var\(\s*--([a-z0-9-]+)\s*(?:,[^)]*)?\)$/i

/**
 * A colour React Native can actually use.
 *
 * `color-mix(in srgb, var(--primary) 12%, transparent)` is how every tint in this package is
 * written — a chip's fill, THING's avatar, the active app tab, a destructive banner. It is CSS, and
 * React Native's colour parser has never heard of it, so on a device the whole declaration is
 * dropped and the element renders with NO background at all. That is a silent, shape-preserving
 * failure: THING's ✦ avatar lost its circle and the "app is pinned" chip lost its fill, on every
 * screen, while every render suite passed (`react-test-renderer` stores the string and never asks a
 * view manager to parse it).
 *
 * Mixing with `transparent` in sRGB is exactly an alpha multiply, so the translation is `opacity`
 * on the Tamagui token — `$primary` stays a token the theme resolves, and the percentage becomes
 * an `rgba()` only when the colour is already a literal (ds-lint-ok: prose, not a style value).
 * A `var(--x)` is rewritten to `$x`, which
 * is the same token by the generator's own naming
 * (`libs/css/src/tamagui/tokens.generated.ts`).
 */
function toNativeColor(value: string): string {
  const mix = COLOR_MIX_WITH_TRANSPARENT.exec(value)
  if (!mix) return toNativeColorToken(value)
  const base = toNativeColorToken(mix[1]!.trim())
  const alpha = Math.max(0, Math.min(1, Number(mix[2]) / 100))
  const hex = base.startsWith('$') ? TOKEN_HEX[base.slice(1)] : base
  const rgb = hex ? /^#([0-9a-f]{6})$/i.exec(hex) : null
  if (!rgb) return base
  const n = parseInt(rgb[1]!, 16)
  // A Tamagui token carries no alpha, and React Native's colour parser drops the `color-mix()`
  // this replaces — silently, leaving no background at all. So the literal IS the fix here.
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})` // ds-lint-ok
}

/**
 * Token → hex, so a tint can carry an alpha.
 *
 * A Tamagui token cannot: `$primary` is a name the theme resolves at render, and there is nowhere
 * to hang 12% on it. Since the whole point of these values is a WASH of a colour, the alpha is the
 * part that matters, so the token is resolved here instead and the result is a literal
 * `rgba()` (ds-lint-ok: prose, not a style value).
 *
 * Resolved against the LIGHT theme, and that is a deliberate, bounded compromise: this function has
 * no theme context (it maps props, it does not render). Of the 99 tokens, the ones actually used for
 * tints — `primary`, `brand-*`, the `spectrum-*` avatar palette — are byte-identical in both themes,
 * so those are exact. The handful that differ (`destructive`, `agent`, `muted`) shift hue slightly
 * in dark mode under a 12–22% wash. That is a far smaller error than the alternatives: the raw
 * `color-mix()` is dropped by React Native outright (no background at all), and the bare token is
 * the colour at FULL strength, which for a destructive banner is a red block.
 */
const TOKEN_HEX: Record<string, string> = TOKEN_THEMES.light

/** `var(--muted-foreground)` → `$muted-foreground`; anything else unchanged. */
function toNativeColorToken(value: string): string {
  const variable = CSS_VAR.exec(value)
  return variable ? `$${variable[1]}` : value
}

/**
 * Style props whose Android view manager casts straight to a `Double`, so a STRING is a red-screen
 * crash rather than a value it ignores.
 *
 * This is the general form of the `lineHeight` rule below, and it exists because that rule was
 * written for one property when the trap belongs to a whole class of them. `letterSpacing={'-0.02em'
 * as unknown as number}` — the double cast is what got it past the type checker — threw
 * `java.lang.String cannot be cast to java.lang.Double` out of `RCTText` and took the ENTIRE tree
 * with it: the login screen rendered as a blank white page on a device while every render suite
 * passed, because `react-test-renderer` never invokes a view manager. Only a device sees this.
 *
 * Deliberately NOT listed: `width`/`height`/`margin*`/`padding*`/`top`/`flexBasis` and friends.
 * React Native accepts a percentage STRING for those, so they are not numeric-only, and a bad unit
 * there lays out wrong instead of crashing.
 */
const NUMERIC_ONLY_STYLE_PROPS = [
  'letterSpacing',
  'fontSize',
  'borderWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'shadowRadius',
  'elevation',
  'opacity',
  'zIndex',
  'aspectRatio',
  'flex',
  'flexGrow',
  'flexShrink',
  'gap',
  'rowGap',
  'columnGap',
] as const

/**
 * The number React Native can use for a numeric-only style prop, or `undefined` to drop it.
 *
 * A `$`-prefixed string is a Tamagui token and is left alone — resolving it is the config's job,
 * and it resolves to a number. A bare or `px` number is converted. Everything else is a CSS unit
 * with no native meaning (`em`/`rem` are font-relative, `vh`/`vw` need a viewport) and is dropped,
 * on the same reasoning as `isNativeLineHeight`: the surface gets the platform default, which is
 * what it would have got had it said nothing, instead of a crash.
 */
function toNativeScalar(value: unknown): number | string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  if (value.startsWith('$')) return value
  const px = /^(-?[0-9]*\.?[0-9]+)(px)?$/.exec(value.trim())
  return px ? Number(px[1]) : undefined
}

/**
 * Is this `lineHeight` a value React Native can actually use?
 *
 * RN takes ONE form: a number of points. CSS takes three, and the surfaces use all of them:
 *
 * - **a unitless multiplier** (`lineHeight={1.625}` — "1.625 × the font size", the Tailwind
 *   `leading-relaxed` idiom). Native reads the bare number as 1.625 POINTS, so an assistant message
 *   rendered as a two-pixel sliver of its first line with the rest cut off. It looked like a
 *   clipping bug, not a units bug, which is what made it expensive to find.
 * - **a CSS length string** (`'1.25rem'`, `'2rem'`, `'1.375em'`). Android's view manager casts the
 *   property to a `Double`, so a string is a red-screen crash rather than a fallback.
 * - **a real number of points**, which is what the `$`-token ramp resolves to and the only form
 *   that survives.
 *
 * Dropping the other two is deliberate: React Native's own default line height is derived from the
 * font size, which is exactly what the multiplier was asking for, and it is what the surface would
 * have got had it said nothing. Web is untouched — this runs only in the native forks.
 *
 * The threshold is a units test, not a magic number: no real line height is under 4dp, and no CSS
 * multiplier in this codebase is over it.
 */
function isNativeLineHeight(value: unknown): boolean {
  return typeof value === 'number' && value >= 4
}
