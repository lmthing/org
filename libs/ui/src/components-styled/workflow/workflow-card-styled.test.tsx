import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  WorkflowCardFrame,
  WorkflowCardDotFrame,
  WorkflowCardCheckFrame,
  WorkflowListItemFrame,
  WorkflowListItemStatusDotFrame,
  WorkflowListItemTagsFrame,
  WorkflowListItemChevronFrame,
  StyledWorkflowCard,
  StyledWorkflowListItem,
} from './workflow-card.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const card = (WorkflowCardFrame as unknown as { staticConfig: any }).staticConfig
const dot = (WorkflowCardDotFrame as unknown as { staticConfig: any }).staticConfig
const check = (WorkflowCardCheckFrame as unknown as { staticConfig: any }).staticConfig
const item = (WorkflowListItemFrame as unknown as { staticConfig: any }).staticConfig
const statusDot = (WorkflowListItemStatusDotFrame as unknown as { staticConfig: any }).staticConfig
const tags = (WorkflowListItemTagsFrame as unknown as { staticConfig: any }).staticConfig
const chevron = (WorkflowListItemChevronFrame as unknown as { staticConfig: any }).staticConfig

describe('.workflow-card → styled()', () => {
  it('base is a bordered card surface', () => {
    expect(card.defaultProps).toMatchObject({
      position: 'relative',
      borderRadius: '$radius-xl',
      borderWidth: 2,
      backgroundColor: '$card',
      borderColor: '$border',
    })
  })
  it('hover tints the border via color-mix', () => {
    expect(card.defaultProps.hoverStyle).toMatchObject({
      borderColor: 'color-mix(in srgb, var(--brand-3) 50%, transparent)',
    })
  })
  it('exposes a `selected` variant (brand-3 border + ring)', () => {
    expect(card.variants.selected.true).toMatchObject({
      borderColor: '$brand-3',
      outlineColor: 'color-mix(in srgb, var(--brand-3) 20%, transparent)',
    })
  })
  it('__dot and __check use brand tokens', () => {
    expect(dot.defaultProps).toMatchObject({ backgroundColor: '$brand-2', borderRadius: '$radius-full' })
    expect(check.defaultProps).toMatchObject({ position: 'absolute', backgroundColor: '$brand-3' })
  })
})

describe('.workflow-list-item → styled()', () => {
  it('base is a bordered card row', () => {
    expect(item.defaultProps).toMatchObject({
      display: 'flex',
      borderRadius: '$radius-lg',
      borderWidth: 1,
      backgroundColor: '$card',
    })
  })
  it('exposes a `selected` variant', () => {
    expect(item.variants.selected.true).toMatchObject({ borderColor: '$brand-3' })
  })
  it('__status-dot exposes a status variant', () => {
    expect(statusDot.variants.status.active).toMatchObject({ backgroundColor: '$brand-2' })
    expect(statusDot.variants.status.archived).toMatchObject({ backgroundColor: 'currentColor' })
  })
  it('__tags responsive variant hides until $gtXs', () => {
    expect(tags.variants.responsive.true).toMatchObject({ display: 'none', $gtXs: { display: 'flex' } })
  })
  it('__chevron open variant rotates', () => {
    expect(chevron.variants.open.true).toMatchObject({ transform: 'rotate(90deg)' })
  })
})

describe('StyledWorkflowCard renders', () => {
  it('renders the card + list item', () => {
    const { container } = render(
      <P>
        <StyledWorkflowCard selected />
        <StyledWorkflowListItem selected />
      </P>,
    )
    expect(container.querySelector('.is_WorkflowCard')).toBeTruthy()
    expect(container.querySelector('.is_WorkflowListItem')).toBeTruthy()
  })
})
