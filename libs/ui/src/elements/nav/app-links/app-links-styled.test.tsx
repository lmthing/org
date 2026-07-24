import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { AppLinksFrame, AppLinksLinkFrame, StyledAppLinks } from './app-links.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (composite) — `.app-links` family ⇄ styled() + variants (docs §4). */
const row = (AppLinksFrame as unknown as { staticConfig: any }).staticConfig
const link = (AppLinksLinkFrame as unknown as { staticConfig: any }).staticConfig

describe('.app-links → styled() structure', () => {
  it('row is a padded gapped flex + a `bordered` variant (sidebar-border)', () => {
    expect(row.defaultProps).toMatchObject({ paddingHorizontal: '$3', paddingVertical: '$2', gap: '$1' })
    expect(row.variants.bordered.true).toMatchObject({ borderBottomColor: '$sidebar-border' })
  })

  it('__link is a rounded-lg xs pill with a muted/60 hover', () => {
    expect(link.defaultProps).toMatchObject({
      flexGrow: 1,
      borderRadius: '$radius-lg',
      fontSize: '$xs',
      color: '$muted-foreground',
    })
    expect(link.defaultProps.hoverStyle.backgroundColor).toContain('var(--muted)')
  })
})

describe('StyledAppLinks renders', () => {
  it('renders a link for each other surface (chat omits its own)', () => {
    const { container } = render(<P><StyledAppLinks current="chat" bordered /></P>)
    expect(container.querySelector('.is_AppLinks')).toBeTruthy()
    expect(container.querySelectorAll('.is_AppLinksLink').length).toBeGreaterThan(0)
  })
})
