import * as React from 'react'

/**
 * Shared factory for Phase-0 passthrough host primitives.
 *
 * Every primitive built here is a `forwardRef` wrapper that renders a fixed host tag with the
 * caller's props applied verbatim (className, event handlers, `ref`, everything). That makes it
 * a true drop-in for the raw tag — byte-identical HTML AND ref-forwarding — which is what lets
 * the de-HTML codemod (§7) rename tags safely. In Phase 1 these implementations swap to Tamagui
 * `styled()` primitives; the surfaces that use them are not edited again.
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export function hostPrimitive<E extends HTMLElement = HTMLElement, P = React.HTMLAttributes<E>>(
  tag: string,
  displayName: string,
) {
  const Comp = React.forwardRef<E, P>((props, ref) =>
    React.createElement(tag, { ...(props as object), ref }),
  )
  Comp.displayName = displayName
  return Comp
}

/**
 * SVG passthrough primitive. Identical to `hostPrimitive` but typed for SVG props, and named to
 * mirror `react-native-svg`'s component names (`Svg`, `Path`, `Rect`, …) so Phase 1 swaps the
 * web host tag for the RN-svg component of the same name with no surface edits.
 */
export function svgPrimitive<E extends SVGElement = SVGElement>(tag: string, displayName: string) {
  const Comp = React.forwardRef<E, React.SVGProps<E>>((props, ref) =>
    React.createElement(tag, { ...props, ref }),
  )
  Comp.displayName = displayName
  return Comp
}
