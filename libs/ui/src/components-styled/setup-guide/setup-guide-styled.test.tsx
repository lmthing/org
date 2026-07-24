import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  SetupGuideFrame,
  SetupGuideSummaryFrame,
  SetupGuideSummaryMarkerFrame,
  SetupGuideBodyFrame,
  StyledSetupGuide,
} from './setup-guide.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const guide = (SetupGuideFrame as unknown as { staticConfig: any }).staticConfig
const summary = (SetupGuideSummaryFrame as unknown as { staticConfig: any }).staticConfig
const marker = (SetupGuideSummaryMarkerFrame as unknown as { staticConfig: any }).staticConfig
const body = (SetupGuideBodyFrame as unknown as { staticConfig: any }).staticConfig

describe('.lm-setup-guide → styled()', () => {
  it('base is a bordered clipped muted wrapper', () => {
    expect(guide.defaultProps).toMatchObject({ borderColor: '$border', backgroundColor: '$muted', borderWidth: 1, borderRadius: '$radius-lg', overflow: 'hidden' })
  })
  it('__summary is a foreground clickable heading', () => {
    expect(summary.defaultProps).toMatchObject({ color: '$foreground', cursor: 'pointer', fontWeight: '$semibold', userSelect: 'none' })
  })
  it('caret marker exposes an `open` rotation variant', () => {
    expect(marker.defaultProps).toMatchObject({ display: 'inline-block', marginRight: '$2' })
    expect(marker.variants.open.true).toMatchObject({ rotate: '90deg' })
  })
  it('__body is on the background surface with a top divider', () => {
    expect(body.defaultProps).toMatchObject({ backgroundColor: '$background', borderColor: '$border', borderTopWidth: 1 })
  })
})

describe('StyledSetupGuide renders', () => {
  it('renders the frame + caret marker', () => {
    const { container, getByText } = render(<P><StyledSetupGuide open summary="Setup">body</StyledSetupGuide></P>)
    expect(container.querySelector('.is_SetupGuide')).toBeTruthy()
    expect(container.querySelector('.is_SetupGuideSummaryMarker')).toBeTruthy()
    expect(getByText('Setup')).toBeTruthy()
  })
})
