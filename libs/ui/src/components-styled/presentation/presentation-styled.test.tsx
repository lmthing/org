import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  PresentationSlideFrame,
  PresentationHeadlineFrame,
  PresentationFlowNodeFrame,
  PresentationGrid3Frame,
  PresentationShellFrame,
  PresentationExitBtnFrame,
  StyledSlide,
} from './presentation.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const slide = (PresentationSlideFrame as unknown as { staticConfig: any }).staticConfig
const headline = (PresentationHeadlineFrame as unknown as { staticConfig: any }).staticConfig
const flowNode = (PresentationFlowNodeFrame as unknown as { staticConfig: any }).staticConfig
const grid = (PresentationGrid3Frame as unknown as { staticConfig: any }).staticConfig
const shell = (PresentationShellFrame as unknown as { staticConfig: any }).staticConfig
const exit = (PresentationExitBtnFrame as unknown as { staticConfig: any }).staticConfig

describe('.slide / .presentation → styled()', () => {
  it('slide base is a full-size column', () => {
    expect(slide.defaultProps).toMatchObject({ display: 'flex', height: '100%', width: '100%', flexDirection: 'column' })
  })

  it('slide exposes the layout modifier variants', () => {
    expect(slide.variants.centered.true).toMatchObject({ alignItems: 'center', justifyContent: 'center' })
    expect(slide.variants.padded.true).toMatchObject({ paddingTop: '$12', paddingHorizontal: '$16' })
    expect(slide.variants.row.true).toMatchObject({ flexDirection: 'row' })
  })

  it('headline xl variant carries the responsive text-7xl bump', () => {
    expect(headline.variants.size.xl).toMatchObject({ fontSize: '$6xl', $gtXs: { fontSize: '$7xl' } })
  })

  it('flow-node exposes hero/regular variants (shadow via compact rgba)', () => {
    expect(flowNode.variants.kind.hero).toMatchObject({ borderWidth: 2, height: 76, shadowColor: 'rgba(0,0,0,0.12)' })
    expect(flowNode.variants.kind.regular).toMatchObject({ borderRadius: 16, fontSize: '$xl' })
  })

  it('grid-3 emits a real CSS grid template', () => {
    expect(grid.defaultProps).toMatchObject({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' })
  })

  it('shell fills the viewport with the background token', () => {
    expect(shell.defaultProps).toMatchObject({ height: '100vh', width: '100vw', backgroundColor: '$background' })
  })

  it('exit-btn hover tint is a compact rgba (no token for translucent black)', () => {
    expect(exit.defaultProps.hoverStyle).toMatchObject({ backgroundColor: 'rgba(0,0,0,0.05)' })
  })
})

describe('StyledSlide renders', () => {
  it('renders the slide frame with a layout variant', () => {
    const { container } = render(<P><StyledSlide centered padded /></P>)
    expect(container.querySelector('.is_PresentationSlide')).toBeTruthy()
  })
})
