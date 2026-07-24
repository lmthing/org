import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  ComputerLogsViewerFrame,
  ComputerLogsViewerToolbarFrame,
  ComputerLogsViewerListFrame,
  ComputerLogsViewerEntryFrame,
  ComputerLogsViewerTimestampFrame,
  ComputerLogsViewerSourceFrame,
  ComputerLogsViewerMessageFrame,
  ComputerLogsViewerEmptyFrame,
  StyledComputerLogsViewer,
} from './logs-viewer.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const root = (ComputerLogsViewerFrame as unknown as { staticConfig: any }).staticConfig
const toolbar = (ComputerLogsViewerToolbarFrame as unknown as { staticConfig: any }).staticConfig
const list = (ComputerLogsViewerListFrame as unknown as { staticConfig: any }).staticConfig
const timestamp = (ComputerLogsViewerTimestampFrame as unknown as { staticConfig: any }).staticConfig
const source = (ComputerLogsViewerSourceFrame as unknown as { staticConfig: any }).staticConfig
const message = (ComputerLogsViewerMessageFrame as unknown as { staticConfig: any }).staticConfig

describe('.computer-logs-viewer → styled()', () => {
  it('base is a full-height column', () => {
    expect(root.defaultProps).toMatchObject({ flexDirection: 'column', height: '100%' })
  })
  it('__toolbar has a bottom border', () => {
    expect(toolbar.defaultProps).toMatchObject({ gap: '$2', borderBottomWidth: 1, borderBottomColor: '$border' })
  })
  it('__list is a scrollable mono region', () => {
    expect(list.defaultProps).toMatchObject({ flexGrow: 1, overflow: 'auto', fontFamily: 'monospace', fontSize: '$xs', padding: '$3' })
  })
  it('__timestamp / __source carry their tokens', () => {
    expect(timestamp.defaultProps).toMatchObject({ color: '$muted-foreground', flexShrink: 0 })
    expect(source.defaultProps).toMatchObject({ color: '$primary', flexShrink: 0 })
  })
  it('__message exposes warn/error levels', () => {
    expect(message.variants.level.warn).toMatchObject({ color: '$warning' })
    expect(message.variants.level.error).toMatchObject({ color: '$destructive' })
  })
})

describe('StyledComputerLogsViewer renders', () => {
  it('renders the frame', () => {
    const { container } = render(<P><StyledComputerLogsViewer /></P>)
    expect(container.querySelector('.is_ComputerLogsViewer')).toBeTruthy()
  })
})
