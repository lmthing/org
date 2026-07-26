import * as React from 'react'
import { NativeView, nativeSafeProps } from '../_native'

/**
 * Box (native fork). Renders a Tamagui/RN `View`. Accepts the SAME prop shape as the web `Box`
 * so a surface component typechecks against both targets. Props go through `nativeSafeProps`, so
 * Tamagui style props (`padding="$4"`, `backgroundColor="$background"`) and `role`/`aria-*` reach
 * the native view, while web-only attributes and DOM events are dropped or mapped. Web keeps
 * `index.tsx` (Metro prefers this `.native.tsx`).
 * See docs/react-native-tamagui-migration.md §1.6 / §7.
 */
export type BoxAs =
  | 'div'
  | 'section'
  | 'nav'
  | 'header'
  | 'footer'
  | 'aside'
  | 'article'
  | 'main'
  | 'figure'
  | 'figcaption'
  | 'blockquote'
  | 'details'
  | 'summary'
  | 'dl'
  | 'fieldset'

/**
 * The SAME props type the web `Box` exports, imported rather than redeclared.
 *
 * This used to be `React.HTMLAttributes<HTMLElement>`, which was never true and never checked: a
 * surface writes `<Box padding="$4">`, `tsc` only ever resolves `index.tsx`, and the fork forwards
 * the prop through `nativeSafeProps` at runtime — so the declaration here disagreed with both the
 * caller and the implementation, and nothing could notice. One component, one props type.
 *
 * `import type` is erased by the transform, so `_tamagui.tsx` does not enter the native graph —
 * verified directly against the graph rather than assumed, because nothing would catch it if it
 * did: `_tamagui.tsx` has no `.native` sibling for the fork check to fire on, and it pulls no
 * web-only package for the leak check.
 */
import type { BoxPrimitiveProps } from '../_tamagui'

export type BoxProps = BoxPrimitiveProps

const Box = React.forwardRef<any, BoxProps>(
  ({ children, ...props }, ref) => (
    <NativeView ref={ref} {...nativeSafeProps(props)}>
      {children}
    </NativeView>
  ),
)
Box.displayName = 'Box'

export { Box }
