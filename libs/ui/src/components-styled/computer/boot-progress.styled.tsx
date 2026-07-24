/** boot-progress.styled.tsx — P2 conversion of the `.computer-boot-progress` BEM block (docs §4).
 *  One styled() per BEM selector; the `__step` `--done/--active` modifiers become a `state` variant.
 *  Lands alongside the shipped className boot progress. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.computer-boot-progress` — flex, flex-col, items-center, justify-center, gap-4, p-8, h-full, min-h-[300px]. */
export const ComputerBootProgressFrame = styled(View, {
  name: 'ComputerBootProgress',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$4',
  padding: '$8',
  height: '100%',
  minHeight: 300,
})

/**
 * `.computer-boot-progress__spinner` — w-8, h-8, border-2, border-muted-foreground/30 (via color-mix),
 * border-t-primary, rounded-full. (animate-spin awaits the animation driver.)
 */
export const ComputerBootProgressSpinnerFrame = styled(View, {
  name: 'ComputerBootProgressSpinner',
  width: '$8',
  height: '$8',
  borderWidth: 2,
  borderColor: 'color-mix(in srgb, var(--muted-foreground) 30%, transparent)',
  borderTopColor: '$primary',
  borderRadius: '$radius-full',
  // animate-spin awaits the animation driver (§5/P4)
})

/** `.computer-boot-progress__label` — text-sm, font-medium, text-muted-foreground. */
export const ComputerBootProgressLabelFrame = styled(Text, {
  name: 'ComputerBootProgressLabel',
  fontSize: '$sm',
  fontWeight: '$medium',
  color: '$muted-foreground',
})

/**
 * `.computer-boot-progress__steps` — flex, flex-col, gap-1, text-xs, text-muted-foreground/60
 * (alpha via color-mix over the runtime var).
 */
export const ComputerBootProgressStepsFrame = styled(View, {
  name: 'ComputerBootProgressSteps',
  display: 'flex',
  flexDirection: 'column',
  gap: '$1',
  fontSize: '$xs',
  color: 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)',
})

/**
 * `.computer-boot-progress__step` — flex, items-center, gap-2 + the `--done` (text-success) /
 * `--active` (text-foreground) modifiers as a `state` variant.
 */
export const ComputerBootProgressStepFrame = styled(View, {
  name: 'ComputerBootProgressStep',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',

  variants: {
    state: {
      done: { color: '$success' },
      active: { color: '$foreground' },
    },
  } as const,
})

export type BootStepState = 'done' | 'active'

export interface StyledComputerBootProgressProps extends React.ComponentProps<'div'> {}

const Frame = ComputerBootProgressFrame as unknown as React.ComponentType<any>
export function StyledComputerBootProgress({ ...props }: StyledComputerBootProgressProps) {
  return <Frame {...props} />
}
