import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { TabBarFrame, TabBarTabFrame, StyledTabBar } from './tab-bar.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (composite) — `.tab-bar` family ⇄ styled() + variants (docs §4). */
const bar = (TabBarFrame as unknown as { staticConfig: any }).staticConfig
const tab = (TabBarTabFrame as unknown as { staticConfig: any }).staticConfig

describe('.tab-bar → styled() structure', () => {
  it('bar has a bottom border + gapped items', () => {
    expect(bar.defaultProps).toMatchObject({ alignItems: 'center', gap: '$1', borderBottomColor: '$border' })
  })

  it('__tab has the 2px transparent underline that overlaps (-mb-px) + exposes `active`', () => {
    expect(tab.defaultProps).toMatchObject({
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      marginBottom: -1,
      color: '$muted-foreground',
    })
    expect(tab.variants.active.true).toMatchObject({ color: '$foreground', borderBottomColor: '$primary', fontWeight: '$medium' })
  })
})

describe('StyledTabBar renders', () => {
  it('renders a tab per entry and marks the active one', () => {
    const { container } = render(
      <P><StyledTabBar tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} activeTab="b" /></P>,
    )
    expect(container.querySelectorAll('.is_TabBarTab').length).toBe(2)
    expect(container.querySelector('[aria-selected="true"]')).toBeTruthy()
  })
})
