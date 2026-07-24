import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { CozyTextFrame, CozyTextSpanFrame, StyledCozyThingText } from './cozy-text.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (leaf) — `.cozy-text` ⇄ styled() + tone variants (docs §4). */
const wrapper = (CozyTextFrame as unknown as { staticConfig: any }).staticConfig
const span = (CozyTextSpanFrame as unknown as { staticConfig: any }).staticConfig

describe('.cozy-text → styled() structure', () => {
  it('wrapper is semibold', () => {
    expect(wrapper.defaultProps).toMatchObject({ fontWeight: '$semibold' })
  })

  it('exposes a `tone` variant for neutral + brand-1..5', () => {
    expect(Object.keys(span.variants.tone).sort()).toEqual([
      'brand-1', 'brand-2', 'brand-3', 'brand-4', 'brand-5', 'neutral',
    ])
    expect(span.variants.tone.neutral).toMatchObject({ color: '$foreground' })
    expect(span.variants.tone['brand-3']).toMatchObject({ color: '$brand-3' })
  })
})

describe('StyledCozyThingText renders', () => {
  it('splits "lmthing" into the brand-toned spans', () => {
    const { container } = render(<P><StyledCozyThingText text="lmthing" /></P>)
    expect(container.querySelector('.is_CozyText')).toBeTruthy()
    // lm + t,h,i,n,g = 6 toned spans
    expect(container.querySelectorAll('.is_CozyTextSpan').length).toBe(6)
  })

  it('renders plain text unchanged for a non-brand string', () => {
    const { getByText } = render(<P><StyledCozyThingText text="hello" /></P>)
    expect(getByText('hello')).toBeTruthy()
  })
})
