import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { StackFrame, StyledStack } from './stack.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (composite) — `.stack` ⇄ styled() + variants (docs §4). */
const staticConfig = (StackFrame as unknown as { staticConfig: any }).staticConfig

describe('.stack → styled() variant structure', () => {
  it('base is a flex column', () => {
    expect(staticConfig.defaultProps).toMatchObject({ display: 'flex', flexDirection: 'column' })
  })

  it('exposes a `row` boolean variant and a `gap` scale (sm/md/lg → $1/$3/$6)', () => {
    expect(staticConfig.variants.row.true).toMatchObject({ flexDirection: 'row' })
    expect(staticConfig.variants.gap.sm).toMatchObject({ gap: '$1' })
    expect(staticConfig.variants.gap.md).toMatchObject({ gap: '$3' })
    expect(staticConfig.variants.gap.lg).toMatchObject({ gap: '$6' })
  })
})

describe('StyledStack renders', () => {
  it('renders under the styled frame with row + gap', () => {
    const { container } = render(<P><StyledStack row gap="md">x</StyledStack></P>)
    expect(container.querySelector('.is_Stack')).toBeTruthy()
  })
})
