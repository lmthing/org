'use client'

import { useCallback, useState } from 'react'
import { useAuth } from '@lmthing/auth'

import * as Prim from '../../../elements/primitives'
import { Button } from '../../../elements/forms/button'
import { Input } from '../../../elements/forms/input'
import { CozyThingText } from '../../../elements/branding/cozy-text'

/**
 * The sign-in surface, shared by web and native.
 *
 * Two doors, and they differ in a way that matters on a phone:
 *
 *   - **Email** — the gateway mails a 6-digit code, the user types it back here, and the session is
 *     minted by two plain `fetch` calls. Nothing leaves the app, so on native there is **no browser
 *     sheet at all** — which is the whole point: a login that completes in-app.
 *   - **GitHub** — `login()`, unchanged, which leaves for the identity provider (a redirect on web,
 *     an `openAuthSessionAsync` browser session on native). This is not a shortcoming to be fixed
 *     later: an OAuth handoff MUST happen in a real browser session rather than an embedded WebView,
 *     both by GitHub's policy and by the app stores'. Only the email path can be in-app, and it is.
 *
 * The magic link in the mail is a web convenience and is not used here. Off the web the gateway is
 * given no `redirect_uri` — its allowlist accepts http/https only, so a `lmthing://` deep link would
 * be rejected — and a link opened on a device that did not start the flow answers with the code to
 * type instead, which lands the user right back on this screen's second step.
 *
 * Every string is wrapped in `Prim.Text`: a bare string inside a `View` is silently dropped on
 * native, so an un-wrapped label is invisible on a phone and perfectly fine on the web.
 */
export function LoginScreen() {
  const { login, sendEmailCode, signInWithEmailCode } = useAuth()

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const requestCode = useCallback(
    async (resending = false) => {
      setError('')
      setNotice('')
      setBusy(true)
      try {
        const sent = await sendEmailCode(email.trim())
        setMaskedEmail(sent.maskedEmail)
        setStep('code')
        if (resending) {
          setCode('')
          setNotice('Sent a new code — the previous one no longer works.')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send the code')
      } finally {
        setBusy(false)
      }
    },
    [email, sendEmailCode],
  )

  const submitCode = useCallback(async () => {
    setError('')
    setBusy(true)
    try {
      // No navigation on success: adopting the session flips `isAuthenticated`, and the app that
      // rendered this screen swaps it for the signed-in tree. Native has nowhere to redirect to.
      await signInWithEmailCode(email.trim(), code.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work')
      setBusy(false)
    }
  }, [code, email, signInWithEmailCode])

  // `minHeight: 100vh` is how this centres on web, and it means nothing to Yoga — there is no
  // viewport unit on native, so the box took its content's height and the form sat at the top of
  // the screen instead of the middle. `flex: 1` is the native half of the same instruction; on web
  // it is inert in a block parent and agrees with `100vh` in a flex one, so both targets centre
  // from one declaration.
  return (
    <Prim.Box display="flex" alignItems="center" justifyContent="center" minHeight="100vh" flex={1} padding="$4">
      <Prim.Box display="flex" flexDirection="column" width="100%" maxWidth={360} gap="$6">
        <Prim.Box textAlign="center">
          <Prim.Text as="h1" fontSize={28} fontWeight="$bold" letterSpacing={'-0.02em' as unknown as number} margin={0}>
            <CozyThingText text="lmthing" />
          </Prim.Text>
          <Prim.Text block fontSize="$sm" opacity={0.6} marginTop="$1">
            {step === 'email'
              ? 'Sign in with your email, or continue with GitHub.'
              : `Enter the 6-digit code we sent to ${maskedEmail}.`}
          </Prim.Text>
        </Prim.Box>

        {error ? (
          <Prim.Box borderRadius="$radius-md" borderWidth={1} borderColor="$destructive" padding="$3">
            <Prim.Text fontSize="$sm" color="$destructive">
              {error}
            </Prim.Text>
          </Prim.Box>
        ) : null}

        {notice ? (
          <Prim.Box borderRadius="$radius-md" borderWidth={1} borderColor="$border" padding="$3">
            <Prim.Text fontSize="$sm" opacity={0.7}>
              {notice}
            </Prim.Text>
          </Prim.Box>
        ) : null}

        {step === 'email' ? (
          <Prim.Box display="flex" flexDirection="column" gap="$3">
            <Input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              // `inputMode` rather than RN's `keyboardType`: it is the one spelling both targets
              // accept (React DOM types it, and RN's TextInput maps it onto the keyboard itself),
              // so the phone gets an `@` key without `Input` growing a native-only prop.
              // `autoCapitalize` matters just as much — a capitalised first letter silently
              // corrupts the mailbox the code is sent to. `autoCorrect` is deliberately absent:
              // the DOM types it as a string and RN wants a boolean, so `"off"` would arrive
              // truthy on native and turn autocorrect ON.
              autoCapitalize="none"
              autoComplete="email"
              inputMode="email"
            />
            <Button
              type="button"
              variant="primary"
              width="100%"
              disabled={busy || email.trim().length === 0}
              onClick={() => void requestCode()}
            >
              {busy ? 'Sending code…' : 'Continue with email'}
            </Button>
            <Prim.Text fontSize="$xs" opacity={0.6}>
              No password needed — we’ll email you a code.
            </Prim.Text>
          </Prim.Box>
        ) : (
          <Prim.Box display="flex" flexDirection="column" gap="$3">
            <Input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="123456"
              autoCapitalize="none"
              autoComplete="one-time-code"
              inputMode="numeric"
            />
            <Button
              type="button"
              variant="primary"
              width="100%"
              disabled={busy || code.trim().length === 0}
              onClick={() => void submitCode()}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <Prim.Box display="flex" flexDirection="row" gap="$3">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void requestCode(true)}>
                Send a new code
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setStep('email')
                  setCode('')
                  setError('')
                  setNotice('')
                }}
              >
                Use a different email
              </Button>
            </Prim.Box>
          </Prim.Box>
        )}

        <Prim.Box display="flex" alignItems="center" justifyContent="center">
          <Prim.Text fontSize="$xs" opacity={0.5}>
            OR
          </Prim.Text>
        </Prim.Box>

        <Button type="button" variant="outline" width="100%" disabled={busy} onClick={() => login()}>
          Continue with GitHub
        </Button>
      </Prim.Box>
    </Prim.Box>
  )
}
