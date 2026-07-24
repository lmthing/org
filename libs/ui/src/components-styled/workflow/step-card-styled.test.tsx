import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  StepCardFrame,
  StepCardBodyFrame,
  StepCardInnerFrame,
  StepCardDragHandleFrame,
  StepCardActionsFrame,
  StepCardOrderBadgeFrame,
  StepPreviewFrame,
  StepPreviewSchemaKeyFrame,
  StyledStepCard,
} from './step-card.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const cardSc = (StepCardFrame as unknown as { staticConfig: any }).staticConfig
const body = (StepCardBodyFrame as unknown as { staticConfig: any }).staticConfig
const inner = (StepCardInnerFrame as unknown as { staticConfig: any }).staticConfig
const handle = (StepCardDragHandleFrame as unknown as { staticConfig: any }).staticConfig
const actions = (StepCardActionsFrame as unknown as { staticConfig: any }).staticConfig
const badge = (StepCardOrderBadgeFrame as unknown as { staticConfig: any }).staticConfig
const preview = (StepPreviewFrame as unknown as { staticConfig: any }).staticConfig
const schemaKey = (StepPreviewSchemaKeyFrame as unknown as { staticConfig: any }).staticConfig

describe('.step-card → styled()', () => {
  it('base is a relative wrapper with an `expanded` ring variant', () => {
    expect(cardSc.defaultProps).toMatchObject({ position: 'relative' })
    expect(cardSc.variants.expanded.true).toMatchObject({ outlineColor: '$brand-3', outlineOffset: 2 })
  })
  it('__body carries the card surface, hover tint + `invalid` variant', () => {
    expect(body.defaultProps).toMatchObject({ backgroundColor: '$card', borderRadius: '0.75rem', borderWidth: 2 })
    expect(body.defaultProps.hoverStyle).toMatchObject({
      borderColor: 'color-mix(in srgb, var(--brand-3) 50%, transparent)',
    })
    expect(body.variants.invalid.true).toMatchObject({
      borderColor: 'color-mix(in srgb, var(--destructive) 50%, transparent)',
    })
  })
  it('__inner bumps padding at $gtXs', () => {
    expect(inner.defaultProps).toMatchObject({ padding: '$4', $gtXs: { padding: '$5' } })
  })
  it('__drag-handle grabs then grabbing on press', () => {
    expect(handle.defaultProps).toMatchObject({ cursor: 'grab', backgroundColor: '$muted' })
    expect(handle.defaultProps.pressStyle).toMatchObject({ cursor: 'grabbing' })
  })
  it('__actions hide until the `revealed` variant', () => {
    expect(actions.defaultProps).toMatchObject({ opacity: 0 })
    expect(actions.variants.revealed.true).toMatchObject({ opacity: 1 })
  })
  it('__order-badge is a brand-3 pill', () => {
    expect(badge.defaultProps).toMatchObject({ backgroundColor: '$brand-3', borderRadius: '$radius-full' })
  })
})

describe('.step-preview → styled()', () => {
  it('base is a flex column', () => {
    expect(preview.defaultProps).toMatchObject({ flexDirection: 'column', gap: '$4' })
  })
  it('__schema-key is brand-1 text', () => {
    expect(schemaKey.defaultProps).toMatchObject({ color: '$brand-1' })
  })
})

describe('StyledStepCard renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledStepCard expanded /></P>)
    expect(container.querySelector('.is_StepCard')).toBeTruthy()
  })
})
