import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  AppSidebarFrame,
  AppSidebarItemFrame,
  AppSidebarDropdownFrame,
  AppSidebarDropdownMenuFrame,
  AppSidebarSectionCountFrame,
  AppSidebarDropdownDeleteFrame,
  StyledAppSidebar,
} from './app-sidebar.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate — `.app-sidebar` family ⇄ styled() + variants (docs §4). */
const bar = (AppSidebarFrame as unknown as { staticConfig: any }).staticConfig
const item = (AppSidebarItemFrame as unknown as { staticConfig: any }).staticConfig
const dd = (AppSidebarDropdownFrame as unknown as { staticConfig: any }).staticConfig
const menu = (AppSidebarDropdownMenuFrame as unknown as { staticConfig: any }).staticConfig
const count = (AppSidebarSectionCountFrame as unknown as { staticConfig: any }).staticConfig
const del = (AppSidebarDropdownDeleteFrame as unknown as { staticConfig: any }).staticConfig

describe('.app-sidebar → styled() structure', () => {
  it('rail is a sidebar-surface column with a right border', () => {
    expect(bar.defaultProps).toMatchObject({
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '$sidebar',
      borderRightColor: '$sidebar-border',
      overflow: 'hidden',
    })
  })

  it('exposes `fixed` (w-64) and `collapsed` (w-12) variants', () => {
    expect(bar.variants.fixed.true).toMatchObject({ width: '$64' })
    expect(bar.variants.collapsed.true).toMatchObject({ width: '$12' })
  })

  it('__item is a truncating muted row with a muted/60 hover + `active` variant', () => {
    expect(item.defaultProps).toMatchObject({
      color: '$muted-foreground',
      borderRadius: '$radius-lg',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    })
    expect(item.defaultProps.hoverStyle).toMatchObject({
      backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)',
      color: '$foreground',
    })
    expect(item.variants.active.true).toMatchObject({ backgroundColor: '$muted', fontWeight: '$medium' })
  })

  it('__dropdown is relative with an `inRow` (flex-1 min-w-0) variant', () => {
    expect(dd.defaultProps).toMatchObject({ position: 'relative' })
    expect(dd.variants.inRow.true).toMatchObject({ flexGrow: 1, minWidth: 0 })
  })

  it('__dropdown-menu is a z-20 popover surface with a shadow', () => {
    expect(menu.defaultProps).toMatchObject({
      position: 'absolute',
      zIndex: 20,
      backgroundColor: '$popover',
      shadowColor: 'rgba(0,0,0,0.1)',
    })
  })

  it('__section-count uses a muted/60 alpha via color-mix', () => {
    expect(count.defaultProps).toMatchObject({
      color: 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)',
      fontWeight: '$normal',
    })
  })

  it('__dropdown-delete is hidden with a `revealed` (group-hover) variant', () => {
    expect(del.defaultProps).toMatchObject({ display: 'none' })
    expect(del.variants.revealed.true).toMatchObject({ display: 'flex' })
  })
})

describe('StyledAppSidebar renders', () => {
  it('renders the rail', () => {
    const { container } = render(
      <P>
        <StyledAppSidebar fixed />
      </P>,
    )
    expect(container.querySelector('.is_AppSidebar')).toBeTruthy()
  })
})
