import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  StudioShellFrame,
  StudioShellEmptyFrame,
  StudioShellEmptyContentFrame,
  StudioShellEmptyTitleFrame,
  StudioShellEmptySubtitleFrame,
  StyledStudioShell,
} from './studio-shell.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const shell = (StudioShellFrame as unknown as { staticConfig: any }).staticConfig
const empty = (StudioShellEmptyFrame as unknown as { staticConfig: any }).staticConfig
const content = (StudioShellEmptyContentFrame as unknown as { staticConfig: any }).staticConfig
const title = (StudioShellEmptyTitleFrame as unknown as { staticConfig: any }).staticConfig
const subtitle = (StudioShellEmptySubtitleFrame as unknown as { staticConfig: any }).staticConfig

describe('.studio-shell → styled()', () => {
  it('base is full-viewport height', () => {
    expect(shell.defaultProps).toMatchObject({ height: '100vh' })
  })
  it('__empty is centered', () => {
    expect(empty.defaultProps).toMatchObject({ display: 'flex', alignItems: 'center', justifyContent: 'center' })
  })
  it('__empty-content is dim + centered text', () => {
    expect(content.defaultProps).toMatchObject({ textAlign: 'center', opacity: 0.5 })
  })
  it('__empty-title/subtitle use the type scale', () => {
    expect(title.defaultProps).toMatchObject({ fontSize: '$lg', fontWeight: '$semibold', marginBottom: '$2' })
    expect(subtitle.defaultProps).toMatchObject({ fontSize: '$sm' })
  })
})

describe('StyledStudioShell renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledStudioShell /></P>)
    expect(container.querySelector('.is_StudioShell')).toBeTruthy()
  })
})
