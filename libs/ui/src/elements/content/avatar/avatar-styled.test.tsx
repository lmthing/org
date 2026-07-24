import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  AvatarFrame,
  AvatarImageFrame,
  AvatarFallbackFrame,
  StyledAvatar,
  StyledAvatarFallback,
} from './avatar.styled'
import { tamaguiWebConfig } from '../../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/** P2 proof gate (leaf) — `.avatar` family ⇄ styled() + variants (docs §4). */
const avatar = (AvatarFrame as unknown as { staticConfig: any }).staticConfig
const image = (AvatarImageFrame as unknown as { staticConfig: any }).staticConfig
const fallback = (AvatarFallbackFrame as unknown as { staticConfig: any }).staticConfig

describe('.avatar → styled() structure', () => {
  it('base is a round overflow-hidden size-8 muted surface', () => {
    expect(avatar.defaultProps).toMatchObject({
      position: 'relative',
      width: '$8',
      height: '$8',
      flexShrink: 0,
      overflow: 'hidden',
      borderRadius: '$radius-full',
      backgroundColor: '$muted',
      color: '$muted-foreground',
    })
  })

  it('exposes a `size` variant for default/sm/lg', () => {
    expect(Object.keys(avatar.variants.size).sort()).toEqual(['default', 'lg', 'sm'])
    expect(avatar.variants.size.sm).toMatchObject({ width: '$6', height: '$6', fontSize: '$xs' })
    expect(avatar.variants.size.lg).toMatchObject({ width: '$12', height: '$12', fontSize: '$base' })
  })

  it('__image covers, __fallback centers', () => {
    expect(image.defaultProps).toMatchObject({ height: '100%', width: '100%', objectFit: 'cover' })
    expect(fallback.defaultProps).toMatchObject({
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '$sm',
      fontWeight: '$medium',
    })
  })
})

describe('StyledAvatar renders', () => {
  it('renders the frame + shows the fallback while idle', () => {
    const { container } = render(
      <P>
        <StyledAvatar>
          <StyledAvatarFallback>AB</StyledAvatarFallback>
        </StyledAvatar>
      </P>,
    )
    expect(container.querySelector('.is_Avatar')).toBeTruthy()
    expect(container.querySelector('.is_AvatarFallback')).toBeTruthy()
  })
})
