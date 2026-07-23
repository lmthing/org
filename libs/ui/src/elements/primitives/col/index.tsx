import * as React from 'react'
import { hostPrimitive } from '../_host'

/**
 * Col — an explicit vertical flex container (Phase 0).
 *
 * Pure passthrough in Phase 0 (emits a `<div>` with the caller's props verbatim, identical
 * DOM to `Box`). Distinct migration seam: flex-column `<div>`s become `<Col>`; Phase 1 gives
 * Col's internals an EXPLICIT `flexDirection: 'column'` (§1 table, §4).
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export type ColProps = React.HTMLAttributes<HTMLDivElement>

const Col = hostPrimitive<HTMLDivElement, ColProps>('div', 'Col')

export { Col }
