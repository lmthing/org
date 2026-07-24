import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  IdeFileTreeFrame,
  IdeFileTreeHeaderFrame,
  IdeFileTreeHeaderTitleFrame,
  IdeFileTreeActionBtnFrame,
  IdeFileTreeItemFrame,
  IdeFileTreeIconFrame,
  IdeFileTreeNameFrame,
  IdeFileTreeContextMenuFrame,
  IdeFileTreeContextItemFrame,
  IdeFileTreeDialogOverlayFrame,
  IdeFileTreeDialogContentFrame,
  IdeFileTreeDialogInputFrame,
  StyledIdeFileTree,
} from './ide-file-tree.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const root = (IdeFileTreeFrame as unknown as { staticConfig: any }).staticConfig
const header = (IdeFileTreeHeaderFrame as unknown as { staticConfig: any }).staticConfig
const title = (IdeFileTreeHeaderTitleFrame as unknown as { staticConfig: any }).staticConfig
const actionBtn = (IdeFileTreeActionBtnFrame as unknown as { staticConfig: any }).staticConfig
const item = (IdeFileTreeItemFrame as unknown as { staticConfig: any }).staticConfig
const icon = (IdeFileTreeIconFrame as unknown as { staticConfig: any }).staticConfig
const name = (IdeFileTreeNameFrame as unknown as { staticConfig: any }).staticConfig
const menu = (IdeFileTreeContextMenuFrame as unknown as { staticConfig: any }).staticConfig
const contextItem = (IdeFileTreeContextItemFrame as unknown as { staticConfig: any }).staticConfig
const overlay = (IdeFileTreeDialogOverlayFrame as unknown as { staticConfig: any }).staticConfig
const dialog = (IdeFileTreeDialogContentFrame as unknown as { staticConfig: any }).staticConfig
const input = (IdeFileTreeDialogInputFrame as unknown as { staticConfig: any }).staticConfig

describe('.ide-file-tree → styled()', () => {
  it('base is a scrollable card', () => {
    expect(root.defaultProps).toMatchObject({ height: '100%', backgroundColor: '$card', overflow: 'auto' })
  })
  it('__header spreads its title + actions with a bottom border', () => {
    expect(header.defaultProps).toMatchObject({ justifyContent: 'space-between', borderBottomColor: '$border' })
  })
  it('__header-title is an uppercase wide-tracked caption', () => {
    expect(title.defaultProps).toMatchObject({ fontSize: '$xs', fontWeight: '$semibold', textTransform: 'uppercase', letterSpacing: '$wider' })
  })
  it('__action-btn tints on hover', () => {
    expect(actionBtn.defaultProps.hoverStyle).toMatchObject({ backgroundColor: '$accent', color: '$foreground' })
  })
  it('__item exposes an active variant via color-mix', () => {
    expect(item.defaultProps.hoverStyle).toMatchObject({ backgroundColor: '$accent' })
    expect(item.variants.active.true).toMatchObject({ backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)', color: '$primary' })
  })
  it('__icon exposes a folder variant', () => {
    expect(icon.defaultProps).toMatchObject({ flexShrink: 0, color: '$muted-foreground' })
    expect(icon.variants.folder.true).toMatchObject({ color: '$primary' })
  })
  it('__name truncates', () => {
    expect(name.defaultProps).toMatchObject({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
  })
  it('__context-menu is a bordered popover with a shadow + arbitrary min-width', () => {
    expect(menu.defaultProps).toMatchObject({ minWidth: 160, backgroundColor: '$popover', borderRadius: '$radius-md' })
    expect(menu.defaultProps.shadowColor).toBe('rgba(0,0,0,0.1)')
  })
  it('__context-item exposes a danger variant', () => {
    expect(contextItem.variants.danger.true).toMatchObject({ color: '$destructive' })
  })
  it('__dialog-overlay is a fixed achromatic scrim', () => {
    expect(overlay.defaultProps).toMatchObject({ position: 'fixed', top: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.5)' })
  })
  it('__dialog-content is centered via translate', () => {
    expect(dialog.defaultProps).toMatchObject({ position: 'fixed', top: '50%', left: '50%', transform: 'translateX(-50%) translateY(-50%)', width: '$96' })
  })
  it('__dialog-input focuses to a primary border', () => {
    expect(input.defaultProps.focusStyle).toMatchObject({ borderColor: '$primary' })
  })
})

describe('StyledIdeFileTree renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledIdeFileTree /></P>)
    expect(container.querySelector('.is_IdeFileTree')).toBeTruthy()
  })
})
