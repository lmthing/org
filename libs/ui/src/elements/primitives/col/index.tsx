import * as React from 'react'

/**
 * Col — an explicit vertical flex container (Phase 0).
 *
 * Pure passthrough in Phase 0 (emits a `<div>` with the caller's props verbatim, identical
 * DOM to `Box`). Distinct migration seam: flex-column `<div>`s become `<Col>` so no layout
 * relies on an implicit box-model default. In Phase 1, Col's internals set an EXPLICIT
 * `flexDirection: 'column'` (§1 table, §4).
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4.
 */
export type ColProps = React.HTMLAttributes<HTMLDivElement>

function Col(props: ColProps) {
  return <div {...props} />
}

export { Col }
