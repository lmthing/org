import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  ComputerConnectionBannerFrame,
  ComputerConnectionBannerMessageFrame,
  ComputerConnectionBannerDotFrame,
  StyledComputerConnectionBanner,
} from './connection-banner.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const banner = (ComputerConnectionBannerFrame as unknown as { staticConfig: any }).staticConfig
const message = (ComputerConnectionBannerMessageFrame as unknown as { staticConfig: any }).staticConfig
const dot = (ComputerConnectionBannerDotFrame as unknown as { staticConfig: any }).staticConfig

describe('.computer-connection-banner → styled()', () => {
  it('base spreads its content on a text-sm bar', () => {
    expect(banner.defaultProps).toMatchObject({ alignItems: 'center', justifyContent: 'space-between', gap: '$3', fontSize: '$sm' })
  })
  it('state variants tint the surface via color-mix', () => {
    expect(banner.variants.state.error).toMatchObject({
      backgroundColor: 'color-mix(in srgb, var(--destructive) 10%, transparent)',
      color: '$destructive',
      borderBottomColor: 'color-mix(in srgb, var(--destructive) 20%, transparent)',
    })
    expect(banner.variants.state.booting).toMatchObject({ color: '$warning' })
  })
  it('__message is a flex-1 leading group', () => {
    expect(message.defaultProps).toMatchObject({ alignItems: 'center', gap: '$2', flexGrow: 1 })
  })
  it('__dot maps state to a background token', () => {
    expect(dot.variants.state.error).toMatchObject({ backgroundColor: '$destructive' })
    expect(dot.variants.state.booting).toMatchObject({ backgroundColor: '$warning' })
  })
})

describe('StyledComputerConnectionBanner renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledComputerConnectionBanner state="error" /></P>)
    expect(container.querySelector('.is_ComputerConnectionBanner')).toBeTruthy()
  })
})
