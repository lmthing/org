import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  SettingsDialogFrame,
  SettingsDialogBodyFrame,
  SettingsDialogTabsFrame,
  SettingsDialogTabFrame,
  SettingsDialogPanelFrame,
  StyledSettingsDialog,
} from './settings-dialog.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate — `.settings-dialog` family ⇄ styled() + variants (docs §4). */
const dlg = (SettingsDialogFrame as unknown as { staticConfig: any }).staticConfig
const body = (SettingsDialogBodyFrame as unknown as { staticConfig: any }).staticConfig
const tabs = (SettingsDialogTabsFrame as unknown as { staticConfig: any }).staticConfig
const tab = (SettingsDialogTabFrame as unknown as { staticConfig: any }).staticConfig
const panel = (SettingsDialogPanelFrame as unknown as { staticConfig: any }).staticConfig

describe('.settings-dialog → styled() structure', () => {
  it('widens the base dialog (w-full + raw max-width/height)', () => {
    expect(dlg.defaultProps).toMatchObject({
      width: '100%',
      maxWidth: 'min(96vw, 72rem)',
      maxHeight: '88vh',
    })
  })

  it('__body is a gap-6 flex split (desktop base)', () => {
    expect(body.defaultProps).toMatchObject({ display: 'flex', gap: '$6', minHeight: 0 })
  })

  it('__tabs is a w-48 bordered column rail', () => {
    expect(tabs.defaultProps).toMatchObject({
      flexDirection: 'column',
      width: '$48',
      borderRightColor: '$border',
    })
  })

  it('__tab is a muted row with a muted/60 hover + `active` variant', () => {
    expect(tab.defaultProps.hoverStyle).toMatchObject({
      backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)',
      color: '$foreground',
    })
    expect(tab.variants.active.true).toMatchObject({ backgroundColor: '$muted', fontWeight: '$medium' })
  })

  it('__panel scrolls independently (raw max-height:74vh)', () => {
    expect(panel.defaultProps).toMatchObject({ overflowY: 'auto', maxHeight: '74vh', minWidth: 0 })
  })
})

describe('StyledSettingsDialog renders', () => {
  it('renders the widening frame', () => {
    const { container } = render(
      <P>
        <StyledSettingsDialog />
      </P>,
    )
    expect(container.querySelector('.is_SettingsDialog')).toBeTruthy()
  })
})
