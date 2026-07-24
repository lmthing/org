/** auth.styled.tsx — P2 conversion of the `.github-login` + `.login-screen` BEM blocks
 *  (docs/tamagui-idiomatic-migration.md §4). One styled() per BEM selector. Lands alongside the
 *  shipped className GithubLogin / LoginScreen. Frame names are globally-unique `Auth*`. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.github-login__authenticated` — flex! items-center; gap:0.5rem. */
export const AuthGithubLoginAuthenticatedFrame = styled(View, {
  name: 'AuthGithubLoginAuthenticated',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.github-login__device-code-hint` — margin-top:0.5rem. */
export const AuthGithubLoginDeviceCodeHintFrame = styled(View, {
  name: 'AuthGithubLoginDeviceCodeHint',
  marginTop: '$2',
})

/** `.github-login__device-code` — block!; text-align:center; letter-spacing:0.2em; font-size:1.5rem. */
export const AuthGithubLoginDeviceCodeFrame = styled(Text, {
  name: 'AuthGithubLoginDeviceCode',
  display: 'block',
  textAlign: 'center',
  letterSpacing: '0.2em' as unknown as number, // arbitrary em, no token
  fontSize: '$2xl', // 1.5rem
})

/** `.github-login__device-code-waiting` — margin-top:0.75rem. */
export const AuthGithubLoginDeviceCodeWaitingFrame = styled(View, {
  name: 'AuthGithubLoginDeviceCodeWaiting',
  marginTop: '$3',
})

/** `.github-login__icon` — w-5 h-5. */
export const AuthGithubLoginIconFrame = styled(View, {
  name: 'AuthGithubLoginIcon',
  width: '$5',
  height: '$5',
})

/** `.login-screen` — flex! items-center justify-center; min-height:100vh; padding:1rem. */
export const AuthLoginScreenFrame = styled(View, {
  name: 'AuthLoginScreen',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  padding: '$4', // 1rem
})

/** `.login-screen__container` — flex! flex-col; width:100%; max-width:360px; gap:2rem. */
export const AuthLoginScreenContainerFrame = styled(View, {
  name: 'AuthLoginScreenContainer',
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  maxWidth: 360, // no token
  gap: '$8', // 2rem
})

/** `.login-screen__branding` — text-align:center. */
export const AuthLoginScreenBrandingFrame = styled(View, {
  name: 'AuthLoginScreenBranding',
  textAlign: 'center',
})

/** `.login-screen__title` — font-size:1.75rem; font-weight:700; letter-spacing:-0.02em; margin:0. */
export const AuthLoginScreenTitleFrame = styled(Text, {
  name: 'AuthLoginScreenTitle',
  fontSize: 28, // 1.75rem, no token
  fontWeight: '$bold',
  letterSpacing: '-0.02em' as unknown as number, // arbitrary em, no token
  margin: 0,
})

/** `.login-screen__subtitle` — font-size:0.875rem; opacity:0.6; margin-top:0.25rem. */
export const AuthLoginScreenSubtitleFrame = styled(Text, {
  name: 'AuthLoginScreenSubtitle',
  fontSize: '$sm',
  opacity: 0.6,
  marginTop: '$1',
})

/** `.login-screen__form` — flex! flex-col; gap:1rem. */
export const AuthLoginScreenFormFrame = styled(View, {
  name: 'AuthLoginScreenForm',
  display: 'flex',
  flexDirection: 'column',
  gap: '$4',
})

/** `.login-screen__field` — flex! flex-col; gap:0.375rem. */
export const AuthLoginScreenFieldFrame = styled(View, {
  name: 'AuthLoginScreenField',
  display: 'flex',
  flexDirection: 'column',
  gap: '$1.5',
})

/** `.login-screen__label` — font-size:0.875rem; font-weight:500. */
export const AuthLoginScreenLabelFrame = styled(Text, {
  name: 'AuthLoginScreenLabel',
  fontSize: '$sm',
  fontWeight: '$medium',
})

/** `.login-screen__error` — font-size:0.8125rem; color:destructive; margin:0. */
export const AuthLoginScreenErrorFrame = styled(Text, {
  name: 'AuthLoginScreenError',
  fontSize: 13, // 0.8125rem, no token
  color: '$destructive',
  margin: 0,
})

/** `.login-screen__submit` — width:100%; margin-top:0.25rem. */
export const AuthLoginScreenSubmitFrame = styled(View, {
  name: 'AuthLoginScreenSubmit',
  width: '100%',
  marginTop: '$1',
})

/** `.login-screen__new-account-hint` — font-size:0.75rem; opacity:0.5; text-align:center; margin:0. */
export const AuthLoginScreenNewAccountHintFrame = styled(Text, {
  name: 'AuthLoginScreenNewAccountHint',
  fontSize: '$xs',
  opacity: 0.5,
  textAlign: 'center',
  margin: 0,
})

export interface StyledLoginScreenProps extends React.ComponentProps<'div'> {}

const Frame = AuthLoginScreenFrame as unknown as React.ComponentType<any>

/** Idiomatic LoginScreen shell — renders the `.login-screen` base frame. */
export function StyledLoginScreen({ ...props }: StyledLoginScreenProps) {
  return <Frame {...props} />
}
