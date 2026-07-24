import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { ComputerDashboardFrame, ComputerDashboardFullWidthFrame, StyledComputerDashboard } from './computer-dashboard.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const dash = (ComputerDashboardFrame as unknown as { staticConfig: any }).staticConfig
const full = (ComputerDashboardFullWidthFrame as unknown as { staticConfig: any }).staticConfig

describe('.computer-dashboard → styled()', () => {
  it('base is a single-column grid with padding + gap', () => {
    expect(dash.defaultProps).toMatchObject({
      display: 'grid',
      gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
      gap: '$4',
      padding: '$4',
    })
  })
  it('grows to 2 then 3 columns at the responsive breakpoints', () => {
    expect(dash.defaultProps.$gtSm).toMatchObject({ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' })
    expect(dash.defaultProps.$gtLg).toMatchObject({ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' })
  })
  it('__full-width spans across the grid at each breakpoint', () => {
    expect(full.defaultProps.$gtSm).toMatchObject({ gridColumn: 'span 2 / span 2' })
    expect(full.defaultProps.$gtLg).toMatchObject({ gridColumn: 'span 3 / span 3' })
  })
})

describe('StyledComputerDashboard renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledComputerDashboard /></P>)
    expect(container.querySelector('.is_ComputerDashboard')).toBeTruthy()
  })
})
