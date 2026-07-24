/** computer-dashboard.styled.tsx — P2 conversion of the `.computer-dashboard` BEM block (docs §4).
 *  One styled() per BEM selector; responsive grid modifiers → media props. Lands alongside the
 *  shipped className dashboard. */
import * as React from 'react'
import { styled, View } from '../../theme/tamagui-web.config'

/**
 * `.computer-dashboard` — grid, grid-cols-1, md:grid-cols-2, xl:grid-cols-3, gap-4, p-4.
 * Responsive columns via media props (md:→$gtSm, xl:→$gtLg).
 */
export const ComputerDashboardFrame = styled(View, {
  name: 'ComputerDashboard',
  display: 'grid',
  gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
  gap: '$4',
  padding: '$4',
  $gtSm: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  $gtLg: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
})

/** `.computer-dashboard__full-width` — md:col-span-2, xl:col-span-3. */
export const ComputerDashboardFullWidthFrame = styled(View, {
  name: 'ComputerDashboardFullWidth',
  $gtSm: { gridColumn: 'span 2 / span 2' },
  $gtLg: { gridColumn: 'span 3 / span 3' },
})

export interface StyledComputerDashboardProps extends React.ComponentProps<'div'> {}

const Frame = ComputerDashboardFrame as unknown as React.ComponentType<any>
export function StyledComputerDashboard({ ...props }: StyledComputerDashboardProps) {
  return <Frame {...props} />
}
