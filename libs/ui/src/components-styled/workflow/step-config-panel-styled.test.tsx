import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  StepConfigPanelOverlayFrame,
  StepConfigPanelBackdropFrame,
  StepConfigPanelPanelFrame,
  StepConfigPanelTypeBtnFrame,
  StepConfigPanelToggleFrame,
  StepConfigPanelToggleKnobFrame,
  StepConfigPanelToolBtnFrame,
  StepConfigPanelModelGridFrame,
  StepConfigPanelFooterFrame,
  StyledStepConfigPanel,
} from './step-config-panel.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const overlay = (StepConfigPanelOverlayFrame as unknown as { staticConfig: any }).staticConfig
const backdrop = (StepConfigPanelBackdropFrame as unknown as { staticConfig: any }).staticConfig
const panel = (StepConfigPanelPanelFrame as unknown as { staticConfig: any }).staticConfig
const typeBtn = (StepConfigPanelTypeBtnFrame as unknown as { staticConfig: any }).staticConfig
const toggle = (StepConfigPanelToggleFrame as unknown as { staticConfig: any }).staticConfig
const knob = (StepConfigPanelToggleKnobFrame as unknown as { staticConfig: any }).staticConfig
const toolBtn = (StepConfigPanelToolBtnFrame as unknown as { staticConfig: any }).staticConfig
const modelGrid = (StepConfigPanelModelGridFrame as unknown as { staticConfig: any }).staticConfig
const footer = (StepConfigPanelFooterFrame as unknown as { staticConfig: any }).staticConfig

describe('.step-config-panel → styled()', () => {
  it('__overlay is a fixed z-50 bottom sheet that centers at $gtXs', () => {
    expect(overlay.defaultProps).toMatchObject({
      position: 'fixed',
      zIndex: 50,
      alignItems: 'flex-end',
      $gtXs: { alignItems: 'center' },
    })
  })
  it('__backdrop is a translucent blurred scrim', () => {
    expect(backdrop.defaultProps).toMatchObject({ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' })
  })
  it('__panel rounds only the top, full-round at $gtXs', () => {
    expect(panel.defaultProps).toMatchObject({
      borderTopLeftRadius: '1rem',
      borderBottomLeftRadius: 0,
      $gtXs: { borderRadius: '1rem' },
    })
  })
  it('__type-btn selected variant tints brand-3', () => {
    expect(typeBtn.variants.selected.true).toMatchObject({
      borderColor: '$brand-3',
      backgroundColor: 'color-mix(in srgb, var(--brand-3) 10%, transparent)',
    })
  })
  it('__toggle on/off track colors', () => {
    expect(toggle.variants.on.true).toMatchObject({ backgroundColor: '$brand-3' })
    expect(toggle.variants.on.false).toMatchObject({ backgroundColor: '$muted-foreground' })
  })
  it('__toggle-knob travels on/off', () => {
    expect(knob.variants.on.true).toMatchObject({ transform: 'translateX(1.75rem)' })
    expect(knob.variants.on.false).toMatchObject({ transform: 'translateX(0.25rem)' })
  })
  it('__tool-btn selected variant tints brand-2', () => {
    expect(toolBtn.variants.selected.true).toMatchObject({ borderColor: '$brand-2' })
  })
  it('__model-grid is a 2-col grid', () => {
    expect(modelGrid.defaultProps).toMatchObject({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' })
  })
  it('__footer is a muted end-justified bar', () => {
    expect(footer.defaultProps).toMatchObject({ justifyContent: 'flex-end', backgroundColor: '$muted' })
  })
})

describe('StyledStepConfigPanel renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledStepConfigPanel /></P>)
    expect(container.querySelector('.is_StepConfigPanelOverlay')).toBeTruthy()
  })
})
