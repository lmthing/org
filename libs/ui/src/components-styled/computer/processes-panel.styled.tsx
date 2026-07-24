/** processes-panel.styled.tsx — P2 conversion of the `.computer-processes-panel` BEM block (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className panel. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.computer-processes-panel` — flex, flex-col, gap-1. */
export const ComputerProcessesPanelFrame = styled(View, {
  name: 'ComputerProcessesPanel',
  display: 'flex',
  flexDirection: 'column',
  gap: '$1',
})

/** `.computer-processes-panel__empty` — text-sm, text-muted-foreground, py-4, text-center. */
export const ComputerProcessesPanelEmptyFrame = styled(Text, {
  name: 'ComputerProcessesPanelEmpty',
  fontSize: '$sm',
  color: '$muted-foreground',
  paddingVertical: '$4',
  textAlign: 'center',
})

export interface StyledComputerProcessesPanelProps extends React.ComponentProps<'div'> {}

const Frame = ComputerProcessesPanelFrame as unknown as React.ComponentType<any>
export function StyledComputerProcessesPanel({ ...props }: StyledComputerProcessesPanelProps) {
  return <Frame {...props} />
}
