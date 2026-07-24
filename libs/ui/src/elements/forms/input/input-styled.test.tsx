import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { InputFrame, StyledInput } from './input.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

// The styled Input reads `$` tokens, so it must render under the web config's provider (single
// empty `app` theme — colors resolve through the var-backed tokens / theme.css, SPIKE A1).
const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/**
 * P2 proof gate (leaf #2) — the `.input` BEM block ⇄ Tamagui `styled()` + variants
 * (docs/tamagui-idiomatic-migration.md §4). Asserts the conversion is STRUCTURALLY faithful: every
 * BEM modifier is a variant, the tokens are the `$`-scale ones, the base carries the `.input` @apply
 * lines, and the component renders in jsdom without a stylesheet. (Pixel parity vs the `.input` CSS
 * is the per-slice harness step; this pins that the styled() carries the right variant table.)
 */

const staticConfig = (InputFrame as unknown as { staticConfig: any }).staticConfig

describe('.input → styled() variant structure', () => {
  it('base carries the .input @apply tokens (SPIKE A1 var-backed colors + SPIKE B scales)', () => {
    expect(staticConfig.defaultProps).toMatchObject({
      height: '$9',
      width: '100%',
      borderRadius: '$radius-md',
      borderWidth: 1,
      borderColor: '$input',
      backgroundColor: '$background',
      paddingHorizontal: '$3',
      paddingVertical: '$1',
      fontSize: '$sm',
      placeholderTextColor: '$muted-foreground',
    })
  })

  it('exposes an `error` boolean variant for the .input--error modifier', () => {
    const e = staticConfig.variants.error
    expect(Object.keys(e)).toContain('true')
    expect(e.true).toMatchObject({ borderColor: '$destructive' })
    // focus-visible:ring-destructive/30 → outline color-mix over the runtime --destructive var
    expect(e.true.focusVisibleStyle.outlineColor).toContain('var(--destructive)')
  })

  it('exposes a `size` variant for the .input--sm modifier (SPIKE-B Tailwind scale tokens)', () => {
    const s = staticConfig.variants.size
    expect(Object.keys(s).sort()).toEqual(['default', 'sm'])
    expect(s.sm).toMatchObject({ height: '$7', fontSize: '$xs', paddingHorizontal: '$2' })
  })

  it('defaults to size=default (base .input with no --sm)', () => {
    expect(staticConfig.defaultVariants).toMatchObject({ size: 'default' })
  })
})

describe('StyledInput renders', () => {
  it('renders under the styled frame and accepts error + inputSize props', () => {
    const { container } = render(
      <P>
        <StyledInput error inputSize="sm" placeholder="Enter text" />
      </P>,
    )
    // The Tamagui styled frame applied its `is_Input` base class. NB: the host element is a
    // `<div tag="input">` at RUNTIME — Tamagui's `tag` prop is compiler-time (§5/P4), so a real
    // <input> only lands once the vite/babel plugin extracts it, exactly as the Button proof notes.
    expect(container.querySelector('.is_Input')).toBeTruthy()
  })

  it('forwards standard input props (placeholder) to the frame', () => {
    const { getByPlaceholderText } = render(
      <P>
        <StyledInput placeholder="Search" />
      </P>,
    )
    expect(getByPlaceholderText('Search')).toBeTruthy()
  })
})
