import * as React from 'react'
import { ActivityIndicator, Alert, AppState, KeyboardAvoidingView, Platform, useColorScheme } from 'react-native'
import { TamaguiProvider } from '@tamagui/core'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { AuthProvider, hydrateAuth, useAuth, getSession, storeSession } from '@lmthing/auth'
import { tamaguiConfig } from '@lmthing/ui/theme/tamagui.config'
import { LoginScreen } from '@lmthing/ui/components/auth/login-screen'
import { ChatShell, Drawer } from '@lmthing/ui/chat'
import { DashboardHome } from '@lmthing/ui/dashboard'
import { SurfaceSwitcher, type Surface as NavTab } from '@lmthing/ui/elements/nav/surface-switcher'
import * as Prim from '@lmthing/ui/elements/primitives'
import { onDismiss } from '@lmthing/ui/platform'
import { ensureComputePod, waitForPodEdge } from '@lmthing/ui/lib/pod-boot'
import { TeamScreen } from './src/TeamScreen'
import { AppScreen } from './src/AppScreen'
import { unregisterPush, watchPushDeepLinks, type PushDeepLink } from './src/push'
import { OfflineBanner } from './src/OfflineBanner'
import { hapticWarning, hapticSuccess } from './src/haptics'

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
            A property of the DEVICE, not of whichever surface is open — as relevant on the login
            screen (you cannot sign in offline) and the pod-boot screen (that IS a network call) as
            once a conversation is open, so it sits above everything rather than inside `HomeShell`.
          */}
          <OfflineBanner />
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
  // Bumped by the Retry button below. Previously a failed `ensureComputePod`/`waitForPodEdge` —
  // a bad network, the 120s cold-wake timeout, a 5xx — landed on static text with no way back
  // in short of force-quitting: `startedRef` latched true on the FIRST attempt and never let a
  // second one start. Including it in the effect's deps is what makes a bump actually retry.
  const [attempt, setAttempt] = React.useState(0)
  // Whether THIS boot attempt has already failed once — the success haptic below only fires on
  // recovery (attempt N+1 succeeding after attempt N failed), never on an ordinary cold boot,
  // which would otherwise buzz on literally every app open.
  const recoveredRef = React.useRef(false)

  React.useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    setPod('pending')
    setError(null)
    void (async () => {
      try {
        await ensureComputePod(getAccessToken)
        await waitForPodEdge(getAccessToken)
        if (!cancelled) {
          setPod('ready')
          if (recoveredRef.current) {
            recoveredRef.current = false
            void hapticSuccess()
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setPod('error')
          recoveredRef.current = true
          void hapticWarning()
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, getAccessToken, attempt])

  if (isLoading) return null
  if (!isAuthenticated) return <LoginScreen />

  if (pod === 'error') {
    return (
      <Prim.Col alignItems="center" justifyContent="center" flex={1} padding="$4" gap="$3">
        <Prim.Text textAlign="center">{error ?? 'Could not start your workspace.'}</Prim.Text>
        <Prim.Pressable
          onClick={() => setAttempt((n) => n + 1)}
          minHeight="$12"
          paddingHorizontal="$5"
          display="flex"
          alignItems="center"
          justifyContent="center"
          borderRadius="$radius-lg"
          backgroundColor="$muted"
          aria-label="Retry"
        >
          <Prim.Text color="$primary" fontWeight="$semibold">
            Retry
          </Prim.Text>
        </Prim.Pressable>
      </Prim.Col>
    )
  }

  if (pod !== 'ready') {
    return (
      <Prim.Col alignItems="center" justifyContent="center" flex={1} gap="$3">
        {/* A cold-wake can take much of the 120s `waitForPodEdge` budget — bare text alone read
            as a hang, with no way to tell "still working" from "frozen". */}
        <ActivityIndicator />
        <Prim.Text>Starting your workspace…</Prim.Text>
      </Prim.Col>
    )
  }

  return <HomeShell />
}

/**
 * The signed-in app: a Home dashboard, the chat surface and the team workspace.
 *
 * All three are mounted at once and two are hidden, rather than unmounted — `ChatShell` holds a
 * live WebSocket to the pod and a transcript, and `TeamScreen` holds one to the team's pod, so
 * tearing either down every time someone glances at Home would drop a streaming turn mid-sentence
 * and lose whatever arrived while they were away. Hiding costs a little memory; unmounting costs
 * the user's conversation.
 *
 * ## Switching surfaces
 *
 * There is no bottom tab bar. A bar pinned across the foot of the screen is a permanent, immovable
 * slice of a phone's shortest dimension spent on navigation that is used seconds at a time, and it
 * sat UNDER the chat composer — the one control that is used constantly — pushing it up off the
 * keyboard. The three surfaces now live in the SAME drawer as everything else, reached by a
 * hamburger, which is where `@lmthing/ui`'s `SurfaceSwitcher` puts them on web too.
 *
 * Chat already had that drawer (`AppShell`'s mobile sidebar), so it needs nothing here beyond the
 * `onSwitchSurface` callback that turns those pills into pane switches instead of hyperlinks.
 * Home and Teams have no sidebar of their own, so this shell supplies the hamburger and drawer for
 * them — one per pane, never two at once.
 */
function HomeShell() {
  const { getAccessToken } = useAuth()
  const [tab, setTab] = React.useState<NavTab>('home')
  // Mentions waiting in the team, badged on the switcher. The Teams pane stays mounted while
  // hidden, so it keeps hearing the channel socket — without surfacing the count here, a member on
  // Home had no way at all to learn that somebody had named them.
  const [teamMentions, setTeamMentions] = React.useState(0)
  // Which project's app is open, if any. State here rather than a route because native has no URL —
  // the same reason `TeamScreen` owns its rail.
  const [openApp, setOpenApp] = React.useState<{ id: string; name: string } | null>(null)
  const [navOpen, setNavOpen] = React.useState(false)
  // A request to focus a specific team (+ optionally a channel in it) inside `TeamScreen` — a tap
  // on Home's TEAMS/INVITATIONS rows, or a tapped push notification. `TeamScreen` decides whether
  // the request actually names a team the member is on; this shell only carries it.
  const [teamFocus, setTeamFocus] = React.useState<PushDeepLink | null>(null)
  // Bumped on every return from the background, and handed to `DashboardHome` as a `key` — the
  // one way to make it refetch without a reload prop of its own to call (see this fix's report:
  // adding one is a `libs/ui/src/dashboard/DashboardHome.tsx` change, out of this partition).
  // Remounting a HIDDEN pane costs nothing a user can see; it does NOT touch `ChatShell` or
  // `TeamScreen`, which hold live sockets a remount would drop mid-conversation.
  const [homeKey, setHomeKey] = React.useState(0)

  const badges = teamMentions > 0 ? { teams: teamMentions } : undefined

  const switchTo = React.useCallback((surface: NavTab) => {
    setTab(surface)
    setNavOpen(false)
  }, [])

  const openTeam = React.useCallback((target: string | { id: string }, channelId?: string) => {
    const id = typeof target === 'string' ? target : target.id
    setTeamFocus({ teamId: id, channelId })
    setTab('teams')
  }, [])

  // Nothing reacted to the app coming back from the background at all — a stale Home list just
  // sat there until the member happened to remember to pull down (there is no pull-to-refresh
  // either; see this fix's report).
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setHomeKey((k) => k + 1)
    })
    return () => subscription.remove()
  }, [])

  // The gateway deliberately sends `data: { url }` in every push payload so a tap lands in the
  // right place (`cloud/gateway/src/lib/push.ts`), but nothing native-side ever read it — a tap
  // just foregrounded whichever tab was last open. Covers both the cold-start tap (the process
  // did not exist yet to have a listener) and the already-running one; see
  // `./src/push.ts#watchPushDeepLinks`.
  React.useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let cancelled = false
    void watchPushDeepLinks((link) => {
      setTeamFocus(link)
      setTab('teams')
      // A tapped notification is a request to go there NOW — closing whatever full-screen app
      // was covering the tabs, the same way a hardware back press does below.
      setOpenApp(null)
    }).then((unsub) => {
      if (cancelled) unsub()
      else unsubscribe = unsub
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  // Android's back button, for the two things in THIS shell it did nothing for: a full-screen
  // project app (the AppScreen cover below), and — new — stepping from Chat/Teams back to Home
  // instead of exiting the app outright. `Drawer`'s own `onDismiss` already closes `navOpen`
  // (libs/ui), and `AppScreen` (below) wires its own `onClose` — this effect's guard keeps it from
  // ever being registered AT THE SAME TIME as either of those two, rather than relying on Android's
  // LIFO dispatch to sort out three simultaneous listeners. Chat's OWN thread rail (`AppShell`'s
  // mobile sidebar, `libs/ui`) is invisible to this shell, so that case genuinely does rely on
  // LIFO ordering — its listener mounts (and registers) only once that rail opens, strictly AFTER
  // this one, so it is asked first and returns `true` before this "go to Home" fallback ever runs.
  React.useEffect(() => {
    if (openApp || navOpen || tab === 'home') return undefined
    return onDismiss(() => setTab('home'))
  }, [openApp, navOpen, tab])

  // Covers the tabs rather than replacing a pane: an app is a place you go INTO and come back from,
  // and the chat socket behind it should not be torn down to look at one.
  //
  // `AppScreen` decides for itself whether this project renders natively (a `system-appbuilder`
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
      {/* The hamburger for the two panes that have no sidebar of their own to hang one off.
          A row of its OWN rather than absolutely positioned over the pane: `DashboardHome`'s first
          element is the greeting, at the display size, starting hard against the top edge — an
          overlaid button landed on top of the words. A strip costs one row of height; overlapping
          the heading costs the heading. Chat is excluded because `AppShell` already draws its own
          at mobile width, and two would be a duplicate. */}
      {tab === 'home' && (
        <Prim.Row flexShrink={0} alignItems="center" paddingHorizontal="$2" paddingTop="$2">
          <Prim.Pressable
            onClick={() => setNavOpen(true)}
            // 48×48 — Android's stated minimum (and above Apple's 44) rather than the 32×32 this
            // was: a hit-test that small under-shoots BOTH platforms' own guidance, which is a
            // press that lands next to the button often enough to read as "broken", not "small".
            width="$12"
            height="$12"
            display="flex"
            alignItems="center"
            justifyContent="center"
            borderRadius="$radius-lg"
            color="$muted-foreground"
            pressStyle={{ opacity: 0.6 }}
            aria-label="Open navigation"
          >
            <Prim.Text fontSize="$lg">☰</Prim.Text>
          </Prim.Pressable>
        </Prim.Row>
      )}

      <Prim.Box flex={1} flexDirection="column" display={tab === 'home' ? 'flex' : 'none'}>
        <DashboardHome
          // Remounted whenever the app returns to the foreground (see the `AppState` effect
          // above) — `DashboardHome` has no reload prop of its own to call instead.
          key={homeKey}
          onNewChat={() => setTab('chat')}
          onOpenConversation={() => setTab('chat')}
          // `DashboardHome` has always offered this and this app never passed it, so tapping a
          // project on Home did nothing at all — a personal app could not be opened on a phone.
          onOpenProject={(project) => setOpenApp({ id: project.id, name: project.name })}
          // Ditto for a TEAMS row or an INVITATIONS card: `onOpenTeam` defaults to a cross-app
          // browser hand-off (`openTeamsSurface` → `crossAppOrigin('team')`), which resolves to
          // `''` on native (`isWeb()` is false) and silently no-ops. This app CAN open a team —
          // it has its own `TeamScreen` — so it says which one instead of leaving Home to guess.
          onOpenTeam={openTeam}
        />
      </Prim.Box>
      <Prim.Box flex={1} flexDirection="column" display={tab === 'chat' ? 'flex' : 'none'}>
        {/* Chat's own drawer carries the switcher in its footer — see the note above. */}
        <ChatShell onSwitchSurface={switchTo} {...(badges ? { surfaceBadges: badges } : {})} />
      </Prim.Box>
      <Prim.Box flex={1} flexDirection="column" display={tab === 'teams' ? 'flex' : 'none'}>
        <TeamScreen
          onMentionCount={setTeamMentions}
          openTeamId={teamFocus?.teamId}
          openChannelId={teamFocus?.channelId}
          onSwitchSurface={switchTo}
        />
      </Prim.Box>

      {/* `width="$64"` — 256, byte-identical to the `16rem` this was. Not a CSS length: `rem` is
          font-relative and has no native meaning, so it reached Yoga unparsed and the drawer sized
          to content instead of 16rem wide. A `$`-prefixed value is a Tamagui token, resolved by
          the SAME config on both targets — `size['64']` in `libs/css/src/tamagui/tokens.generated.ts`
          is exactly 256, so this is not an approximation. `Drawer.tsx`'s own contract (`width?: string
          | number`, matching this fix) now says so explicitly. */}
      <Drawer open={navOpen} onClose={() => setNavOpen(false)} side="left" width="$64">
        <Prim.Col flex={1} paddingTop="$3">
          <Prim.Box flex={1}>
            <SurfaceSwitcher current={tab} onSwitch={switchTo} {...(badges ? { badges } : {})} />
          </Prim.Box>
          <SignOutRow />
        </Prim.Col>
      </Drawer>
    </Prim.Box>
  )
}

