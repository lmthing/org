import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  IdeLayoutFrame,
  IdeLayoutHeaderFrame,
  IdeLayoutTitleFrame,
  IdeLayoutStatusFrame,
  IdeLayoutBodyFrame,
  IdeLayoutNavBtnFrame,
  IdeLayoutRestartBtnFrame,
  IdeLayoutSplitFrame,
  IdeLayoutPaneFrame,
  IdeLayoutDividerFrame,
  StyledIdeLayout,
} from './ide-layout.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const root = (IdeLayoutFrame as unknown as { staticConfig: any }).staticConfig
const header = (IdeLayoutHeaderFrame as unknown as { staticConfig: any }).staticConfig
const title = (IdeLayoutTitleFrame as unknown as { staticConfig: any }).staticConfig
const status = (IdeLayoutStatusFrame as unknown as { staticConfig: any }).staticConfig
const body = (IdeLayoutBodyFrame as unknown as { staticConfig: any }).staticConfig
const navBtn = (IdeLayoutNavBtnFrame as unknown as { staticConfig: any }).staticConfig
const restartBtn = (IdeLayoutRestartBtnFrame as unknown as { staticConfig: any }).staticConfig
const split = (IdeLayoutSplitFrame as unknown as { staticConfig: any }).staticConfig
const pane = (IdeLayoutPaneFrame as unknown as { staticConfig: any }).staticConfig
const divider = (IdeLayoutDividerFrame as unknown as { staticConfig: any }).staticConfig

describe('.ide-layout → styled()', () => {
  it('base is a full-screen background column', () => {
    expect(root.defaultProps).toMatchObject({ flexDirection: 'column', height: '100vh', overflow: 'hidden', backgroundColor: '$background', color: '$foreground' })
  })
  it('__header is a fixed-height card bar', () => {
    expect(header.defaultProps).toMatchObject({ height: '$10', gap: '$3', backgroundColor: '$card', flexShrink: 0 })
  })
  it('__title / __status carry their tokens', () => {
    expect(title.defaultProps).toMatchObject({ fontSize: '$sm', fontWeight: '$semibold' })
    expect(status.defaultProps).toMatchObject({ marginLeft: 'auto', color: '$muted-foreground' })
  })
  it('__body is a clipped flex-1 region', () => {
    expect(body.defaultProps).toMatchObject({ flexGrow: 1, overflow: 'hidden' })
  })
  it('__nav-btn / __restart-btn are transparent borderless buttons', () => {
    expect(navBtn.defaultProps).toMatchObject({ backgroundColor: 'transparent', borderWidth: 0 })
    expect(navBtn.defaultProps.hoverStyle).toMatchObject({ color: '$foreground' })
    expect(restartBtn.defaultProps.disabledStyle).toMatchObject({ opacity: 0.4 })
  })
  it('__split exposes an orientation variant', () => {
    expect(split.variants.orientation.horizontal).toMatchObject({ flexDirection: 'row' })
    expect(split.variants.orientation.vertical).toMatchObject({ flexDirection: 'column' })
  })
  it('__pane exposes a role variant with fixed/grow bases', () => {
    expect(pane.variants.role.sidebar).toMatchObject({ flexShrink: 0, flexBasis: '15%' })
    expect(pane.variants.role.terminal).toMatchObject({ flexShrink: 0, flexBasis: '30%' })
    expect(pane.variants.role.main).toMatchObject({ flexGrow: 1 })
  })
  it('__divider exposes an orientation variant', () => {
    expect(divider.variants.orientation.horizontal).toMatchObject({ width: '$1', backgroundColor: '$border', flexShrink: 0 })
    expect(divider.variants.orientation.vertical).toMatchObject({ height: '$1', backgroundColor: '$border', flexShrink: 0 })
  })
})

describe('StyledIdeLayout renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledIdeLayout /></P>)
    expect(container.querySelector('.is_IdeLayout')).toBeTruthy()
  })
})
