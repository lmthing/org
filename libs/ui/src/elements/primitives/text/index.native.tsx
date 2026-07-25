import * as React from 'react'
import { NativeText, nativeSafeProps } from '../_native'

/**
 * Text (native fork). Renders a Tamagui/RN `Text`. Same prop shape as the web `Text` (so surfaces
 * are cross-target); `as`/`block`/`htmlFor` are web-only and dropped. Everything else goes through
 * `nativeSafeProps`, so `$`-token typography props (`fontSize="$sm"`, `color="$muted-foreground"`)
 * style the native text exactly as they style the web one. Web keeps `index.tsx`.
 * See docs/react-native-tamagui-migration.md §1.6 / §7.
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
  // `block` is a web display hint with no RN equivalent (an RN Text is already a block box).
  ({ children, block: _block, ...props }, ref) => (
    <NativeText ref={ref} {...nativeSafeProps(props)}>
      {children}
    </NativeText>
  ),
)
Text.displayName = 'Text'

export { Text }
