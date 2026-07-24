import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { CaptionFrame, StyledCaption } from './caption.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (leaf) — `.caption` ⇄ styled() + variants (docs §4). */
const staticConfig = (CaptionFrame as unknown as { staticConfig: any }).staticConfig

describe('.caption → styled() structure', () => {
  it('base is xs muted with a leading-snug unitless line-height', () => {
    expect(staticConfig.defaultProps).toMatchObject({ fontSize: '$xs', color: '$muted-foreground' })
    expect(staticConfig.defaultProps.lineHeight).toBe('1.375')
  })

  it('exposes a `muted` boolean variant (muted-foreground/70 via color-mix)', () => {
    expect(staticConfig.variants.muted.true.color).toContain('var(--muted-foreground)')
  })
})

describe('StyledCaption renders', () => {
  it('renders under the styled frame', () => {
    const { container, getByText } = render(<P><StyledCaption muted>hi</StyledCaption></P>)
    expect(container.querySelector('.is_Caption')).toBeTruthy()
    expect(getByText('hi')).toBeTruthy()
  })
})
