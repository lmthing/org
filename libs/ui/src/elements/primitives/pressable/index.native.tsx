import * as React from 'react'
import { NativeView, toPressHandler } from '../_native'

/**
 * Pressable (native fork). A Tamagui/RN pressable `View` (`onPress`), mapping the web `onClick`
 * onto it. Same prop shape as the web `Pressable` so surfaces are cross-target; `as`/anchor attrs
 * are web-only. Web keeps `index.tsx`. See docs/react-native-tamagui-migration.md §1.6 / §7.
 */
export type PressableAs = 'button' | 'a' | 'div'

export type PressableProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  Pick<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    'href' | 'target' | 'rel' | 'download' | 'referrerPolicy' | 'hrefLang'
  > & {
    as?: PressableAs
  }

const Pressable = React.forwardRef<any, PressableProps>(
  ({ style, children, onClick, disabled }, ref) => (
    <NativeView
      ref={ref}
      style={style as never}
      onPress={disabled ? undefined : toPressHandler(onClick)}
    >
      {children}
    </NativeView>
  ),
)
Pressable.displayName = 'Pressable'

export { Pressable }
