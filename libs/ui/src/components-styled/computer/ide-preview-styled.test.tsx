import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  IdePreviewFrame,
  IdePreviewHeaderFrame,
  IdePreviewRefreshFrame,
  IdePreviewUrlFrame,
  IdePreviewIframeFrame,
  IdePreviewLoadingFrame,
  StyledIdePreview,
} from './ide-preview.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const root = (IdePreviewFrame as unknown as { staticConfig: any }).staticConfig
const header = (IdePreviewHeaderFrame as unknown as { staticConfig: any }).staticConfig
const refresh = (IdePreviewRefreshFrame as unknown as { staticConfig: any }).staticConfig
const url = (IdePreviewUrlFrame as unknown as { staticConfig: any }).staticConfig
const iframe = (IdePreviewIframeFrame as unknown as { staticConfig: any }).staticConfig

describe('.ide-preview → styled()', () => {
  it('base is a full-height background column', () => {
    expect(root.defaultProps).toMatchObject({ height: '100%', flexDirection: 'column', backgroundColor: '$background' })
  })
  it('__header is a bordered card bar', () => {
    expect(header.defaultProps).toMatchObject({ backgroundColor: '$card', borderBottomWidth: 1, borderBottomColor: '$border', flexShrink: 0 })
  })
  it('__refresh tints on hover', () => {
    expect(refresh.defaultProps.hoverStyle).toMatchObject({ backgroundColor: '$accent', color: '$foreground' })
  })
  it('__url focuses with a primary outline ring', () => {
    expect(url.defaultProps).toMatchObject({ fontFamily: 'monospace', placeholderTextColor: '$muted-foreground' })
    expect(url.defaultProps.focusStyle).toMatchObject({ outlineWidth: 1, outlineColor: '$primary' })
  })
  it('__iframe uses the literal white backdrop', () => {
    expect(iframe.defaultProps).toMatchObject({ width: '100%', borderWidth: 0, backgroundColor: 'white' })
  })
})

describe('StyledIdePreview renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledIdePreview /></P>)
    expect(container.querySelector('.is_IdePreview')).toBeTruthy()
  })
})
