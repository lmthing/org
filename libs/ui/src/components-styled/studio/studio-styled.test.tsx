import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { StudioListHeaderFrame, StudioListEmptyFrame, StyledStudioListHeader, StyledStudioListEmpty } from './studio.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const header = (StudioListHeaderFrame as unknown as { staticConfig: any }).staticConfig
const empty = (StudioListEmptyFrame as unknown as { staticConfig: any }).staticConfig

describe('.studio-list → styled()', () => {
  it('__header is a space-between centered row', () => {
    expect(header.defaultProps).toMatchObject({ display: 'flex', justifyContent: 'space-between', alignItems: 'center' })
  })
  it('__empty is a centered flex-col with p-12', () => {
    expect(empty.defaultProps).toMatchObject({ flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '$12' })
  })
})

describe('Styled studio frames render', () => {
  it('renders the header + empty frames', () => {
    const { container } = render(
      <P><StyledStudioListHeader /><StyledStudioListEmpty /></P>,
    )
    expect(container.querySelector('.is_StudioListHeader')).toBeTruthy()
    expect(container.querySelector('.is_StudioListEmpty')).toBeTruthy()
  })
})
