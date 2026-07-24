import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  OverlayDialogFrame,
  OverlayDialogBackdropFrame,
  OverlayDialogContentFrame,
  OverlayDialogHeaderFrame,
  StyledOverlayDialog,
} from './dialog.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate — `.dialog` chrome ⇄ styled() (docs §4; overlay chrome only, interactivity is P4). */
const dlg = (OverlayDialogFrame as unknown as { staticConfig: any }).staticConfig
const back = (OverlayDialogBackdropFrame as unknown as { staticConfig: any }).staticConfig
const content = (OverlayDialogContentFrame as unknown as { staticConfig: any }).staticConfig
const header = (OverlayDialogHeaderFrame as unknown as { staticConfig: any }).staticConfig

describe('.dialog → styled() chrome', () => {
  it('backdrop is a fixed z-50 black/50 wash', () => {
    expect(back.defaultProps).toMatchObject({
      position: 'fixed',
      zIndex: 50,
      backgroundColor: 'rgba(0,0,0,0.5)',
    })
  })

  it('panel is centered, bordered and shadowed on the background surface', () => {
    expect(dlg.defaultProps).toMatchObject({
      position: 'fixed',
      left: '50%',
      top: '50%',
      zIndex: 50,
      maxWidth: 512,
      transform: 'translate(-50%, -50%)',
      backgroundColor: '$background',
      borderColor: '$border',
      padding: '$6',
      shadowColor: 'rgba(0,0,0,0.1)',
    })
  })

  it('__content is a gap-4 grid; __header a gap-2 column', () => {
    expect(content.defaultProps).toMatchObject({ display: 'grid', gap: '$4' })
    expect(header.defaultProps).toMatchObject({ display: 'flex', flexDirection: 'column', gap: '$2' })
  })
})

describe('StyledOverlayDialog renders', () => {
  it('renders the panel chrome', () => {
    const { container } = render(
      <P>
        <StyledOverlayDialog />
      </P>,
    )
    expect(container.querySelector('.is_OverlayDialog')).toBeTruthy()
  })
})
