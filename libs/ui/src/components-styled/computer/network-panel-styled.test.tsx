import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  ComputerNetworkPanelFrame,
  ComputerNetworkPanelEntryFrame,
  ComputerNetworkPanelMethodFrame,
  ComputerNetworkPanelUrlFrame,
  ComputerNetworkPanelStatusFrame,
  ComputerNetworkPanelEmptyFrame,
  StyledComputerNetworkPanel,
} from './network-panel.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const panel = (ComputerNetworkPanelFrame as unknown as { staticConfig: any }).staticConfig
const entry = (ComputerNetworkPanelEntryFrame as unknown as { staticConfig: any }).staticConfig
const method = (ComputerNetworkPanelMethodFrame as unknown as { staticConfig: any }).staticConfig
const url = (ComputerNetworkPanelUrlFrame as unknown as { staticConfig: any }).staticConfig
const status = (ComputerNetworkPanelStatusFrame as unknown as { staticConfig: any }).staticConfig

describe('.computer-network-panel → styled()', () => {
  it('base is a gap-1 column', () => {
    expect(panel.defaultProps).toMatchObject({ flexDirection: 'column', gap: '$1' })
  })
  it('__entry is a gap-3 text-sm row', () => {
    expect(entry.defaultProps).toMatchObject({ alignItems: 'center', gap: '$3', fontSize: '$sm' })
  })
  it('__method is a fixed-width mono cell', () => {
    expect(method.defaultProps).toMatchObject({ fontFamily: 'monospace', fontSize: '$xs', flexShrink: 0, width: '$12' })
  })
  it('__url truncates and grows', () => {
    expect(url.defaultProps).toMatchObject({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexGrow: 1 })
  })
  it('__status maps ok/error to color tokens', () => {
    expect(status.variants.state.ok).toMatchObject({ color: '$success' })
    expect(status.variants.state.error).toMatchObject({ color: '$destructive' })
  })
})

describe('StyledComputerNetworkPanel renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledComputerNetworkPanel /></P>)
    expect(container.querySelector('.is_ComputerNetworkPanel')).toBeTruthy()
  })
})
