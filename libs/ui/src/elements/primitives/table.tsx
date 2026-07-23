import * as React from 'react'
import { hostPrimitive } from './_host.tsx'

/**
 * Table-family passthrough primitives (Phase 0): `<table>`/`<thead>`/`<tbody>`/`<tfoot>`/
 * `<tr>`/`<th>`/`<td>`/`<caption>`/`<colgroup>`/`<col>`. Pure passthroughs. Native has no table
 * layout; Phase 1's native fork renders these as flex rows/cells (§7).
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §7.
 */
export const Table = hostPrimitive<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  'table',
  'Table',
)
export const Thead = hostPrimitive<HTMLTableSectionElement>('thead', 'Thead')
export const Tbody = hostPrimitive<HTMLTableSectionElement>('tbody', 'Tbody')
export const Tfoot = hostPrimitive<HTMLTableSectionElement>('tfoot', 'Tfoot')
export const Tr = hostPrimitive<HTMLTableRowElement>('tr', 'Tr')
export const Th = hostPrimitive<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  'th',
  'Th',
)
export const Td = hostPrimitive<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  'td',
  'Td',
)
export const Caption = hostPrimitive<HTMLTableCaptionElement>('caption', 'Caption')
