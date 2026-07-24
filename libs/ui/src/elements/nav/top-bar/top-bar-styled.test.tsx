import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { TopBarFrame, TopBarTitleFrame, TopBarActionsFrame, StyledTopBar } from './top-bar.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (composite) — `.top-bar` family ⇄ styled() (docs §4). */
const bar = (TopBarFrame as unknown as { staticConfig: any }).staticConfig
const title = (TopBarTitleFrame as unknown as { staticConfig: any }).staticConfig
const actions = (TopBarActionsFrame as unknown as { staticConfig: any }).staticConfig

describe('.top-bar → styled() structure', () => {
  it('bar is a spaced h-12 background header with a bottom border', () => {
    expect(bar.defaultProps).toMatchObject({
      justifyContent: 'space-between',
      height: '$12',
      paddingHorizontal: '$4',
      borderBottomColor: '$border',
      backgroundColor: '$background',
    })
  })

  it('__title is a semibold truncating label; __actions is a gapped row', () => {
    expect(title.defaultProps).toMatchObject({ fontSize: '$sm', fontWeight: '$semibold', color: '$foreground', textOverflow: 'ellipsis' })
    expect(actions.defaultProps).toMatchObject({ alignItems: 'center', gap: '$2' })
  })
})

describe('StyledTopBar renders', () => {
  it('renders title + actions slots', () => {
    const { container, getByText } = render(<P><StyledTopBar title="T" actions={<button>x</button>} /></P>)
    expect(container.querySelector('.is_TopBar')).toBeTruthy()
    expect(getByText('T')).toBeTruthy()
    expect(container.querySelector('.is_TopBarActions')).toBeTruthy()
  })
})
