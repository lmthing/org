import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { PanelFrame, PanelHeaderFrame, PanelBodyFrame, StyledPanel, StyledPanelHeader } from './panel.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (leaf) — `.panel` family ⇄ styled() + variants (docs §4). */
const panel = (PanelFrame as unknown as { staticConfig: any }).staticConfig
const header = (PanelHeaderFrame as unknown as { staticConfig: any }).staticConfig
const body = (PanelBodyFrame as unknown as { staticConfig: any }).staticConfig

describe('.panel → styled() structure', () => {
  it('.panel base is a bordered column surface', () => {
    expect(panel.defaultProps).toMatchObject({
      flexDirection: 'column',
      backgroundColor: '$background',
      borderColor: '$border',
      borderRadius: '$radius-md',
      overflow: 'hidden',
    })
  })

  it('exposes a `split` boolean variant (flex-row)', () => {
    expect(panel.variants.split.true).toMatchObject({ flexDirection: 'row' })
  })

  it('.panel__header/__body carry their tokens', () => {
    expect(header.defaultProps).toMatchObject({
      justifyContent: 'space-between',
      borderBottomColor: '$border',
      fontSize: '$sm',
      fontWeight: '$medium',
      color: '$foreground',
    })
    expect(body.defaultProps).toMatchObject({ flexGrow: 1, overflow: 'auto', padding: '$4' })
  })
})

describe('StyledPanel renders', () => {
  it('renders the panel + header frames', () => {
    const { container } = render(
      <P>
        <StyledPanel split>
          <StyledPanelHeader>Head</StyledPanelHeader>
        </StyledPanel>
      </P>,
    )
    expect(container.querySelector('.is_Panel')).toBeTruthy()
    expect(container.querySelector('.is_PanelHeader')).toBeTruthy()
  })
})
