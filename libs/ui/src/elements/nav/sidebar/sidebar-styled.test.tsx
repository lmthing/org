import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { SidebarFrame, SidebarItemFrame, StyledSidebar, StyledSidebarItem } from './sidebar.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (composite) — `.sidebar` family ⇄ styled() + variants (docs §4). */
const bar = (SidebarFrame as unknown as { staticConfig: any }).staticConfig
const item = (SidebarItemFrame as unknown as { staticConfig: any }).staticConfig

describe('.sidebar → styled() structure', () => {
  it('rail is a w-64 sidebar-surface column with a right border', () => {
    expect(bar.defaultProps).toMatchObject({
      flexDirection: 'column',
      height: '100%',
      width: '$64',
      backgroundColor: '$sidebar',
      borderRightColor: '$sidebar-border',
    })
  })

  it('exposes a `collapsed` variant (w-12)', () => {
    expect(bar.variants.collapsed.true).toMatchObject({ width: '$12' })
  })

  it('__item uses sidebar-scoped colors + an `active` variant', () => {
    expect(item.defaultProps).toMatchObject({ color: '$sidebar-foreground', borderRadius: '$radius-md' })
    expect(item.defaultProps.hoverStyle).toMatchObject({ backgroundColor: '$sidebar-accent', color: '$sidebar-accent-foreground' })
    expect(item.variants.active.true).toMatchObject({ backgroundColor: '$sidebar-accent', fontWeight: '$medium' })
  })
})

describe('StyledSidebar renders', () => {
  it('renders the rail + an item', () => {
    const { container } = render(
      <P><StyledSidebar collapsed><StyledSidebarItem active>Home</StyledSidebarItem></StyledSidebar></P>,
    )
    expect(container.querySelector('.is_Sidebar')).toBeTruthy()
    expect(container.querySelector('.is_SidebarItem')).toBeTruthy()
  })
})
