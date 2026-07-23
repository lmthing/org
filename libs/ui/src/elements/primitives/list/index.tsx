import * as React from 'react'
import { hostPrimitive } from '../_host.tsx'

/**
 * List / ListItem — the `<ul>`/`<ol>` + `<li>` primitives (Phase 0). Pure passthrough.
 * `ordered` renders `<ol>`. Phase 1 maps these to Tamagui `YStack`/list rows (native
 * `FlatList` where virtualization matters — see the `Tree`→`FlatList` note in §7).
 *
 * (Distinct from the styled `elements/content/list-item` row component, which is a themed item.)
 *
 * See docs/react-native-tamagui-migration.md §1.5.
 */
export type ListProps = React.HTMLAttributes<HTMLElement> & {
  /** Render an ordered `<ol>` instead of an unordered `<ul>`. */
  ordered?: boolean
}

const List = React.forwardRef<HTMLElement, ListProps>(({ ordered, ...props }, ref) =>
  React.createElement((ordered ? 'ol' : 'ul') as string, { ...props, ref }),
)
List.displayName = 'List'

export type ListItemProps = React.LiHTMLAttributes<HTMLLIElement>

const ListItem = hostPrimitive<HTMLLIElement, ListItemProps>('li', 'ListItem')

export { List, ListItem }
