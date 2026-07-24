/** metrics-card.styled.tsx — P2 conversion of the `.computer-metrics-card` BEM block (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className card. */
import * as React from 'react'
import { styled, View } from '../../theme/tamagui-web.config'

/** `.computer-metrics-card` — flex, flex-col, gap-3. */
export const ComputerMetricsCardFrame = styled(View, {
  name: 'ComputerMetricsCard',
  display: 'flex',
  flexDirection: 'column',
  gap: '$3',
})

/** `.computer-metrics-card__row` — flex, items-center, justify-between. */
export const ComputerMetricsCardRowFrame = styled(View, {
  name: 'ComputerMetricsCardRow',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
})

/** `.computer-metrics-card__bar` — h-2, w-full, rounded-full, bg-muted, overflow-hidden. */
export const ComputerMetricsCardBarFrame = styled(View, {
  name: 'ComputerMetricsCardBar',
  height: '$2',
  width: '100%',
  borderRadius: '$radius-full',
  backgroundColor: '$muted',
  overflow: 'hidden',
})

/** `.computer-metrics-card__bar-fill` — h-full, rounded-full, bg-primary. */
export const ComputerMetricsCardBarFillFrame = styled(View, {
  name: 'ComputerMetricsCardBarFill',
  height: '100%',
  borderRadius: '$radius-full',
  backgroundColor: '$primary',
  // transition-all duration-300 await the animation driver (§5/P4)
})

export interface StyledComputerMetricsCardProps extends React.ComponentProps<'div'> {}

const Frame = ComputerMetricsCardFrame as unknown as React.ComponentType<any>
export function StyledComputerMetricsCard({ ...props }: StyledComputerMetricsCardProps) {
  return <Frame {...props} />
}
