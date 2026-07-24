import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { TerminalFrame, TerminalViewportFrame } from './terminal.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (composite) — `.terminal` chrome ⇄ styled() + variants (docs §4). */
const term = (TerminalFrame as unknown as { staticConfig: any }).staticConfig
const viewport = (TerminalViewportFrame as unknown as { staticConfig: any }).staticConfig

describe('.terminal → styled() structure', () => {
  it('container is a full, clipped, rounded background column', () => {
    expect(term.defaultProps).toMatchObject({
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      backgroundColor: '$background',
      overflow: 'hidden',
      borderRadius: '$radius-md',
    })
  })

  it('exposes a `loading` boolean variant (centered)', () => {
    expect(term.variants.loading.true).toMatchObject({ alignItems: 'center', justifyContent: 'center' })
  })

  it('__viewport grows with min-h-0', () => {
    expect(viewport.defaultProps).toMatchObject({ flexGrow: 1, minHeight: 0 })
  })
})

describe('TerminalFrame renders', () => {
  it('renders the container + viewport frames', () => {
    const Term = TerminalFrame as unknown as React.ComponentType<any>
    const VP = TerminalViewportFrame as unknown as React.ComponentType<any>
    const { container } = render(<P><Term loading><VP /></Term></P>)
    expect(container.querySelector('.is_Terminal')).toBeTruthy()
    expect(container.querySelector('.is_TerminalViewport')).toBeTruthy()
  })
})
