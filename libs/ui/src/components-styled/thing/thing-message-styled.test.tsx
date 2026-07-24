import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { ThingMessageFrame, ThingMessageRoleFrame, ThingMessageContentFrame, StyledThingMessage } from './thing-message.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const msg = (ThingMessageFrame as unknown as { staticConfig: any }).staticConfig
const role = (ThingMessageRoleFrame as unknown as { staticConfig: any }).staticConfig
const content = (ThingMessageContentFrame as unknown as { staticConfig: any }).staticConfig

describe('.thing-message → styled()', () => {
  it('base is an 80% bubble', () => {
    expect(msg.defaultProps).toMatchObject({ maxWidth: '80%' })
  })
  it('exposes user/assistant role variants', () => {
    expect(msg.variants.role.user).toMatchObject({ marginLeft: 'auto', backgroundColor: '$primary' })
    expect(msg.variants.role.assistant).toMatchObject({ marginRight: 'auto' })
  })
  it('__role is a text-xs label with a user alpha variant', () => {
    expect(role.defaultProps).toMatchObject({ fontSize: '$xs', marginBottom: '$1' })
    expect(role.variants.user.true.color).toContain('color-mix')
  })
  it('__content is a pre-wrapped text-sm body', () => {
    expect(content.defaultProps).toMatchObject({ whiteSpace: 'pre-wrap', fontSize: '$sm' })
  })
})

describe('StyledThingMessage renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledThingMessage role="user" /></P>)
    expect(container.querySelector('.is_ThingMessage')).toBeTruthy()
  })
})
