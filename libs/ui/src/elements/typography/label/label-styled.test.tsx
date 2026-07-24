import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { LabelFrame, LabelRequiredMarkFrame, StyledLabel } from './label.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (leaf) — `.label` ⇄ styled() + variants (docs §4). */
const label = (LabelFrame as unknown as { staticConfig: any }).staticConfig
const mark = (LabelRequiredMarkFrame as unknown as { staticConfig: any }).staticConfig

describe('.label → styled() variant structure', () => {
  it('base is sm, medium, leading-none, foreground', () => {
    expect(label.defaultProps).toMatchObject({ fontSize: '$sm', fontWeight: '$medium', color: '$foreground' })
    expect(label.defaultProps.lineHeight).toBe('1')
  })

  it('exposes a `compact` boolean variant for .label--sm', () => {
    expect(label.variants.compact.true).toMatchObject({ fontSize: '$xs' })
  })

  it('the required mark (::after replacement) is destructive-colored', () => {
    expect(mark.defaultProps).toMatchObject({ color: '$destructive' })
  })
})

describe('StyledLabel renders', () => {
  it('renders the frame and appends the required mark when required', () => {
    const { container } = render(<P><StyledLabel required>Name</StyledLabel></P>)
    expect(container.querySelector('.is_Label')).toBeTruthy()
    expect(container.querySelector('.is_LabelRequiredMark')).toBeTruthy()
  })

  it('omits the mark when not required', () => {
    const { container } = render(<P><StyledLabel>Name</StyledLabel></P>)
    expect(container.querySelector('.is_LabelRequiredMark')).toBeNull()
  })
})
