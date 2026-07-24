import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  ChatPanelFrame,
  ChatPanelMessagesFrame,
  ChatPanelBubbleFrame,
  ChatPanelBubbleContentFrame,
  ChatPanelBubbleSlashTagFrame,
  ChatPanelLoadingDotFrame,
  StyledChatPanel,
} from './chat-panel.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const panel = (ChatPanelFrame as unknown as { staticConfig: any }).staticConfig
const messages = (ChatPanelMessagesFrame as unknown as { staticConfig: any }).staticConfig
const bubble = (ChatPanelBubbleFrame as unknown as { staticConfig: any }).staticConfig
const content = (ChatPanelBubbleContentFrame as unknown as { staticConfig: any }).staticConfig
const slashTag = (ChatPanelBubbleSlashTagFrame as unknown as { staticConfig: any }).staticConfig

describe('.chat-panel → styled()', () => {
  it('base is a full-height overflow-hidden column', () => {
    expect(panel.defaultProps).toMatchObject({
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      height: '100%',
    })
  })

  it('__messages carries the flex-1 + padded scroll region', () => {
    expect(messages.defaultProps).toMatchObject({
      flexGrow: 1,
      overflowY: 'auto',
      paddingVertical: '$4',
      paddingHorizontal: '$6',
    })
  })

  it('bubble exposes a `role` variant (user/assistant justify)', () => {
    expect(bubble.variants.role.user).toMatchObject({ justifyContent: 'flex-end' })
    expect(bubble.variants.role.assistant).toMatchObject({ justifyContent: 'flex-start' })
  })

  it('bubble content exposes a `user` surface variant on the agent tokens', () => {
    expect(content.variants.user.true).toMatchObject({ backgroundColor: '$agent', color: '$agent-foreground' })
  })

  it('slash-tag uses the brand-2 tint via color-mix', () => {
    expect(slashTag.defaultProps.backgroundColor).toBe('color-mix(in srgb, var(--brand-2) 15%, transparent)')
    expect(slashTag.defaultProps.color).toBe('$brand-2')
  })

  it('loading dot is a muted-foreground pill (animation omitted)', () => {
    const dot = (ChatPanelLoadingDotFrame as unknown as { staticConfig: any }).staticConfig
    expect(dot.defaultProps).toMatchObject({ backgroundColor: '$muted-foreground', borderRadius: '$radius-full' })
  })
})

describe('StyledChatPanel renders', () => {
  it('renders the base frame', () => {
    const { container } = render(<P><StyledChatPanel /></P>)
    expect(container.querySelector('.is_ChatPanel')).toBeTruthy()
  })
})
