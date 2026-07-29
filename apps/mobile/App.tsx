import * as React from 'react'
import { KeyboardAvoidingView, Platform, useColorScheme } from 'react-native'
import { TamaguiProvider } from '@tamagui/core'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { AuthProvider, hydrateAuth, useAuth, getSession, storeSession } from '@lmthing/auth'
import { tamaguiConfig } from '@lmthing/ui/theme/tamagui.config'
import { LoginScreen } from '@lmthing/ui/components/auth/login-screen'
import { ChatShell } from '@lmthing/ui/chat'
import { DashboardHome } from '@lmthing/ui/dashboard'
import { BottomNav, type BottomNavTab } from '@lmthing/ui/elements/nav/bottom-nav'
import * as Prim from '@lmthing/ui/elements/primitives'
import { ensureComputePod, waitForPodEdge } from './src/ensure-pod'
import { TeamScreen } from './src/TeamScreen'
import { AppScreen } from './src/AppScreen'

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
    <SafeAreaProvider>
      <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
        <StatusBar style="auto" />
        {/*
          The shared surfaces are written for a viewport that begins at the top of the window,
          because on web it does. A phone's does not: the status bar and the gesture pill are drawn
          OVER the app, so the chat header rendered underneath the system clock and the composer sat
          under the home indicator. `SafeAreaView` insets the whole tree instead of asking every
          shared component to know it is on a phone — the surfaces stay target-agnostic, which is
          the invariant this app exists to keep.
        */}
        <SafeAreaView style={{ flex: 1 }}>
          {/*
            And the other thing a phone does that a browser does not: it puts a keyboard OVER the
            app. `android:windowSoftInputMode="adjustResize"` is set and is no longer enough on its
            own — React Native 0.86 draws edge-to-edge by default, so the window does not resize and
            the composer of every surface sat underneath the keyboard, invisible, with its send
            button unreachable. You could type into a box you could not see.

            It belongs here rather than in each surface for the same reason `SafeAreaView` does: a
            shared component knowing it is on a phone is the thing this app exists to avoid.
          */}
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            {authReady ? (
              <AuthProvider appName="mobile">
                <AuthGate />
              </AuthProvider>
            ) : null}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </TamaguiProvider>
    </SafeAreaProvider>
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

  return <HomeShell />
}

/**
 * The signed-in app: a Home dashboard and the chat surface, switched by the tab bar.
 *
 * Both are mounted at once and one is hidden, rather than unmounted — `ChatShell` holds a live
 * WebSocket to the pod and a transcript, and tearing that down every time someone glances at Home
 * would drop a streaming turn mid-sentence. Hiding costs a little memory; unmounting costs the
 * user's conversation.
 *
 * `Teams` is a real pane now, not a hop to the browser: `@lmthing/ui/team` renders the same surface
 * the web app does, so there is nothing left to hand off to. `TeamScreen` is the host that supplies
 * the two native-specific things (an absolute pod URL, and rail/channel state where web uses a URL).
 *
 * It is mounted like the others — hidden, never unmounted — for the same reason: it holds a live
 * socket to the team's pod, and tearing that down on every tab glance would drop whatever arrived
 * while the member was looking at Home.
 */
function HomeShell() {
  const { getAccessToken } = useAuth()
  const [tab, setTab] = React.useState<BottomNavTab>('home')
  // Mentions waiting in the team, badged on the tab. The Teams pane stays mounted while hidden, so
  // it keeps hearing the channel socket — without surfacing the count here, a member on Home had no
  // way at all to learn that somebody had named them.
  const [teamMentions, setTeamMentions] = React.useState(0)
  // Which project's app is open, if any. State here rather than a route because native has no URL —
  // the same reason `TeamScreen` owns its rail.
  const [openApp, setOpenApp] = React.useState<{ id: string; name: string } | null>(null)

  // Covers the tabs rather than replacing a pane: an app is a place you go INTO and come back from,
  // and the chat socket behind it should not be torn down to look at one.
  //
  // `AppScreen` decides for itself whether this project renders natively (a `system-viewbuilder`
  // app) or in a WebView (a `system-appbuilder` app) — it asks the pod, which is also where the
  // specs come from, so the question and the answer are one fetch. The token is this app's own:
  // there is no origin here and nothing is cookie-authed.
  if (openApp) {
    return (
      <AppScreen
        projectId={openApp.id}
        name={openApp.name}
        onClose={() => setOpenApp(null)}
        getToken={getAccessToken}
      />
    )
  }

  return (
    <Prim.Box flex={1}>
      {/* `flexDirection` is stated, not implied. `nativeSafeProps` reads a bare `display: 'flex'`
          as the WEB default (row), which is right for the ~58 shared style objects written that way
          — but these two panes are columns, and leaving it unsaid laid the whole chat surface out
          sideways into a blank screen. An explicit direction always wins over the seam's default. */}
      <Prim.Box flex={1} flexDirection="column" display={tab === 'home' ? 'flex' : 'none'}>
        <DashboardHome
          onNewChat={() => setTab('chat')}
          onOpenConversation={() => setTab('chat')}
          // `DashboardHome` has always offered this and this app never passed it, so tapping a
          // project on Home did nothing at all — a personal app could not be opened on a phone.
          onOpenProject={(project) => setOpenApp({ id: project.id, name: project.name })}
        />
      </Prim.Box>
      <Prim.Box flex={1} flexDirection="column" display={tab === 'chat' ? 'flex' : 'none'}>
        <ChatShell />
      </Prim.Box>
      <Prim.Box flex={1} flexDirection="column" display={tab === 'teams' ? 'flex' : 'none'}>
        <TeamScreen onMentionCount={setTeamMentions} />
      </Prim.Box>
      <BottomNav
        current={tab}
        onSelect={setTab}
        {...(teamMentions > 0 && tab !== 'teams' ? { badges: { teams: teamMentions } } : {})}
      />
    </Prim.Box>
  )
}
