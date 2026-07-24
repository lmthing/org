/** computer-layout.styled.tsx — P2 conversion of the `.computer-layout` BEM block (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className layout. */
import * as React from 'react'
import { styled, View } from '../../theme/tamagui-web.config'

/** `.computer-layout` — flex, h-screen, overflow-hidden. */
export const ComputerLayoutFrame = styled(View, {
  name: 'ComputerLayout',
  display: 'flex',
  height: '100vh',
  overflow: 'hidden',
})

/** `.computer-layout__content` — flex-1, flex, flex-col, min-w-0. */
export const ComputerLayoutContentFrame = styled(View, {
  name: 'ComputerLayoutContent',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
})

/** `.computer-layout__main` — flex-1, overflow-auto. */
export const ComputerLayoutMainFrame = styled(View, {
  name: 'ComputerLayoutMain',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflow: 'auto',
})

export interface StyledComputerLayoutProps extends React.ComponentProps<'div'> {}

const Frame = ComputerLayoutFrame as unknown as React.ComponentType<any>
export function StyledComputerLayout({ ...props }: StyledComputerLayoutProps) {
  return <Frame {...props} />
}
