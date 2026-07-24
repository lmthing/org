import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  AgentRuntimeListGridFrame,
  AgentRuntimeCardFrame,
  AgentRuntimeFieldsFrame,
  AgentRuntimeFieldsToggleFrame,
  AgentRuntimeFieldsToggleThumbFrame,
  AgentRuntimeStructuredOutputFrame,
  AgentRuntimeToolCallDisplayJsonTextFrame,
  AgentRuntimeToolCallDisplayCollapsibleBtnFrame,
  AgentRuntimeToolCallDisplayCollapsibleDotFrame,
  AgentRuntimeToolCallCardFrame,
  AgentRuntimeToolCallCardIconFrame,
  AgentRuntimeToolCallCardAccentBarFrame,
  AgentRuntimeToolCallCardGradientFrame,
  AgentRuntimeToolCallCardStatusBadgeFrame,
  AgentRuntimeRunningPillFrame,
  AgentRuntimeConversationSidebarFrame,
  AgentRuntimeConversationSidebarItemFrame,
  StyledAgentRuntimeToolCallCard,
  StyledAgentRuntimePanel,
  StyledAgentRuntimeFields,
  StyledAgentRuntimeFieldsToggle,
  StyledAgentRuntimeRunningPill,
  StyledAgentRuntimeConversationSidebar,
  StyledAgentRuntimeConversationSidebarItem,
} from './runtime.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const sc = (f: unknown) => (f as { staticConfig: any }).staticConfig

/** P2 proof gate — agent/runtime BEM families ⇄ styled() + variants (docs §4). */
describe('agent/runtime → styled() base tokens', () => {
  it('.agent-list__grid is a CSS grid with auto-fill columns', () => {
    expect(sc(AgentRuntimeListGridFrame).defaultProps).toMatchObject({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: '$4',
    })
  })

  it('.agent-card is a full-width left-aligned body', () => {
    expect(sc(AgentRuntimeCardFrame).defaultProps).toMatchObject({ width: '100%', textAlign: 'left' })
  })

  it('.runtime-fields is a w-72 left-bordered column', () => {
    expect(sc(AgentRuntimeFieldsFrame).defaultProps).toMatchObject({
      width: '$72',
      flexShrink: 0,
      borderLeftColor: '$border',
      flexDirection: 'column',
    })
  })

  it('.structured-output is a monospace card', () => {
    expect(sc(AgentRuntimeStructuredOutputFrame).defaultProps).toMatchObject({
      fontFamily: 'monospace',
      backgroundColor: '$card',
      borderColor: '$border',
      maxHeight: '$96',
      overflow: 'auto',
    })
  })

  it('.tool-call-display__json-text uses a color-mix foreground surface + relaxed leading', () => {
    expect(sc(AgentRuntimeToolCallDisplayJsonTextFrame).defaultProps).toMatchObject({
      maxHeight: '$52',
      backgroundColor: 'color-mix(in srgb, var(--foreground) 80%, transparent)',
      color: '$muted-foreground',
      scrollbarWidth: 'thin',
    })
  })

  it('.tool-call-card is a color-mix-bordered card surface with a hover border', () => {
    expect(sc(AgentRuntimeToolCallCardFrame).defaultProps).toMatchObject({
      position: 'relative',
      overflow: 'hidden',
      borderRadius: '$radius-lg',
      borderColor: 'color-mix(in srgb, var(--border) 80%, transparent)',
      backgroundColor: '$card',
    })
    expect(sc(AgentRuntimeToolCallCardFrame).defaultProps.hoverStyle).toMatchObject({ borderColor: '$border' })
  })

  it('.tool-call-card__icon carries the shadow-md approximation', () => {
    expect(sc(AgentRuntimeToolCallCardIconFrame).defaultProps).toMatchObject({
      shadowColor: 'rgba(0,0,0,0.1)',
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 6,
      color: '$primary-foreground',
    })
  })

  it('.tool-running-pill is an inline gradient pill', () => {
    expect(sc(AgentRuntimeRunningPillFrame).defaultProps).toMatchObject({
      display: 'inline-flex',
      borderRadius: '$radius-full',
      borderColor: '$border',
      backgroundImage: 'linear-gradient(to right, var(--muted), var(--muted))',
    })
  })

  it('.conversation-sidebar is a w-64 right-bordered rail', () => {
    expect(sc(AgentRuntimeConversationSidebarFrame).defaultProps).toMatchObject({
      width: '$64',
      borderRightColor: '$border',
      flexDirection: 'column',
    })
  })
})

