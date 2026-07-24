import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { ComputerLayoutFrame, ComputerLayoutContentFrame, ComputerLayoutMainFrame, StyledComputerLayout } from './computer-layout.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const layout = (ComputerLayoutFrame as unknown as { staticConfig: any }).staticConfig
const content = (ComputerLayoutContentFrame as unknown as { staticConfig: any }).staticConfig
const main = (ComputerLayoutMainFrame as unknown as { staticConfig: any }).staticConfig

describe('.computer-layout → styled()', () => {
  it('base is a full-height clipped flex row', () => {
    expect(layout.defaultProps).toMatchObject({ display: 'flex', height: '100vh', overflow: 'hidden' })
  })
  it('__content is a min-w-0 flex-1 column', () => {
    expect(content.defaultProps).toMatchObject({ flexGrow: 1, flexDirection: 'column', minWidth: 0 })
  })
  it('__main is a scrollable flex-1 region', () => {
    expect(main.defaultProps).toMatchObject({ flexGrow: 1, overflow: 'auto' })
  })
})

describe('StyledComputerLayout renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledComputerLayout /></P>)
    expect(container.querySelector('.is_ComputerLayout')).toBeTruthy()
  })
})
