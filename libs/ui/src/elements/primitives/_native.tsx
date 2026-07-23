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
 * and dropped/mapped here rather than rejected. Layout still needs a native styling story for the
 * className-driven surfaces (NativeWind or a props migration) — see
 * `.issues/tamagui-web-swap-blocked-by-className-layout.md`; these forks are the element seam that
 * story plugs into.
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
 */
export const NativeView: React.ComponentType<any> = styled(View, { name: 'NativeView' }) as unknown as React.ComponentType<any>
export const NativeText: React.ComponentType<any> = styled(TamaguiText, {
  name: 'NativeText',
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
 * Strip web-only attributes (className, htmlFor, DOM events; data-attr/aria kept) so the remaining
 * props are safe to spread onto a Tamagui/RN element. `style` is passed through (RN style objects
 * are compatible; string/complex web styles are ignored by RN at runtime).
 */
export function nativeSafeProps<P extends Record<string, unknown>>(props: P): Record<string, unknown> {
  const { className: _c, htmlFor: _h, onClick: _o, ...rest } = props as Record<string, unknown>
  return rest
}
