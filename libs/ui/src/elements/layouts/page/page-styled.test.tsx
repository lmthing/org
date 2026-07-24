import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { PageFrame, PageHeaderFrame, PageBodyFrame, StyledPage, StyledPageHeader } from './page.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (composite) — `.page` family ⇄ styled() + variants (docs §4). */
const page = (PageFrame as unknown as { staticConfig: any }).staticConfig
const header = (PageHeaderFrame as unknown as { staticConfig: any }).staticConfig
const body = (PageBodyFrame as unknown as { staticConfig: any }).staticConfig

describe('.page → styled() structure', () => {
  it('base is a full-height background column', () => {
    expect(page.defaultProps).toMatchObject({ flexDirection: 'column', minHeight: '100vh', backgroundColor: '$background' })
  })

  it('exposes a `full` boolean variant (h-screen, overflow-hidden)', () => {
    expect(page.variants.full.true).toMatchObject({ height: '100vh', overflow: 'hidden' })
  })

  it('__header/__body carry their tokens', () => {
    expect(header.defaultProps).toMatchObject({ alignItems: 'center', paddingHorizontal: '$6', paddingVertical: '$4', borderBottomColor: '$border' })
    expect(body.defaultProps).toMatchObject({ flexGrow: 1, overflow: 'auto', padding: '$6' })
  })
})

describe('StyledPage renders', () => {
  it('renders page + header frames', () => {
    const { container } = render(<P><StyledPage full><StyledPageHeader>H</StyledPageHeader></StyledPage></P>)
    expect(container.querySelector('.is_Page')).toBeTruthy()
    expect(container.querySelector('.is_PageHeader')).toBeTruthy()
  })
})
