'use client'

import { useAuth } from '@lmthing/auth'

import * as Prim from '../../../elements/primitives'
import { Button } from '../../../elements/forms/button'
import { CozyThingText } from '../../../elements/branding/cozy-text'

export function LoginScreen() {
  const { login } = useAuth()

  // `minHeight: 100vh` is how this centres on web, and it means nothing to Yoga — there is no
  // viewport unit on native, so the box took its content's height and the form sat at the top of
  // the screen instead of the middle. `flex: 1` is the native half of the same instruction; on web
  // it is inert in a block parent and agrees with `100vh` in a flex one, so both targets centre
  // from one declaration.
  return (
    <Prim.Box display="flex" alignItems="center" justifyContent="center" minHeight="100vh" flex={1} padding="$4">
      <Prim.Box display="flex" flexDirection="column" width="100%" maxWidth={360} gap="$8">
        <Prim.Box textAlign="center">
          <Prim.Text as="h1" fontSize={28} fontWeight="$bold" letterSpacing={'-0.02em' as unknown as number} margin={0}>
            <CozyThingText text="lmthing" />
          </Prim.Text>
          <Prim.Text block fontSize="$sm" opacity={0.6} marginTop="$1">
            Sign in to continue
          </Prim.Text>
        </Prim.Box>

        <Button
          type="button"
          variant="primary"
          width="100%"
          marginTop="$1"
          onClick={() => login()}
        >
          Sign in
        </Button>
      </Prim.Box>
    </Prim.Box>
  )
}
