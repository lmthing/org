import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import { CardFrame, CardHeaderFrame, CardBodyFrame, CardFooterFrame, StyledCard, StyledCardHeader } from './card.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (leaf) — `.card` family ⇄ styled() (docs §4). */
const card = (CardFrame as unknown as { staticConfig: any }).staticConfig
const header = (CardHeaderFrame as unknown as { staticConfig: any }).staticConfig
const body = (CardBodyFrame as unknown as { staticConfig: any }).staticConfig
const footer = (CardFooterFrame as unknown as { staticConfig: any }).staticConfig

describe('.card → styled() structure', () => {
  it('.card base carries the surface tokens', () => {
    expect(card.defaultProps).toMatchObject({
      borderRadius: '$radius-lg',
      borderColor: '$border',
      backgroundColor: '$card',
      color: '$card-foreground',
    })
  })

  it('exposes an `interactive` boolean variant (hover shadow + pointer)', () => {
    expect(Object.keys(card.variants.interactive)).toContain('true')
    expect(card.variants.interactive.true).toMatchObject({ cursor: 'pointer' })
  })

  it('.card__header/__body/__footer carry their padding tokens', () => {
    expect(header.defaultProps).toMatchObject({ flexDirection: 'column', gap: '$1.5', padding: '$4', paddingBottom: 0 })
    expect(body.defaultProps).toMatchObject({ padding: '$4' })
    expect(footer.defaultProps).toMatchObject({ alignItems: 'center', padding: '$4', paddingTop: 0 })
  })
})

describe('StyledCard renders', () => {
  it('renders the card + header frames', () => {
    const { container } = render(
      <P>
        <StyledCard interactive>
          <StyledCardHeader>Title</StyledCardHeader>
        </StyledCard>
      </P>,
    )
    expect(container.querySelector('.is_Card')).toBeTruthy()
    expect(container.querySelector('.is_CardHeader')).toBeTruthy()
  })
})
