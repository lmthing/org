import * as React from 'react'
import { hostPrimitive } from './_host'
import { TableLeaf, TheadLeaf, TbodyLeaf, TfootLeaf, TrLeaf, ThLeaf, TdLeaf } from './_tamagui'

/**
 * Table-family primitives. `table`/`thead`/`tbody`/`tfoot`/`tr`/`th`/`td` are Tamagui-backed leaves
 * (`_tamagui.tsx`): each renders its real tag with its own `display` (`table`, `table-row`,
 * `table-cell`, …) rather than Tamagui's `flex` default, so table layout is unchanged — and style
 * PROPS now work on them, which they did not while these were `hostPrimitive` passthroughs (a
 * passthrough forwards props to a raw host tag, which ignores every style prop).
 *
 * `<caption>` stays a passthrough: nothing styles it. Native has no table layout; the `.native.tsx`
 * fork renders these as flex rows/cells (§7).
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §7 · docs/tamagui-idiomatic-migration.md §5.
 */
export const Table = TableLeaf
export const Thead = TheadLeaf
export const Tbody = TbodyLeaf
export const Tfoot = TfootLeaf
export const Tr = TrLeaf
export const Th = ThLeaf
export const Td = TdLeaf
export const Caption = hostPrimitive<HTMLTableCaptionElement>('caption', 'Caption')
