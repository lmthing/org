import * as React from 'react'
import { styled, View } from '../_native'

/**
 * Col (native fork). A Tamagui/RN `View` with an EXPLICIT `flexDirection: 'column'` (RN's default,
 * set explicitly for symmetry with Row). Same prop shape as the web `Col`. Web keeps `index.tsx`.
 * See docs/react-native-tamagui-migration.md §1.6 / §7.
 */
const ColView: React.ComponentType<any> = styled(View, {
  name: 'Col',
  flexDirection: 'column',
}) as unknown as React.ComponentType<any>

export type ColProps = React.HTMLAttributes<HTMLDivElement>

const Col = React.forwardRef<any, ColProps>(({ style, children }, ref) => (
  <ColView ref={ref} style={style as never}>
    {children}
  </ColView>
))
Col.displayName = 'Col'

export { Col }
