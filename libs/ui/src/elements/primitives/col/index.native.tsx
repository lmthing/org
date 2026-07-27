import * as React from 'react'
import { styled, View, nativeSafeProps } from '../_native'

/**
 * Col (native fork). A Tamagui/RN `View` with an EXPLICIT `flexDirection: 'column'` (RN's default,
 * set explicitly for symmetry with Row). Same prop shape as the web `Col`. Web keeps `index.tsx`.
 * See docs/react-native-tamagui-migration.md §1.6 / §7.
 */
const ColView: React.ComponentType<any> = styled(View, {
  name: 'Col',
  flexDirection: 'column',
}) as unknown as React.ComponentType<any>

/**
 * The SAME props type the web sibling exports, imported rather than redeclared. A redeclared
 * `React.*HTMLAttributes` was never checked against anything: `tsc` only ever resolves `index.tsx`,
 * so the fork's own claim about its props could disagree with both the caller and the
 * implementation. `import type` is erased by the transform, so `_tamagui.tsx` stays out of the
 * native graph (verified against the graph, not assumed).
 */
import type { LayoutPrimitiveProps } from '../_tamagui'

export type ColProps = LayoutPrimitiveProps

const Col = React.forwardRef<any, ColProps>(({ children, ...props }, ref) => (
  // A `Col` that also writes `display: 'flex'` still means COLUMN — the seam's web-derived row
  // default would otherwise turn the primitive inside out.
  <ColView ref={ref} {...nativeSafeProps(props, { flexDirectionDefault: 'column' })}>
    {children}
  </ColView>
))
Col.displayName = 'Col'

export { Col }
