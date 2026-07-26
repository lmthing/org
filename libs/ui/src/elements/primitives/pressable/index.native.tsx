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

/**
 * The SAME props type the web sibling exports, imported rather than redeclared. A redeclared
 * `React.*HTMLAttributes` was never checked against anything: `tsc` only ever resolves `index.tsx`,
 * so the fork's own claim about its props could disagree with both the caller and the
 * implementation. `import type` is erased by the transform, so `_tamagui.tsx` stays out of the
 * native graph (verified against the graph, not assumed).
 */
import type { PressablePrimitiveProps } from '../_tamagui'

export type PressableProps = PressablePrimitiveProps

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
