import * as React from 'react'
import { NativeView, nativeSafeProps } from '../_native'

/**
 * List / ListItem (native fork). Tamagui/RN `View`s (a column stack + rows). Same prop shapes as
 * the web primitives; `ordered` is accepted (numbering is a follow-up — a virtualized `FlatList`
 * is the target where item counts are large, see §7). Web keeps `index.tsx`.
 * See docs/react-native-tamagui-migration.md §1.6 / §7.
 */
export type ListProps = React.HTMLAttributes<HTMLElement> & {
  ordered?: boolean
}

const List = React.forwardRef<any, ListProps>(
  // `ordered` is consumed here, not forwarded: it is a numbering hint with no RN prop behind it.
  ({ children, ordered: _ordered, ...props }, ref) => (
    <NativeView ref={ref} {...nativeSafeProps(props)}>
      {children}
    </NativeView>
  ),
)
List.displayName = 'List'

export type ListItemProps = React.LiHTMLAttributes<HTMLLIElement>

const ListItem = React.forwardRef<any, ListItemProps>(
  ({ children, ...props }, ref) => (
    <NativeView ref={ref} {...nativeSafeProps(props)}>
      {children}
    </NativeView>
  ),
)
ListItem.displayName = 'ListItem'

export { List, ListItem }