describe('agent/runtime → variants', () => {
  it('.tool-call-card--ring-* recolors an outline ring per category', () => {
    const v = sc(AgentRuntimeToolCallCardFrame).variants.ring
    expect(v.inspect).toMatchObject({ outlineWidth: 1, outlineColor: 'color-mix(in srgb, var(--brand-1) 30%, transparent)' })
    expect(v.knowledge).toMatchObject({ outlineColor: 'color-mix(in srgb, var(--brand-4) 30%, transparent)' })
    expect(v.misc).toMatchObject({ outlineColor: 'color-mix(in srgb, var(--neutral) 30%, transparent)' })
  })

  it('.tool-call-card__glow--* recolors the icon shadow', () => {
    const v = sc(AgentRuntimeToolCallCardIconFrame).variants.glow
    expect(v['brand-1']).toMatchObject({ shadowColor: 'color-mix(in srgb, var(--brand-1) 20%, transparent)' })
    expect(v.neutral).toMatchObject({ shadowColor: 'color-mix(in srgb, var(--neutral) 20%, transparent)' })
  })

  it('.tool-call-card__gradient--* enumerates brand-pair fills', () => {
    const v = sc(AgentRuntimeToolCallCardGradientFrame).variants.gradient
    expect(v['brand-1-2']).toMatchObject({ backgroundImage: 'linear-gradient(to right, var(--brand-1), var(--brand-2))' })
    expect(v['brand-4-destructive']).toMatchObject({ backgroundImage: 'linear-gradient(to right, var(--brand-4), var(--destructive))' })
  })

  it('.tool-call-card__accent-bar has a parent-hover `hovered` variant', () => {
    expect(sc(AgentRuntimeToolCallCardAccentBarFrame).variants.hovered.true).toMatchObject({ opacity: 1 })
  })

  it('.tool-call-card__status-badge--ok/--err set brand color-mix surfaces', () => {
    const v = sc(AgentRuntimeToolCallCardStatusBadgeFrame).variants.state
    expect(v.ok).toMatchObject({ backgroundColor: 'color-mix(in srgb, var(--brand-2) 10%, transparent)' })
    expect(v.err).toMatchObject({ backgroundColor: 'color-mix(in srgb, var(--brand-4) 10%, transparent)' })
  })

  it('.tool-call-display__collapsible-dot--args/--result color the dot', () => {
    const v = sc(AgentRuntimeToolCallDisplayCollapsibleDotFrame).variants.kind
    expect(v.args).toMatchObject({ backgroundColor: '$brand-3' })
    expect(v.result).toMatchObject({ backgroundColor: '$brand-2' })
  })

  it('.tool-call-display__collapsible-btn recolors on hover', () => {
    expect(sc(AgentRuntimeToolCallDisplayCollapsibleBtnFrame).defaultProps.hoverStyle).toMatchObject({
      color: '$foreground',
      backgroundColor: '$muted',
    })
  })

  it('.runtime-fields__toggle(-thumb) on/off surfaces + slide', () => {
    expect(sc(AgentRuntimeFieldsToggleFrame).variants.state.on).toMatchObject({ backgroundColor: '$primary' })
    expect(sc(AgentRuntimeFieldsToggleFrame).variants.state.off).toMatchObject({ backgroundColor: '$muted' })
    expect(sc(AgentRuntimeFieldsToggleThumbFrame).variants.state.on).toMatchObject({ x: 18 })
    expect(sc(AgentRuntimeFieldsToggleThumbFrame).variants.state.off).toMatchObject({ x: 0 })
  })

  it('.conversation-sidebar__item--active sets the brand-3 rail + compensated padding', () => {
    expect(sc(AgentRuntimeConversationSidebarItemFrame).variants.active.true).toMatchObject({
      backgroundColor: '$muted',
      borderLeftColor: '$brand-3',
      paddingLeft: 'calc(1rem - 2px)',
    })
  })
})

describe('Styled wrappers render', () => {
  it('renders the representative frames with their `.is_<Name>` classes', () => {
    const { container } = render(
      <P>
        <StyledAgentRuntimeToolCallCard ring="knowledge" />
        <StyledAgentRuntimePanel />
        <StyledAgentRuntimeFields />
        <StyledAgentRuntimeFieldsToggle state="on" />
        <StyledAgentRuntimeRunningPill />
        <StyledAgentRuntimeConversationSidebar />
        <StyledAgentRuntimeConversationSidebarItem active />
      </P>,
    )
    expect(container.querySelector('.is_AgentRuntimeToolCallCard')).toBeTruthy()
    expect(container.querySelector('.is_AgentRuntimePanel')).toBeTruthy()
    expect(container.querySelector('.is_AgentRuntimeFields')).toBeTruthy()
    expect(container.querySelector('.is_AgentRuntimeFieldsToggle')).toBeTruthy()
    expect(container.querySelector('.is_AgentRuntimeRunningPill')).toBeTruthy()
    expect(container.querySelector('.is_AgentRuntimeConversationSidebar')).toBeTruthy()
    expect(container.querySelector('.is_AgentRuntimeConversationSidebarItem')).toBeTruthy()
  })
})
