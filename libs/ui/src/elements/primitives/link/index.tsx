import * as React from 'react'
import { hostPrimitive } from '../_host'

/**
 * Link — the `<a>` primitive (Phase 0). Pure passthrough. Phase 1 maps `onPress`→`onClick` on
 * web and to a native pressable/linking handler on RN.
 *
 * See docs/react-native-tamagui-migration.md §1.5.
 */
export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement>

const Link = hostPrimitive<HTMLAnchorElement, LinkProps>('a', 'Link')

export { Link }
