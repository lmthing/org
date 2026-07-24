import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { SeparatorFrame, StyledSeparator } from './separator.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (leaf) — `.separator` ⇄ styled() + variants (docs §4). */
const staticConfig = (SeparatorFrame as unknown as { staticConfig: any }).staticConfig

describe('.separator → styled() structure', () => {
  it('base is a 1px full-width border-colored rule', () => {
    expect(staticConfig.defaultProps).toMatchObject({ height: 1, width: '100%', backgroundColor: '$border' })
  })

  it('exposes a `vertical` boolean variant (h-full w-px)', () => {
    expect(staticConfig.variants.vertical.true).toMatchObject({ height: '100%', width: 1 })
  })
})

describe('StyledSeparator renders', () => {
  it('renders with the right a11y role/orientation', () => {
    const { container } = render(<P><StyledSeparator orientation="vertical" decorative={false} /></P>)
    const el = container.querySelector('.is_Separator')
    expect(el).toBeTruthy()
    expect(el?.getAttribute('role')).toBe('separator')
    expect(el?.getAttribute('aria-orientation')).toBe('vertical')
  })
})
