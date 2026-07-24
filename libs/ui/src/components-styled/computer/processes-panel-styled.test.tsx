import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { ComputerProcessesPanelFrame, ComputerProcessesPanelEmptyFrame, StyledComputerProcessesPanel } from './processes-panel.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const panel = (ComputerProcessesPanelFrame as unknown as { staticConfig: any }).staticConfig
const empty = (ComputerProcessesPanelEmptyFrame as unknown as { staticConfig: any }).staticConfig

describe('.computer-processes-panel → styled()', () => {
  it('base carries the @apply tokens', () => {
    expect(panel.defaultProps).toMatchObject({ flexDirection: 'column', gap: '$1' })
  })
  it('__empty is a centered muted label', () => {
    expect(empty.defaultProps).toMatchObject({ fontSize: '$sm', color: '$muted-foreground', textAlign: 'center' })
  })
})

describe('StyledComputerProcessesPanel renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledComputerProcessesPanel /></P>)
    expect(container.querySelector('.is_ComputerProcessesPanel')).toBeTruthy()
  })
})
