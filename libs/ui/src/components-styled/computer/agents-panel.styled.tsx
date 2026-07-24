/** agents-panel.styled.tsx — P2 conversion of the `.computer-agents-panel` BEM block (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className panel. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.computer-agents-panel` — flex, flex-col, gap-1. */
export const ComputerAgentsPanelFrame = styled(View, {
  name: 'ComputerAgentsPanel',
  display: 'flex',
  flexDirection: 'column',
  gap: '$1',
})

/** `.computer-agents-panel__empty` — text-sm, text-muted-foreground, py-4, text-center. */
export const ComputerAgentsPanelEmptyFrame = styled(Text, {
  name: 'ComputerAgentsPanelEmpty',
  fontSize: '$sm',
  color: '$muted-foreground',
  paddingVertical: '$4',
  textAlign: 'center',
})

export interface StyledComputerAgentsPanelProps extends React.ComponentProps<'div'> {}

const Frame = ComputerAgentsPanelFrame as unknown as React.ComponentType<any>
export function StyledComputerAgentsPanel({ ...props }: StyledComputerAgentsPanelProps) {
  return <Frame {...props} />
}
