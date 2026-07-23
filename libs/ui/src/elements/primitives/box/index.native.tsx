import * as React from 'react'
import { NativeView } from '../_native'

/**
 * Box (native fork). Renders a Tamagui/RN `View`. Accepts the SAME prop shape as the web `Box`
 * so a surface component typechecks against both targets; web-only props (`className`, semantic
 * `as`, DOM events) are accepted and ignored/mapped. Layout for the className-driven surfaces
 * still needs a native styling story — see
 * `.issues/tamagui-web-swap-blocked-by-className-layout.md`. Web keeps `index.tsx` (Metro prefers
 * this `.native.tsx`). See docs/react-native-tamagui-migration.md §1.6 / §7.
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
  ({ style, children }, ref) => (
    <NativeView ref={ref} style={style as never}>
      {children}
    </NativeView>
  ),
)
Box.displayName = 'Box'

export { Box }
