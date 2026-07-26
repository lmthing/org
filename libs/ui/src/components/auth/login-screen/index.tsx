'use client'

import { useAuth } from '@lmthing/auth'

import * as Prim from '../../../elements/primitives'
import { Button } from '../../../elements/forms/button'
import { CozyThingText } from '../../../elements/branding/cozy-text'

export function LoginScreen() {
  const { login } = useAuth()

  return (
    <Prim.Box display="flex" alignItems="center" justifyContent="center" minHeight="100vh" padding="$4">
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
