import * as React from 'react'
import { NativeView, nativeSafeProps } from '../_native'

/**
 * Pressable (native fork). A Tamagui/RN pressable `View` (`onPress`), mapping the web `onClick`
 * onto it. Same prop shape as the web `Pressable` so surfaces are cross-target; `as`/anchor attrs
 * are web-only. Style props reach the view through `nativeSafeProps`, which is what makes
 * `pressStyle`/`hoverStyle` and `$`-token padding work on this target too.
 * Web keeps `index.tsx`. See docs/react-native-tamagui-migration.md §1.6 / §7.
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
  ({ children, disabled, ...props }, ref) => {
    // `nativeSafeProps` maps `onClick` → `onPress`; `disabled` then withholds it, so a disabled
    // control mounts with no press responder at all rather than one that quietly does nothing.
    const { onPress, ...rest } = nativeSafeProps(props)
    return (
      <NativeView ref={ref} disabled={disabled} onPress={disabled ? undefined : onPress} {...rest}>
        {children}
      </NativeView>
    )
  },
)
Pressable.displayName = 'Pressable'

export { Pressable }
