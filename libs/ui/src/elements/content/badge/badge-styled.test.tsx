import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { BadgeFrame, StyledBadge } from './badge.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (leaf) — `.badge` ⇄ styled() + variants (docs §4). */
const staticConfig = (BadgeFrame as unknown as { staticConfig: any }).staticConfig

describe('.badge → styled() variant structure', () => {
  it('base carries the .badge @apply tokens (secondary surface)', () => {
    expect(staticConfig.defaultProps).toMatchObject({
      borderRadius: '$radius-full',
      paddingHorizontal: '$2',
      paddingVertical: '$0.5',
      fontSize: '$xs',
      fontWeight: '$medium',
      backgroundColor: '$secondary',
      color: '$secondary-foreground',
    })
  })

  it('exposes a `variant` for every BEM modifier', () => {
    expect(Object.keys(staticConfig.variants.variant).sort()).toEqual(['default', 'muted', 'primary', 'success'])
  })

  it('success maps brand-1 alpha via color-mix', () => {
    expect(staticConfig.variants.variant.success.backgroundColor).toContain('var(--brand-1)')
    expect(staticConfig.variants.variant.success.color).toBe('$brand-1')
  })

  it('defaults to variant=default', () => {
    expect(staticConfig.defaultVariants).toMatchObject({ variant: 'default' })
  })
})

describe('StyledBadge renders', () => {
  it('renders under the styled frame with a variant', () => {
    const { container } = render(<P><StyledBadge variant="primary">New</StyledBadge></P>)
    expect(container.querySelector('.is_Badge')).toBeTruthy()
  })
})
