import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  OverlaySheetFrame,
  OverlaySheetContentFrame,
  OverlaySheetHeaderFrame,
  StyledOverlaySheet,
} from './sheet.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate — `.sheet` chrome ⇄ styled() + variant (docs §4; overlay chrome only, interactivity is P4). */
const sheet = (OverlaySheetFrame as unknown as { staticConfig: any }).staticConfig
const content = (OverlaySheetContentFrame as unknown as { staticConfig: any }).staticConfig
const header = (OverlaySheetHeaderFrame as unknown as { staticConfig: any }).staticConfig

describe('.sheet → styled() chrome', () => {
  it('panel is a fixed full-height edge sheet on the background surface', () => {
    expect(sheet.defaultProps).toMatchObject({
      position: 'fixed',
      top: 0,
      bottom: 0,
      zIndex: 50,
      height: '100%',
      width: '75%',
      maxWidth: '$96',
      backgroundColor: '$background',
      shadowColor: 'rgba(0,0,0,0.1)',
    })
  })

  it('exposes a `right` variant (right-0 + left border)', () => {
    expect(sheet.variants.right.true).toMatchObject({ right: 0, borderLeftWidth: 1 })
  })

  it('__content is a full-height column; __header a space-between bar', () => {
    expect(content.defaultProps).toMatchObject({ display: 'flex', flexDirection: 'column', height: '100%' })
    expect(header.defaultProps).toMatchObject({ justifyContent: 'space-between', borderBottomColor: '$border' })
  })
})

describe('StyledOverlaySheet renders', () => {
  it('renders the panel chrome', () => {
    const { container } = render(
      <P>
        <StyledOverlaySheet right />
      </P>,
    )
    expect(container.querySelector('.is_OverlaySheet')).toBeTruthy()
  })
})
