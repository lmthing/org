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

export type BoxProps = React.HTMLAttributes<HTMLElement> & {
  as?: BoxAs
  open?: boolean
}

const Box = React.forwardRef<any, BoxProps>(
  ({ children, ...props }, ref) => (
    <NativeView ref={ref} {...nativeSafeProps(props)}>
      {children}
    </NativeView>
  ),
)
Box.displayName = 'Box'

export { Box }
