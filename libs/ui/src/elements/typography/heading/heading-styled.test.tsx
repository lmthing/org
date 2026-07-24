import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { HeadingFrame, StyledHeading } from './heading.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (leaf) — `.heading-*` ⇄ styled() + variants (docs §4). */
const staticConfig = (HeadingFrame as unknown as { staticConfig: any }).staticConfig

describe('.heading → styled() variant structure', () => {
  it('base is semibold, tight tracking, foreground', () => {
    expect(staticConfig.defaultProps).toMatchObject({
      fontWeight: '$semibold',
      letterSpacing: '$tight',
      color: '$foreground',
    })
  })

  it('exposes a `level` variant mapping each heading size', () => {
    expect(staticConfig.variants.level[1]).toMatchObject({ fontSize: '$3xl' })
    expect(staticConfig.variants.level[2]).toMatchObject({ fontSize: '$2xl' })
    expect(staticConfig.variants.level[3]).toMatchObject({ fontSize: '$xl' })
    expect(staticConfig.variants.level[4]).toMatchObject({ fontSize: '$base' })
  })

  it('exposes a `muted` boolean variant and defaults to level 2', () => {
    expect(staticConfig.variants.muted.true).toMatchObject({ color: '$muted-foreground' })
    expect(staticConfig.defaultVariants).toMatchObject({ level: 2 })
  })
})

describe('StyledHeading renders', () => {
  it('renders the heading frame', () => {
    const { container, getByText } = render(<P><StyledHeading level={1}>Title</StyledHeading></P>)
    expect(container.querySelector('.is_Heading')).toBeTruthy()
    expect(getByText('Title')).toBeTruthy()
  })
})
