import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { ComputerStatusCardFrame, ComputerStatusCardIndicatorFrame, ComputerStatusCardDotFrame, StyledComputerStatusCard } from './status-card.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const card = (ComputerStatusCardFrame as unknown as { staticConfig: any }).staticConfig
const indicator = (ComputerStatusCardIndicatorFrame as unknown as { staticConfig: any }).staticConfig
const dot = (ComputerStatusCardDotFrame as unknown as { staticConfig: any }).staticConfig

describe('.computer-status-card → styled()', () => {
  it('base is a gap-2 column', () => {
    expect(card.defaultProps).toMatchObject({ flexDirection: 'column', gap: '$2' })
  })
  it('__indicator exposes a status variant for each state', () => {
    expect(Object.keys(indicator.variants.status).sort()).toEqual(['booting', 'error', 'running', 'stopped'])
    expect(indicator.variants.status.running).toMatchObject({ color: '$success' })
    expect(indicator.variants.status.error).toMatchObject({ color: '$destructive' })
  })
  it('__dot maps each state to a background token', () => {
    expect(dot.variants.status.running).toMatchObject({ backgroundColor: '$success' })
    expect(dot.variants.status.booting).toMatchObject({ backgroundColor: '$warning' })
    expect(dot.variants.status.stopped).toMatchObject({ backgroundColor: '$muted-foreground' })
    expect(dot.variants.status.error).toMatchObject({ backgroundColor: '$destructive' })
  })
})

describe('StyledComputerStatusCard renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledComputerStatusCard /></P>)
    expect(container.querySelector('.is_ComputerStatusCard')).toBeTruthy()
  })
})
