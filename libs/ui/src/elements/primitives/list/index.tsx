import * as React from 'react'

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

function List({ ordered, ...props }: ListProps) {
  const Tag = (ordered ? 'ol' : 'ul') as React.ElementType
  return <Tag {...props} />
}

export type ListItemProps = React.LiHTMLAttributes<HTMLLIElement>

function ListItem(props: ListItemProps) {
  return <li {...props} />
}

export { List, ListItem }
