import * as React from 'react'

/**
 * Link — the `<a>` primitive (Phase 0). Pure passthrough. Phase 1 maps `onPress`→`onClick`
 * on web and to a native pressable/linking handler on RN.
 *
 * See docs/react-native-tamagui-migration.md §1.5.
 */
export type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement>

function Link(props: LinkProps) {
  return <a {...props} />
}

export { Link }
