import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  IdeTerminalFrame,
  IdeTerminalTabsFrame,
  IdeTerminalTabFrame,
  IdeTerminalTabCloseFrame,
  IdeTerminalAddFrame,
  IdeTerminalBodyFrame,
  IdeTerminalPaneFrame,
  StyledIdeTerminal,
} from './ide-terminal.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const root = (IdeTerminalFrame as unknown as { staticConfig: any }).staticConfig
const tabs = (IdeTerminalTabsFrame as unknown as { staticConfig: any }).staticConfig
const tab = (IdeTerminalTabFrame as unknown as { staticConfig: any }).staticConfig
const close = (IdeTerminalTabCloseFrame as unknown as { staticConfig: any }).staticConfig
const body = (IdeTerminalBodyFrame as unknown as { staticConfig: any }).staticConfig
const pane = (IdeTerminalPaneFrame as unknown as { staticConfig: any }).staticConfig

describe('.ide-terminal → styled()', () => {
  it('base is a full-height background column', () => {
    expect(root.defaultProps).toMatchObject({ height: '100%', flexDirection: 'column', backgroundColor: '$background' })
  })
  it('__tabs stretches its tabs and scrolls', () => {
    expect(tabs.defaultProps).toMatchObject({ alignItems: 'stretch', backgroundColor: '$card', overflowX: 'auto' })
  })
  it('__tab exposes an active variant and hover tint', () => {
    expect(tab.defaultProps).toMatchObject({ userSelect: 'none', whiteSpace: 'nowrap', color: '$muted-foreground' })
    expect(tab.variants.active.true).toMatchObject({ backgroundColor: '$background', color: '$foreground' })
  })
  it('__tab-close reveals + tints on hover via color-mix', () => {
    expect(close.defaultProps).toMatchObject({ opacity: 0.5, width: '$4', height: '$4' })
    expect(close.defaultProps.hoverStyle).toMatchObject({ opacity: 1, backgroundColor: 'color-mix(in srgb, var(--muted) 80%, transparent)' })
  })
  it('__body is a relative flex-1 region', () => {
    expect(body.defaultProps).toMatchObject({ flexGrow: 1, minHeight: 0, position: 'relative' })
  })
  it('__pane is inset-0 with a hidden variant', () => {
    expect(pane.defaultProps).toMatchObject({ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 })
    expect(pane.variants.hidden.true).toMatchObject({ visibility: 'hidden', pointerEvents: 'none' })
  })
})

describe('StyledIdeTerminal renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledIdeTerminal /></P>)
    expect(container.querySelector('.is_IdeTerminal')).toBeTruthy()
  })
})
