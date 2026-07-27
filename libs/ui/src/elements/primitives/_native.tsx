import * as React from 'react'
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

/** Map a web click handler onto RN's onPress without leaking DOM-only props into the RN element. */
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
  if (out.display === 'flex' && out.flexDirection === undefined) {
    out.flexDirection = flexDirectionDefault
  }
  if (out.position === 'fixed') out.position = 'absolute'
  return out
}
