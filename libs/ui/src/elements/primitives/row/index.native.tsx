import * as React from 'react'
import { styled, View, nativeSafeProps } from '../_native'

/**
 * Row (native fork). A Tamagui/RN `View` with an EXPLICIT `flexDirection: 'row'` — the native
 * counterpart of a web flex-row. Same prop shape as the web `Row`. Web keeps `index.tsx`.
 * See docs/react-native-tamagui-migration.md §1.6 / §7.
 */
const RowView: React.ComponentType<any> = styled(View, {
  name: 'Row',
  flexDirection: 'row',
}) as unknown as React.ComponentType<any>

/**
 * The SAME props type the web sibling exports, imported rather than redeclared. A redeclared
 * `React.*HTMLAttributes` was never checked against anything: `tsc` only ever resolves `index.tsx`,
 * so the fork's own claim about its props could disagree with both the caller and the
 * implementation. `import type` is erased by the transform, so `_tamagui.tsx` stays out of the
 * native graph (verified against the graph, not assumed).
 */
import type { LayoutPrimitiveProps } from '../_tamagui'

export type RowProps = LayoutPrimitiveProps

const Row = React.forwardRef<any, RowProps>(({ children, ...props }, ref) => (
  <RowView ref={ref} {...nativeSafeProps(props)}>
    {children}
  </RowView>
))
Row.displayName = 'Row'

export { Row }
