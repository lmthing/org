/** network-panel.styled.tsx — P2 conversion of the `.computer-network-panel` BEM block (docs §4).
 *  One styled() per BEM selector; the `__status` `--ok/--error` modifiers become a `state` variant.
 *  Lands alongside the shipped className panel. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.computer-network-panel` — flex, flex-col, gap-1. */
export const ComputerNetworkPanelFrame = styled(View, {
  name: 'ComputerNetworkPanel',
  display: 'flex',
  flexDirection: 'column',
  gap: '$1',
})

/** `.computer-network-panel__entry` — flex, items-center, gap-3, text-sm. */
export const ComputerNetworkPanelEntryFrame = styled(View, {
  name: 'ComputerNetworkPanelEntry',
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
  fontSize: '$sm',
})

/** `.computer-network-panel__method` — font-mono, text-xs, font-medium, shrink-0, w-12. */
export const ComputerNetworkPanelMethodFrame = styled(Text, {
  name: 'ComputerNetworkPanelMethod',
  fontFamily: 'monospace',
  fontSize: '$xs',
  fontWeight: '$medium',
  flexShrink: 0,
  width: '$12',
})

/** `.computer-network-panel__url` — truncate, flex-1. */
export const ComputerNetworkPanelUrlFrame = styled(Text, {
  name: 'ComputerNetworkPanelUrl',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.computer-network-panel__status` — the `--ok` (text-success) / `--error` (text-destructive) states. */
export const ComputerNetworkPanelStatusFrame = styled(Text, {
  name: 'ComputerNetworkPanelStatus',

  variants: {
    state: {
      ok: { color: '$success' },
      error: { color: '$destructive' },
    },
  } as const,
})

/** `.computer-network-panel__empty` — text-sm, text-muted-foreground, py-4, text-center. */
export const ComputerNetworkPanelEmptyFrame = styled(Text, {
  name: 'ComputerNetworkPanelEmpty',
  fontSize: '$sm',
  color: '$muted-foreground',
  paddingVertical: '$4',
  textAlign: 'center',
})

export type NetworkStatusState = 'ok' | 'error'

export interface StyledComputerNetworkPanelProps extends React.ComponentProps<'div'> {}

const Frame = ComputerNetworkPanelFrame as unknown as React.ComponentType<any>
export function StyledComputerNetworkPanel({ ...props }: StyledComputerNetworkPanelProps) {
  return <Frame {...props} />
}
