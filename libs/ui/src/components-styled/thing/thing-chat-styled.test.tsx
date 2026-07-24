import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  ThingChatFrame,
  ThingChatComputerBtnFrame,
  ThingCodeBlockInnerFrame,
  ThingErrorBlockFrame,
  ThingChatTextareaFrame,
  ThingChatSendBtnFrame,
  StyledThingChat,
} from './thing-chat.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const chat = (ThingChatFrame as unknown as { staticConfig: any }).staticConfig
const compBtn = (ThingChatComputerBtnFrame as unknown as { staticConfig: any }).staticConfig
const codeInner = (ThingCodeBlockInnerFrame as unknown as { staticConfig: any }).staticConfig
const errBlock = (ThingErrorBlockFrame as unknown as { staticConfig: any }).staticConfig
const textarea = (ThingChatTextareaFrame as unknown as { staticConfig: any }).staticConfig
const sendBtn = (ThingChatSendBtnFrame as unknown as { staticConfig: any }).staticConfig

describe('.thing-chat → styled()', () => {
  it('base is a full-height flex column over the background', () => {
    expect(chat.defaultProps).toMatchObject({ flexDirection: 'column', height: '100%', minWidth: 0, backgroundColor: '$background' })
  })
  it('__computer-btn is a muted pill with a hover blend', () => {
    expect(compBtn.defaultProps).toMatchObject({ borderRadius: '$radius-full', backgroundColor: '$muted' })
    expect(compBtn.defaultProps.hoverStyle.backgroundColor).toContain('color-mix')
  })
  it('code-block inner is monospace pre-wrap capped at 16rem', () => {
    expect(codeInner.defaultProps).toMatchObject({ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '$64' })
  })
  it('error block uses the destructive border + text', () => {
    expect(errBlock.defaultProps).toMatchObject({ borderColor: '$destructive', color: '$destructive' })
  })
  it('__textarea carries a ring focus + dim disabled state', () => {
    expect(textarea.defaultProps.focusStyle).toMatchObject({ borderColor: '$ring' })
    expect(textarea.defaultProps.focusStyle.outlineColor).toContain('color-mix')
    expect(textarea.defaultProps.disabledStyle).toMatchObject({ opacity: 0.4, cursor: 'not-allowed' })
  })
  it('__send-btn is a primary button with a dim disabled state', () => {
    expect(sendBtn.defaultProps).toMatchObject({ backgroundColor: '$primary', color: '$primary-foreground' })
    expect(sendBtn.defaultProps.disabledStyle).toMatchObject({ opacity: 0.4 })
  })
})

describe('StyledThingChat renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledThingChat /></P>)
    expect(container.querySelector('.is_ThingChat')).toBeTruthy()
  })
})
