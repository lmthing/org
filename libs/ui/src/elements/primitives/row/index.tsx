import * as React from 'react'

/**
 * Row — an explicit horizontal flex container (Phase 0).
 *
 * Pure passthrough in Phase 0 (emits a `<div>` with the caller's props verbatim, identical
 * DOM to `Box`). Its value is as a distinct migration seam: the codemod converts flex-row
 * `<div>`s to `<Row>` so no layout relies on an implicit box-model default. In Phase 1,
 * Row's internals set an EXPLICIT `flexDirection: 'row'` (never a Tamagui/RN default), which
 * is what de-risks the box-model swap (§1 table, §4).
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export type RowProps = React.HTMLAttributes<HTMLDivElement>

function Row(props: RowProps) {
  return <div {...props} />
}

export { Row }
