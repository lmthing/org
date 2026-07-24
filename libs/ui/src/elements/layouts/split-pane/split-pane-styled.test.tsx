import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  SplitPaneFrame,
  SplitPanePrimaryFrame,
  SplitPaneSecondaryFrame,
  StyledSplitPane,
  StyledSplitPanePrimary,
  StyledSplitPaneSecondary,
} from './split-pane.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (composite) — `.split-pane` family ⇄ styled() (docs §4). */
const sp = (SplitPaneFrame as unknown as { staticConfig: any }).staticConfig
const primary = (SplitPanePrimaryFrame as unknown as { staticConfig: any }).staticConfig
const secondary = (SplitPaneSecondaryFrame as unknown as { staticConfig: any }).staticConfig

describe('.split-pane → styled() structure', () => {
  it('base is a full-height row that clips', () => {
    expect(sp.defaultProps).toMatchObject({ flexDirection: 'row', height: '100%', overflow: 'hidden' })
  })

  it('__primary grows + scrolls; __secondary is fixed with a left border', () => {
    expect(primary.defaultProps).toMatchObject({ flexGrow: 1, overflow: 'auto' })
    expect(secondary.defaultProps).toMatchObject({ flexShrink: 0, overflow: 'auto', borderLeftColor: '$border' })
  })
})

describe('StyledSplitPane renders', () => {
  it('renders all three frames', () => {
    const { container } = render(
      <P>
        <StyledSplitPane>
          <StyledSplitPanePrimary>A</StyledSplitPanePrimary>
          <StyledSplitPaneSecondary>B</StyledSplitPaneSecondary>
        </StyledSplitPane>
      </P>,
    )
    expect(container.querySelector('.is_SplitPane')).toBeTruthy()
    expect(container.querySelector('.is_SplitPanePrimary')).toBeTruthy()
    expect(container.querySelector('.is_SplitPaneSecondary')).toBeTruthy()
  })
})
