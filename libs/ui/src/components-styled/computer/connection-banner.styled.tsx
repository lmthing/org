/** connection-banner.styled.tsx — P2 conversion of the `.computer-connection-banner` BEM block
 *  (docs §4). The `--error/--booting` modifiers on the banner and dot become a shared `state`
 *  variant. Lands alongside the shipped className banner. */
import * as React from 'react'
import { styled, View } from '../../theme/tamagui-web.config'

/**
 * `.computer-connection-banner` — flex, items-center, justify-between, gap-3, px-4, py-2, text-sm +
 * the `--error`/`--booting` tinted surfaces (bg-<c>/10, text-<c>, border-b border-<c>/20) as a
 * `state` variant. Alphas via web color-mix over the runtime vars.
 */
export const ComputerConnectionBannerFrame = styled(View, {
  name: 'ComputerConnectionBanner',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '$3',
  paddingHorizontal: '$4',
  paddingVertical: '$2',
  fontSize: '$sm',

  variants: {
    state: {
      error: {
        backgroundColor: 'color-mix(in srgb, var(--destructive) 10%, transparent)',
        color: '$destructive',
        borderBottomWidth: 1,
        borderBottomColor: 'color-mix(in srgb, var(--destructive) 20%, transparent)',
      },
      booting: {
        backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)',
        color: '$warning',
        borderBottomWidth: 1,
        borderBottomColor: 'color-mix(in srgb, var(--warning) 20%, transparent)',
      },
    },
  } as const,
})

/** `.computer-connection-banner__message` — flex, items-center, gap-2, flex-1. */
export const ComputerConnectionBannerMessageFrame = styled(View, {
  name: 'ComputerConnectionBannerMessage',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/**
 * `.computer-connection-banner__dot` — w-2, h-2, rounded-full, shrink-0 + the `--error`/`--booting`
 * background modifiers as a `state` variant. (animate-pulse awaits the animation driver.)
 */
export const ComputerConnectionBannerDotFrame = styled(View, {
  name: 'ComputerConnectionBannerDot',
  width: '$2',
  height: '$2',
  borderRadius: '$radius-full',
  flexShrink: 0,

  variants: {
    state: {
      // animate-pulse awaits the animation driver (§5/P4)
      error: { backgroundColor: '$destructive' },
      booting: { backgroundColor: '$warning' },
    },
  } as const,
})

export type ConnectionBannerState = 'error' | 'booting'

export interface StyledComputerConnectionBannerProps extends React.ComponentProps<'div'> {
  state?: ConnectionBannerState
}

const Frame = ComputerConnectionBannerFrame as unknown as React.ComponentType<any>
export function StyledComputerConnectionBanner({ state, ...props }: StyledComputerConnectionBannerProps) {
  return <Frame state={state} {...props} />
}
