/** status-card.styled.tsx — P2 conversion of the `.computer-status-card` BEM block (docs §4).
 *  One styled() per BEM selector; the `--running/--booting/--stopped/--error` modifiers on the
 *  indicator + dot become a shared `status` variant. Lands alongside the shipped className card. */
import * as React from 'react'
import { styled, View } from '../../theme/tamagui-web.config'

/** `.computer-status-card` — flex, flex-col, gap-2. */
export const ComputerStatusCardFrame = styled(View, {
  name: 'ComputerStatusCard',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2',
})

/**
 * `.computer-status-card__indicator` — inline-flex, items-center, gap-1.5, text-sm, font-medium +
 * the `--running/--booting/--stopped/--error` color modifiers as a `status` variant.
 */
export const ComputerStatusCardIndicatorFrame = styled(View, {
  name: 'ComputerStatusCardIndicator',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '$1.5',
  fontSize: '$sm',
  fontWeight: '$medium',

  variants: {
    status: {
      running: { color: '$success' },
      booting: { color: '$warning' },
      stopped: { color: '$muted-foreground' },
      error: { color: '$destructive' },
    },
  } as const,
})

/**
 * `.computer-status-card__dot` — w-2, h-2, rounded-full + the `--running/--booting/--stopped/--error`
 * background modifiers as a `status` variant. (`--booting` animate-pulse awaits the animation driver.)
 */
export const ComputerStatusCardDotFrame = styled(View, {
  name: 'ComputerStatusCardDot',
  width: '$2',
  height: '$2',
  borderRadius: '$radius-full',

  variants: {
    status: {
      running: { backgroundColor: '$success' },
      // animate-pulse awaits the animation driver (§5/P4)
      booting: { backgroundColor: '$warning' },
      stopped: { backgroundColor: '$muted-foreground' },
      error: { backgroundColor: '$destructive' },
    },
  } as const,
})

export type ComputerStatus = 'running' | 'booting' | 'stopped' | 'error'

export interface StyledComputerStatusCardProps extends React.ComponentProps<'div'> {}

const Frame = ComputerStatusCardFrame as unknown as React.ComponentType<any>
export function StyledComputerStatusCard({ ...props }: StyledComputerStatusCardProps) {
  return <Frame {...props} />
}
