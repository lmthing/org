import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { TextareaFrame, StyledTextarea } from './textarea.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/**
 * P2 proof gate (leaf) — the `.textarea` BEM block ⇄ Tamagui `styled()` + variants
 * (docs/tamagui-idiomatic-migration.md §4). Structurally faithful base + the `compact` variant.
 */
const staticConfig = (TextareaFrame as unknown as { staticConfig: any }).staticConfig

describe('.textarea → styled() variant structure', () => {
  it('base carries the .textarea @apply tokens', () => {
    expect(staticConfig.defaultProps).toMatchObject({
      minHeight: '$20',
      width: '100%',
      borderRadius: '$radius-md',
      borderColor: '$input',
      backgroundColor: '$background',
      paddingHorizontal: '$3',
      paddingVertical: '$2',
      fontSize: '$sm',
      placeholderTextColor: '$muted-foreground',
      resize: 'vertical',
    })
  })

  it('exposes a `compact` boolean variant for .textarea--sm (SPIKE-B scale tokens)', () => {
    const c = staticConfig.variants.compact
    expect(Object.keys(c)).toContain('true')
    expect(c.true).toMatchObject({
      minHeight: '$14',
      fontSize: '$xs',
      paddingHorizontal: '$2',
      paddingVertical: '$1.5',
    })
  })
})

describe('StyledTextarea renders', () => {
  it('renders under the styled frame and accepts the compact prop', () => {
    const { container } = render(
      <P>
        <StyledTextarea compact placeholder="Notes" />
      </P>,
    )
    expect(container.querySelector('.is_Textarea')).toBeTruthy()
  })
})
