import * as React from 'react'
import { NativeText } from '../_native'

/**
 * Text (native fork). Renders a Tamagui/RN `Text`. Same prop shape as the web `Text` (so surfaces
 * are cross-target); `as`/`block`/`htmlFor` are web-only and ignored on native. Web keeps
 * `index.tsx`. See docs/react-native-tamagui-migration.md §1.6 / §7.
 */
export type TextAs =
  | 'span'
  | 'p'
  | 'strong'
  | 'em'
  | 'b'
  | 'i'
  | 'small'
  | 'label'
  | 'code'
  | 'kbd'
  | 'dt'
  | 'dd'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'pre'

export type TextProps = React.HTMLAttributes<HTMLElement> & {
  as?: TextAs
  block?: boolean
  htmlFor?: string
}

const Text = React.forwardRef<any, TextProps>(
  ({ style, children }, ref) => (
    <NativeText ref={ref} style={style as never}>
      {children}
    </NativeText>
  ),
)
Text.displayName = 'Text'

export { Text }
