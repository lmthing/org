import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { TamaguiProvider } from '@tamagui/core'
import {
  AuthGithubLoginAuthenticatedFrame,
  AuthGithubLoginDeviceCodeFrame,
  AuthLoginScreenFrame,
  AuthLoginScreenContainerFrame,
  AuthLoginScreenErrorFrame,
  StyledLoginScreen,
} from './auth.styled'
import { tamaguiWebConfig } from '../../theme/tamagui-web.config'

const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

const authed = (AuthGithubLoginAuthenticatedFrame as unknown as { staticConfig: any }).staticConfig
const deviceCode = (AuthGithubLoginDeviceCodeFrame as unknown as { staticConfig: any }).staticConfig
const screen = (AuthLoginScreenFrame as unknown as { staticConfig: any }).staticConfig
const container = (AuthLoginScreenContainerFrame as unknown as { staticConfig: any }).staticConfig
const error = (AuthLoginScreenErrorFrame as unknown as { staticConfig: any }).staticConfig

describe('.github-login / .login-screen → styled()', () => {
  it('authenticated row is a centered gapped flex row', () => {
    expect(authed.defaultProps).toMatchObject({ display: 'flex', alignItems: 'center', gap: '$2' })
  })

  it('device-code is a centered 2xl block', () => {
    expect(deviceCode.defaultProps).toMatchObject({ display: 'block', textAlign: 'center', fontSize: '$2xl' })
  })

  it('login-screen fills the viewport height', () => {
    expect(screen.defaultProps).toMatchObject({ minHeight: '100vh', alignItems: 'center', justifyContent: 'center' })
  })

  it('container is a capped-width column', () => {
    expect(container.defaultProps).toMatchObject({ maxWidth: 360, flexDirection: 'column', gap: '$8' })
  })

  it('error uses the destructive token', () => {
    expect(error.defaultProps).toMatchObject({ color: '$destructive' })
  })
})

describe('StyledLoginScreen renders', () => {
  it('renders the base frame', () => {
    const { container: c } = render(<P><StyledLoginScreen /></P>)
    expect(c.querySelector('.is_AuthLoginScreen')).toBeTruthy()
  })
})
