import * as React from 'react'
import { Linking } from 'react-native'
import { NativeText } from '../_native'

/**
 * Link (native fork). A pressable Tamagui/RN `Text` that opens `href` via `Linking.openURL`.
 * Same prop shape as the web `Link` so surfaces are cross-target. Web keeps `index.tsx`.
 * (Typechecked in the mobile app, which provides react-native types.)
 * See docs/react-native-tamagui-migration.md §1.6 / §7.
 */
export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement>

// `NativeText` is a `ComponentType<any>`, not a `ForwardRefExoticComponent`, so `ElementRef` cannot
// be applied to it — there is no element type to extract. The ref is forwarded opaquely.
const Link = React.forwardRef<unknown, LinkProps>(
  ({ href, style, children }, ref) => (
    <NativeText
      ref={ref}
      style={style as never}
      onPress={href ? () => void Linking.openURL(href) : undefined}
    >
      {children}
    </NativeText>
  ),
)
Link.displayName = 'Link'

export { Link }
