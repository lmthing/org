import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  AgentBuilder,
  AgentBuilderActionsPanel,
  AgentBuilderActionsPanelBody,
  AgentBuilderAside,
  AgentBuilderChatFab,
  AgentBuilderConfigToggleSwitch,
  AgentBuilderConfigToggleKnob,
  AgentBuilderKnowledgePill,
  AgentBuilderSlashActionCard,
  AgentBuilderSlashActionCardToggle,
  AgentBuilderAreaKnowledgeCard,
  AgentBuilderSavedListGrid,
  StyledAgentBuilder,
} from './builder.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const sc = (f: unknown) => (f as { staticConfig: any }).staticConfig

/** P2 proof gate — the `agent/builder` BEM blocks ⇄ styled() + variants (docs §4). */
describe('.agent-builder shell + panels → styled()', () => {
  it('the .agent-builder shell is a full-height hidden-overflow column', () => {
    expect(sc(AgentBuilder).defaultProps).toMatchObject({
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    })
  })

  it('the .actions-panel base is a full-height column', () => {
    expect(sc(AgentBuilderActionsPanel).defaultProps).toMatchObject({
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    })
  })

  it('__body flex-1 + p-4 + overflow-y-auto maps through the §5 table', () => {
    expect(sc(AgentBuilderActionsPanelBody).defaultProps).toMatchObject({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: '0%',
      overflowY: 'auto',
      padding: '$4',
    })
  })

  it('__aside carries the 20rem width + left border token', () => {
    expect(sc(AgentBuilderAside).defaultProps).toMatchObject({
      width: '$80',
      borderLeftWidth: 1,
      borderLeftColor: '$border',
    })
  })
})

describe('.chat-fab → shadow props', () => {
  it('expresses the agent-tinted box-shadow as Tamagui shadow props', () => {
    expect(sc(AgentBuilderChatFab).defaultProps).toMatchObject({
      position: 'fixed',
      zIndex: 50,
      backgroundColor: '$agent',
      color: '$agent-foreground',
      borderRadius: '$radius-full',
      shadowColor: 'color-mix(in srgb, var(--agent) 35%, transparent)',
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 12,
    })
  })

  it('the hover deepens the shadow (transform via hoverStyle; transition omitted)', () => {
    expect(sc(AgentBuilderChatFab).defaultProps.hoverStyle).toMatchObject({
      transform: 'scale(1.05)',
      shadowColor: 'color-mix(in srgb, var(--agent) 45%, transparent)',
      shadowRadius: 20,
    })
  })
})

describe('toggle switches → on/off variants', () => {
  it('.configuration-form__toggle-switch flips primary/muted', () => {
    const v = sc(AgentBuilderConfigToggleSwitch).variants
    expect(v.on.true).toMatchObject({ backgroundColor: '$primary' })
    expect(v.on.false).toMatchObject({ backgroundColor: '$muted' })
  })

  it('.configuration-form__toggle-knob translates on', () => {
    const v = sc(AgentBuilderConfigToggleKnob).variants
    expect(v.on.true).toMatchObject({ transform: 'translateX(20px)' })
    expect(v.on.false).toMatchObject({ transform: 'translateX(0)' })
  })

  it('.slash-action-card__toggle flips brand-3/neutral', () => {
    const v = sc(AgentBuilderSlashActionCardToggle).variants
    expect(v.on.true).toMatchObject({ backgroundColor: '$brand-3' })
    expect(v.on.false).toMatchObject({ backgroundColor: '$neutral' })
  })
})

describe('.knowledge-pill → selected variant + hover', () => {
  it('base is a transparent bordered pill with an agent hover', () => {
    expect(sc(AgentBuilderKnowledgePill).defaultProps).toMatchObject({
      display: 'inline-flex',
      borderColor: '$border',
      color: '$foreground',
    })
    expect(sc(AgentBuilderKnowledgePill).defaultProps.hoverStyle).toMatchObject({
      borderColor: '$agent',
      color: '$agent',
    })
  })

  it('--selected fills with the agent surface', () => {
    expect(sc(AgentBuilderKnowledgePill).variants.selected.true).toMatchObject({
      borderColor: '$agent',
      backgroundColor: '$agent',
      color: '$agent-foreground',
    })
  })
})

describe('.slash-action-card → enabled/disabled variants (alpha via color-mix)', () => {
  it('base is a muted rounded-xl 2px card', () => {
    expect(sc(AgentBuilderSlashActionCard).defaultProps).toMatchObject({
      padding: '$3',
      borderRadius: '$radius-xl',
      borderWidth: 2,
      backgroundColor: '$muted',
    })
  })

  it('--enabled/--disabled carry the brand-3 tints and dim', () => {
    const v = sc(AgentBuilderSlashActionCard).variants
    expect(v.enabled.true).toMatchObject({
      borderColor: 'color-mix(in srgb, var(--brand-3) 30%, transparent)',
      backgroundColor: 'color-mix(in srgb, var(--brand-3) 10%, transparent)',
    })
    expect(v.disabled.true).toMatchObject({ borderColor: '$border', opacity: 0.6 })
  })
})

describe('grid + card hover shadows', () => {
  it('.saved-agents-list__grid is a real CSS grid with an auto-fill template', () => {
    expect(sc(AgentBuilderSavedListGrid).defaultProps).toMatchObject({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: '$4',
    })
  })

  it('.area-knowledge__card hover swaps to a knowledge-tinted shadow', () => {
    expect(sc(AgentBuilderAreaKnowledgeCard).defaultProps).toMatchObject({
      shadowColor: 'rgba(0,0,0,0.04)',
      borderRadius: '$radius-lg',
    })
    expect(sc(AgentBuilderAreaKnowledgeCard).defaultProps.hoverStyle).toMatchObject({
      borderColor: '$knowledge',
      shadowColor: 'color-mix(in srgb, var(--knowledge) 12%, transparent)',
    })
  })
})

describe('StyledAgentBuilder renders', () => {
  it('renders the .is_AgentBuilder shell', () => {
    const { container } = render(
      <P>
        <StyledAgentBuilder />
      </P>,
    )
    expect(container.querySelector('.is_AgentBuilder')).toBeTruthy()
  })
})
