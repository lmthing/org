import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  BreadcrumbFrame,
  BreadcrumbSegmentFrame,
  BreadcrumbSeparatorFrame,
  StyledBreadcrumb,
} from './breadcrumb.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (composite) — `.breadcrumb` family ⇄ styled() + variants (docs §4). */
const bc = (BreadcrumbFrame as unknown as { staticConfig: any }).staticConfig
const seg = (BreadcrumbSegmentFrame as unknown as { staticConfig: any }).staticConfig
const sep = (BreadcrumbSeparatorFrame as unknown as { staticConfig: any }).staticConfig

describe('.breadcrumb → styled() structure', () => {
  it('row is muted, sm, gapped', () => {
    expect(bc.defaultProps).toMatchObject({ alignItems: 'center', gap: '$1', fontSize: '$sm', color: '$muted-foreground' })
  })

  it('__segment hovers to foreground + exposes a `current` variant (:last-child)', () => {
    expect(seg.defaultProps.hoverStyle).toMatchObject({ color: '$foreground' })
    expect(seg.variants.current.true).toMatchObject({ color: '$foreground', cursor: 'default' })
  })

  it('__separator is muted + non-selectable', () => {
    expect(sep.defaultProps).toMatchObject({ color: '$muted-foreground', userSelect: 'none' })
  })
})

describe('StyledBreadcrumb renders', () => {
  it('renders a segment per entry with separators between', () => {
    const { container } = render(
      <P><StyledBreadcrumb segments={[{ label: 'Home' }, { label: 'Docs' }, { label: 'Page' }]} /></P>,
    )
    expect(container.querySelectorAll('.is_BreadcrumbSegment').length).toBe(3)
    expect(container.querySelectorAll('.is_BreadcrumbSeparator').length).toBe(2)
  })
})
