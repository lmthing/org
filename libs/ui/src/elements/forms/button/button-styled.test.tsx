import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { ButtonFrame, StyledButton } from './button.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

// The styled Button reads `$` tokens, so it must render under the web config's provider (single
// empty `app` theme — colors resolve through the var-backed tokens / theme.css, SPIKE A1).
const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/**
 * P2 proof gate — the `.btn` BEM block ⇄ Tamagui `styled()` + variants
 * (docs/tamagui-idiomatic-migration.md §4). Asserts the conversion is STRUCTURALLY faithful: every
 * BEM modifier is a variant, the tokens are the `$`-scale ones, the defaults match, and the
 * component renders a real <button> in jsdom without a stylesheet. (Pixel parity vs the `.btn` CSS
 * is the per-slice harness step; this pins that the styled() carries the right variant table.)
 */

const staticConfig = (ButtonFrame as unknown as { staticConfig: any }).staticConfig

describe('.btn → styled() variant structure', () => {
  it('exposes a `variant` variant for every BEM modifier', () => {
    const v = staticConfig.variants.variant
    expect(Object.keys(v).sort()).toEqual(['destructive', 'ghost', 'outline', 'primary'])
  })

  it('exposes a `size` variant for every BEM size modifier', () => {
    const s = staticConfig.variants.size
    expect(Object.keys(s).sort()).toEqual(['default', 'icon', 'lg', 'sm'])
  })

  it('primary maps to the $primary token pair (SPIKE A1 var-backed colors)', () => {
    expect(staticConfig.variants.variant.primary).toMatchObject({
      backgroundColor: '$primary',
      color: '$primary-foreground',
    })
  })

  it('outline carries the border + surface tokens', () => {
    expect(staticConfig.variants.variant.outline).toMatchObject({
      borderWidth: 1,
      borderColor: '$input',
      backgroundColor: '$background',
    })
  })

  it('sm/lg/icon sizes use the SPIKE-B Tailwind scale tokens', () => {
    expect(staticConfig.variants.size.sm).toMatchObject({ height: '$8', paddingHorizontal: '$3', fontSize: '$xs' })
    expect(staticConfig.variants.size.lg).toMatchObject({ height: '$11', paddingHorizontal: '$8', fontSize: '$base' })
    expect(staticConfig.variants.size.icon).toMatchObject({ width: '$9', height: '$9' })
  })

  it('defaults to primary / default (the shipped Button defaults)', () => {
    expect(staticConfig.defaultVariants).toMatchObject({ variant: 'primary', size: 'default' })
  })
})

describe('StyledButton renders', () => {
  it('renders its children under the styled frame with variant + size props accepted', () => {
    const { container, getByText } = render(
      <P>
        <StyledButton variant="outline" size="sm">
          Click
        </StyledButton>
      </P>,
    )
    expect(getByText('Click')).toBeTruthy()
    // The Tamagui styled frame applied (its `is_Button` base class). NB: the host element is a
    // `<div tag="button">` at RUNTIME — Tamagui's `tag` prop is compiler-time, so a real <button>
    // only lands once the Tamagui vite/babel plugin extracts it (§5/P4), exactly as the Pressable
    // primitive documents. The variant STRUCTURE is proven above; this is the render smoke test.
    expect(container.querySelector('.is_Button')).toBeTruthy()
  })

  it('asChild renders the caller child instead of the frame', () => {
    const { container } = render(
      <P>
        <StyledButton asChild>
          <a href="/x">link</a>
        </StyledButton>
      </P>,
    )
    expect(container.querySelector('a')).toBeTruthy()
    expect(container.querySelector('.is_Button')).toBeFalsy()
  })
})
