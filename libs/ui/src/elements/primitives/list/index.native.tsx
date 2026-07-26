import * as React from 'react'
import { NativeView, nativeSafeProps } from '../_native'

/**
 * List / ListItem (native fork). Tamagui/RN `View`s (a column stack + rows). Same prop shapes as
 * the web primitives; `ordered` is accepted (numbering is a follow-up — a virtualized `FlatList`
 * is the target where item counts are large, see §7). Web keeps `index.tsx`.
 * See docs/react-native-tamagui-migration.md §1.6 / §7.
 */
/**
 * The SAME props type the web sibling exports, imported rather than redeclared. A redeclared
 * `React.*HTMLAttributes` was never checked against anything: `tsc` only ever resolves `index.tsx`,
 * so the fork's own claim about its props could disagree with both the caller and the
 * implementation. `import type` is erased by the transform, so `_tamagui.tsx` stays out of the
 * native graph (verified against the graph, not assumed).
 */
import type { ListProps as ListPrimitiveProps } from '../_tamagui'

export type ListProps = ListPrimitiveProps

const List = React.forwardRef<any, ListProps>(
  // `ordered` is consumed here, not forwarded: it is a numbering hint with no RN prop behind it.
  ({ children, ordered: _ordered, ...props }, ref) => (
    <NativeView ref={ref} {...nativeSafeProps(props)}>
      {children}
    </NativeView>
  ),
)
List.displayName = 'List'

import type { ListItemProps as ListItemPrimitiveProps } from '../_tamagui'

export type ListItemProps = ListItemPrimitiveProps

const ListItem = React.forwardRef<any, ListItemProps>(
  ({ children, ...props }, ref) => (
    <NativeView ref={ref} {...nativeSafeProps(props)}>
      {children}
    </NativeView>
  ),
)
ListItem.displayName = 'ListItem'

export { List, ListItem }
