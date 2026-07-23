import * as React from 'react'
import { hostPrimitive } from '../_host.tsx'

/**
 * Row — an explicit horizontal flex container (Phase 0).
 *
 * Pure passthrough in Phase 0 (emits a `<div>` with the caller's props verbatim, identical
 * DOM to `Box`). Distinct migration seam: flex-row `<div>`s become `<Row>` so no layout relies
 * on an implicit box-model default; Phase 1 gives Row's internals an EXPLICIT
 * `flexDirection: 'row'` (§1 table, §4).
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export type RowProps = React.HTMLAttributes<HTMLDivElement>

const Row = hostPrimitive<HTMLDivElement, RowProps>('div', 'Row')

export { Row }
