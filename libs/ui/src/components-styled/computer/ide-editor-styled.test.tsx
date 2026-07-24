import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  IdeEditorFrame,
  IdeEditorTabsFrame,
  IdeEditorTabFrame,
  IdeEditorTabCloseFrame,
  IdeEditorEmptyFrame,
  IdeEditorContentFrame,
  StyledIdeEditor,
} from './ide-editor.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const root = (IdeEditorFrame as unknown as { staticConfig: any }).staticConfig
const tabs = (IdeEditorTabsFrame as unknown as { staticConfig: any }).staticConfig
const tab = (IdeEditorTabFrame as unknown as { staticConfig: any }).staticConfig
const close = (IdeEditorTabCloseFrame as unknown as { staticConfig: any }).staticConfig
const content = (IdeEditorContentFrame as unknown as { staticConfig: any }).staticConfig

describe('.ide-editor → styled()', () => {
  it('base is a full-height background column', () => {
    expect(root.defaultProps).toMatchObject({ height: '100%', flexDirection: 'column', backgroundColor: '$background' })
  })
  it('__tabs is a scrollable card strip', () => {
    expect(tabs.defaultProps).toMatchObject({ backgroundColor: '$card', borderBottomColor: '$border', overflowX: 'auto', flexShrink: 0 })
  })
  it('__tab exposes an active variant', () => {
    expect(tab.defaultProps).toMatchObject({ color: '$muted-foreground', cursor: 'pointer' })
    expect(tab.defaultProps.hoverStyle).toMatchObject({ color: '$foreground' })
    expect(tab.variants.active.true).toMatchObject({ backgroundColor: '$background', color: '$foreground' })
  })
  it('__tab-close tints on hover', () => {
    expect(close.defaultProps.hoverStyle).toMatchObject({ backgroundColor: '$accent' })
  })
  it('__content is a min-h-0 flex-1 region', () => {
    expect(content.defaultProps).toMatchObject({ flexGrow: 1, minHeight: 0 })
  })
})

describe('StyledIdeEditor renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledIdeEditor /></P>)
    expect(container.querySelector('.is_IdeEditor')).toBeTruthy()
  })
})
