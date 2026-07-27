import * as React from 'react'
import { useColorScheme } from 'react-native'
import { TamaguiProvider } from '@tamagui/core'
import { StatusBar } from 'expo-status-bar'
import { AuthProvider, hydrateAuth, useAuth, getSession, storeSession } from '@lmthing/auth'
import { tamaguiConfig } from '@lmthing/ui/theme/tamagui.config'
import { LoginScreen } from '@lmthing/ui/components/auth/login-screen'
import { ChatShell } from '@lmthing/ui/chat'
import * as Prim from '@lmthing/ui/elements/primitives'
import { ensureComputePod, waitForPodEdge } from './src/ensure-pod'

/**
 * Root of the LMThing mobile app.
 *
 * The provider is the ONLY thing this shell contributes: the config is the shared one, generated
 * from the same `tokens.json` as the web `theme.css` and proven byte-equal by the Layer-1 parity
 * tests, so a colour or radius cannot mean one thing here and another on web.
 *
 * The shell is deliberately this thin. Screens belong in `@lmthing/ui`, where both targets render
 * them from one source; a screen written HERE would be a fork of the product that no gate could
 * see. `scripts/lint-barrel-imports.mjs` enforces that by refusing deep imports into the shared
 * package's internals. `AuthGate` below composes those shared screens (`LoginScreen`, `ChatShell`)
 * by import, same as `apps/web` does — it does not define one.
 *
 * The one other thing it owns is the BOOT ORDER. `getSession()` is synchronous everywhere, but on
 * native it is answered from a cache that `hydrateAuth()` fills from the OS keystore — so rendering
 * before that resolves would paint a logged-out app to a logged-in user and then flip. Holding the
 * tree back is the whole contract; `libs/auth/src/platform/session-store.native.ts` states it and
 * `isAuthHydrated()` exists so it can be asserted rather than assumed.
 */
const TEST_SESSION_JSON = process.env.EXPO_PUBLIC_TEST_SESSION

export default function App() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const [authReady, setAuthReady] = React.useState(false)

  React.useEffect(() => {
    // Never rejects — an unreadable keystore entry is treated as "logged out", not a boot loop.
    void hydrateAuth()
      .then(() => {
        // TEMPORARY, device-verification only (docs/mobile-native-chat-CONTINUE.md "device
        // verification" gap): interactive SSO needs either GitHub OAuth (real credentials) or
        // password login, which is broken in this environment (.issues/zitadel-password-login-
        // disabled.md). This seeds an already-minted, real gateway session — the same shape
        // `exchangeSsoCode` would store — so the chat/pod data path can be verified end-to-end on
        // a device while that gap stays open. Inert (no-op) unless EXPO_PUBLIC_TEST_SESSION is set
        // at build time; never set in a real build. Remove once real interactive SSO is verified.
        if (TEST_SESSION_JSON && !getSession()) {
          try {
            storeSession(JSON.parse(TEST_SESSION_JSON))
          } catch {
            /* malformed test session — fall through to the normal login screen */
          }
        }
      })
      .finally(() => setAuthReady(true))
  }, [])

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
      <StatusBar style="auto" />
      {authReady ? (
        <AuthProvider appName="mobile">
          <AuthGate />
        </AuthProvider>
      ) : null}
    </TamaguiProvider>
  )
}

type PodState = 'pending' | 'ready' | 'error'

/**
 * Not a screen of its own — sequences the two things that must be true before `ChatShell` can make
 * its first pod fetch: signed in, and the pod's own edge (not just the gateway) serving. Mirrors
 * `AuthGate`/`PodEnsureGate` in `apps/web/src/lib/gates.tsx`, which can't be imported directly (it's
 * web-only: `sessionStorage`, a same-origin relative fetch). `./src/ensure-pod.ts` is the native-safe
 * equivalent of the half of that file this app needs.
 */
function AuthGate() {
  const { isAuthenticated, isLoading, getAccessToken } = useAuth()
  const [pod, setPod] = React.useState<PodState>('pending')
  const [error, setError] = React.useState<string | null>(null)
  const startedRef = React.useRef(false)

  React.useEffect(() => {
    if (!isAuthenticated || startedRef.current) return
    startedRef.current = true
    void (async () => {
      try {
        await ensureComputePod(getAccessToken)
        await waitForPodEdge(getAccessToken)
        setPod('ready')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPod('error')
      }
    })()
  }, [isAuthenticated, getAccessToken])

  if (isLoading) return null
  if (!isAuthenticated) return <LoginScreen />

  if (pod === 'error') {
    return (
      <Prim.Box display="flex" alignItems="center" justifyContent="center" flex={1} padding="$4">
        <Prim.Text textAlign="center">{error ?? 'Could not start your workspace.'}</Prim.Text>
      </Prim.Box>
    )
  }

  if (pod !== 'ready') {
    return (
      <Prim.Box display="flex" alignItems="center" justifyContent="center" flex={1}>
        <Prim.Text>Starting your workspace…</Prim.Text>
      </Prim.Box>
    )
  }

  return <ChatShell />
}
