import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  ComputerMetricsCardFrame,
  ComputerMetricsCardRowFrame,
  ComputerMetricsCardBarFrame,
  ComputerMetricsCardBarFillFrame,
  StyledComputerMetricsCard,
} from './metrics-card.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const card = (ComputerMetricsCardFrame as unknown as { staticConfig: any }).staticConfig
const row = (ComputerMetricsCardRowFrame as unknown as { staticConfig: any }).staticConfig
const bar = (ComputerMetricsCardBarFrame as unknown as { staticConfig: any }).staticConfig
const fill = (ComputerMetricsCardBarFillFrame as unknown as { staticConfig: any }).staticConfig

describe('.computer-metrics-card → styled()', () => {
  it('base is a gap-3 column', () => {
    expect(card.defaultProps).toMatchObject({ flexDirection: 'column', gap: '$3' })
  })
  it('__row spreads items apart', () => {
    expect(row.defaultProps).toMatchObject({ alignItems: 'center', justifyContent: 'space-between' })
  })
  it('__bar is a muted rounded track', () => {
    expect(bar.defaultProps).toMatchObject({ height: '$2', width: '100%', borderRadius: '$radius-full', backgroundColor: '$muted', overflow: 'hidden' })
  })
  it('__bar-fill is a primary fill', () => {
    expect(fill.defaultProps).toMatchObject({ height: '100%', backgroundColor: '$primary' })
  })
})

describe('StyledComputerMetricsCard renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledComputerMetricsCard /></P>)
    expect(container.querySelector('.is_ComputerMetricsCard')).toBeTruthy()
  })
})
