import * as React from 'react'
import { styled, View } from '../_native'

/**
 * Row (native fork). A Tamagui/RN `View` with an EXPLICIT `flexDirection: 'row'` — the native
 * counterpart of a web flex-row. Same prop shape as the web `Row`. Web keeps `index.tsx`.
 * See docs/react-native-tamagui-migration.md §1.6 / §7.
 */
const RowView: React.ComponentType<any> = styled(View, {
  name: 'Row',
  flexDirection: 'row',
}) as unknown as React.ComponentType<any>

export type RowProps = React.HTMLAttributes<HTMLDivElement>

const Row = React.forwardRef<any, RowProps>(({ style, children }, ref) => (
  <RowView ref={ref} style={style as never}>
    {children}
  </RowView>
))
Row.displayName = 'Row'

export { Row }
