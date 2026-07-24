import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  ThingPanelFrame,
  ThingPanelSidebarFrame,
  ThingPanelConvBtnFrame,
  ThingPanelStatusDotFrame,
  ThingMsgFrame,
  ThingMsgRoleFrame,
  StyledThingPanel,
} from './thing-panel.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const panel = (ThingPanelFrame as unknown as { staticConfig: any }).staticConfig
const sidebar = (ThingPanelSidebarFrame as unknown as { staticConfig: any }).staticConfig
const conv = (ThingPanelConvBtnFrame as unknown as { staticConfig: any }).staticConfig
const dot = (ThingPanelStatusDotFrame as unknown as { staticConfig: any }).staticConfig
const msg = (ThingMsgFrame as unknown as { staticConfig: any }).staticConfig
const msgRole = (ThingMsgRoleFrame as unknown as { staticConfig: any }).staticConfig

describe('.thing-panel → styled()', () => {
  it('base is a flex shell over the background with full/embedded modes', () => {
    expect(panel.defaultProps).toMatchObject({ display: 'flex', backgroundColor: '$background' })
    expect(panel.variants.mode.full).toMatchObject({ height: '100vh' })
    expect(panel.variants.mode.embedded).toMatchObject({ height: '100%' })
  })
  it('__sidebar is a w-64 column with a right divider', () => {
    expect(sidebar.defaultProps).toMatchObject({ width: '$64', borderRightColor: '$border', flexDirection: 'column' })
  })
  it('__conv-btn truncates and exposes an active variant', () => {
    expect(conv.defaultProps).toMatchObject({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
    expect(conv.variants.active.true).toMatchObject({ backgroundColor: '$muted', fontWeight: '$semibold' })
  })
  it('__status-dot exposes tone variants mapped to status tokens', () => {
    expect(dot.variants.tone.error).toMatchObject({ backgroundColor: '$destructive' })
    expect(dot.variants.tone.working).toMatchObject({ backgroundColor: '$agent' })
    expect(dot.variants.tone.ready).toMatchObject({ backgroundColor: '$knowledge' })
    expect(dot.variants.tone.warn).toMatchObject({ backgroundColor: '$brand-2' })
  })
  it('.thing-msg carries the bubble tokens + role surfaces', () => {
    expect(msg.defaultProps).toMatchObject({ maxWidth: '80%', borderRadius: '$radius-xl', fontSize: '$sm' })
    expect(msg.variants.role.user).toMatchObject({ alignSelf: 'flex-end', backgroundColor: '$primary', color: '$primary-foreground' })
    expect(msg.variants.role.assistant).toMatchObject({ alignSelf: 'flex-start', backgroundColor: '$card' })
  })
  it('.thing-msg__role is an uppercase wider-tracked caption', () => {
    expect(msgRole.defaultProps).toMatchObject({ textTransform: 'uppercase', letterSpacing: '$wider', fontWeight: '$semibold' })
  })
})

describe('StyledThingPanel renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledThingPanel mode="embedded" /></P>)
    expect(container.querySelector('.is_ThingPanel')).toBeTruthy()
  })
})
