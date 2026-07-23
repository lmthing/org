import * as React from 'react'
import { NativeView } from '../_native'

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
  ({ style, children }, ref) => (
    <NativeView ref={ref} style={style as never}>
      {children}
    </NativeView>
  ),
)
List.displayName = 'List'

export type ListItemProps = React.LiHTMLAttributes<HTMLLIElement>

const ListItem = React.forwardRef<any, ListItemProps>(
  ({ style, children }, ref) => (
    <NativeView ref={ref} style={style as never}>
      {children}
    </NativeView>
  ),
)
ListItem.displayName = 'ListItem'

export { List, ListItem }