/**
 * Sign out, reachable at all — `DashboardHome`'s ACCOUNT section (`libs/ui`, out of this
 * partition) offers "Delete account" and "Privacy policy" only; there was no way to sign out
 * short of clearing the app's storage from the OS settings. Lives in the nav drawer rather than
 * in Home because that is the one thing in this shell composed from OUTSIDE the shared surfaces
 * (see `HomeShell`'s own doc comment on the divergence budget).
 *
 * Also unregisters this device from push (`unregisterPush` → `POST /api/push/unsubscribe`)
 * BEFORE clearing the session — after `logout()` the access token this needs is gone. Without
 * it a signed-out phone kept its subscription row and went on receiving the account's team
 * notifications the moment anyone else signed into the same device: a privacy bug, not a
 * tidiness one.
 */
function SignOutRow() {
  const { logout, getAccessToken } = useAuth()

  const handlePress = () => {
    Alert.alert('Sign out', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void unregisterPush(getAccessToken).finally(() => logout())
        },
      },
    ])
  }

  return (
    <Prim.Pressable
      onClick={handlePress}
      minHeight="$12"
      paddingHorizontal="$4"
      display="flex"
      flexDirection="row"
      alignItems="center"
      borderTopWidth={1}
      borderColor="$border"
      pressStyle={{ opacity: 0.6 }}
      aria-label="Sign out"
    >
      <Prim.Text color="$destructive" fontWeight="$medium">
        Sign out
      </Prim.Text>
    </Prim.Pressable>
  )
}
