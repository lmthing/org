import * as React from 'react'
import { useAuth } from '@lmthing/auth'
import { ChatShell, Drawer } from '@lmthing/ui/chat'
import { DashboardHome } from '@lmthing/ui/dashboard'
import { SurfaceSwitcher, type Surface as NavTab } from '@lmthing/ui/elements/nav/surface-switcher'
import * as Prim from '@lmthing/ui/elements/primitives'
import { onDismiss } from '@lmthing/ui/platform'
import { TeamScreen } from './TeamScreen'
import { AppScreen } from './AppScreen'
import { LocalAccess } from './LocalAccess'
import { WebviewPane } from './WebviewPane'
import { SplitPane } from './SplitPane'
import { DesktopHostBridge, type HostBridgeState } from './host-bridge'
import { onMenuToggleBrowser } from './desktop'

/**
 * The signed-in app: a Home dashboard, the chat surface and the team workspace.
 *
 * All three are mounted at once and two are hidden, rather than unmounted. `ChatShell` holds a live
 * WebSocket to the pod and a transcript, and `TeamScreen` holds one to the team's pod, so tearing
 * either down every time someone glances at Home would drop a streaming turn mid-sentence and lose
 * whatever arrived while they were away. Hiding costs a little memory; unmounting costs the
 * person's conversation.
 *
 * Surfaces are switched from the same drawer `@lmthing/ui`'s `SurfaceSwitcher` puts them in on
 * every other target. There is no separate desktop navigation chrome, deliberately: a third
 * navigation idiom is a third thing to keep in sync with two that already agree.
 */
export function HomeShell() {
  const { getAccessToken } = useAuth()
  const [tab, setTab] = React.useState<NavTab>('home')
  // The desktop's own panes, outside `SurfaceSwitcher`'s three: they are properties of THIS
  // COMPUTER rather than surfaces of the product, and the shared switcher must not learn about
  // targets the other two hosts do not have.
  const [localOpen, setLocalOpen] = React.useState(false)
  const [browserOpen, setBrowserOpen] = React.useState(false)

  // One bridge for the app's lifetime, connected as soon as somebody is signed in.
  //
  // It used to wait for the browser pane to be opened, on the reasoning that a cloud agent reaching
  // this machine should follow from a deliberate act. That reasoning produced a dead end: an agent
  // asked for a browser, the pod had no desktop attached, and it told the person to INSTALL the app
  // they were already using — because the only thing that would have connected it was opening the
  // pane by hand, which is the very thing they were asking the agent to do.
  //
  // The deliberate act is signing in. What the bridge can actually reach is bounded elsewhere and
  // stays bounded: the grant list is the filesystem boundary and is empty until a folder is named,
  // so a connected bridge with no grants reaches no files at all, and a browser request opens the
  // pane VISIBLY rather than driving something nobody can see. Disconnect remains the kill switch
  // and is remembered.
  const bridge = React.useMemo(() => new DesktopHostBridge(getAccessToken), [getAccessToken])
  React.useEffect(() => {
    bridge.start({ implied: true })
    return () => bridge.stop()
  }, [bridge])
  const [bridgeStatus, setBridgeStatus] = React.useState<HostBridgeState['status']>('idle')
  React.useEffect(() => bridge.subscribe((s) => setBridgeStatus(s.status)), [bridge])
  const [teamMentions, setTeamMentions] = React.useState(0)
  // Which project's app is open, if any. State rather than a route: this shell has no router, for
  // the same reason `TeamScreen` owns its rail.
  const [openApp, setOpenApp] = React.useState<{ id: string; name: string } | null>(null)
  const [navOpen, setNavOpen] = React.useState(false)
  const [teamFocus, setTeamFocus] = React.useState<{ teamId: string; channelId?: string } | null>(
    null,
  )
  // Bumped whenever the window becomes visible again, and handed to `DashboardHome` as a `key` —
  // the one way to make it refetch, since it has no reload prop of its own. Remounting a HIDDEN
  // pane costs nothing anyone can see, and it does NOT touch `ChatShell` or `TeamScreen`, which
  // hold live sockets a remount would drop mid-conversation.
  const [homeKey, setHomeKey] = React.useState(0)

  const badges = teamMentions > 0 ? { teams: teamMentions } : undefined

  // Switching surfaces LEAVES the browser open. It sits beside the surfaces rather than instead of
  // them, so closing it on every switch would undo the thing the split is for: watching a page
  // while you talk about it.
  const switchTo = React.useCallback((surface: NavTab) => {
    setTab(surface)
    setNavOpen(false)
  }, [])

  const openTeam = React.useCallback((target: string | { id: string }, channelId?: string) => {
    const id = typeof target === 'string' ? target : target.id
    setTeamFocus({ teamId: id, ...(channelId ? { channelId } : {}) })
    setTab('teams')
  }, [])

  // View → Browser (⌘/Ctrl-B). The menu bar is present on every surface, unlike the ☰ button,
  // which only renders on Home — so this is the one control that can open the pane from anywhere.
  React.useEffect(() => onMenuToggleBrowser(() => setBrowserOpen((open) => !open)), [])

  // The same shortcut, handled in the page as well as by the menu.
  //
  // Belt and braces, because the two paths fail in different places: the menu accelerator is a GTK
  // window accelerator and depends on which widget holds the keyboard, while this one depends only
  // on the app's document having focus. Between them, Ctrl-B works wherever a person is likely to
  // press it — and the failure it fixes was one-directional and therefore easy to miss: the pane
  // opened and then would not close.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setBrowserOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /**
   * Opening the browser attaches this desktop to the workspace.
   *
   * Without it the browser runs and the person watches it, and the agent cannot reach it at all —
   * the pod has nowhere to send a browser operation, so it answers "no LMThing desktop is connected
   * to this workspace" and the model then explains, reasonably and uselessly, how to start a
   * headless browser on a server. The two halves of the feature looked independent and are not:
   * a browser an agent cannot see is not what the pane is for.
   *
   * This does NOT widen what can be read from disk. The grant list is the filesystem boundary and
   * it is empty until the person points it at a folder; connecting with no grants reaches nothing.
   * And it is `implied`, so it cannot undo a deliberate Disconnect.
   */
  /**
   * An agent asked for the browser before the person opened it.
   *
   * The pane opens, visibly. Giving an agent a page it was asked for is right; giving it one in a
   * view nobody can see is the single thing this whole design exists to prevent — so the request
   * comes through the shell, which owns the split, rather than an offscreen webview being created
   * behind everyone's back.
   */
  React.useEffect(() => {
    const open = () => setBrowserOpen(true)
    window.addEventListener('lmthing://open-browser', open)
    return () => window.removeEventListener('lmthing://open-browser', open)
  }, [])

  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setHomeKey((k) => k + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Escape, for the two things in THIS shell it should close: a full-window project app, and
  // stepping from Chat/Teams back to Home. The guard keeps this from ever being registered at the
  // same time as `Drawer`'s own dismiss handler or the app cover's, rather than relying on listener
  // ordering to sort out three at once. (`onDismiss` is the same seam the phone's hardware back
  // button uses — one shared idea, two hosts.)
  React.useEffect(() => {
    if (openApp || navOpen) return undefined
    if (browserOpen) return onDismiss(() => setBrowserOpen(false))
    if (tab === 'home') return undefined
    return onDismiss(() => setTab('home'))
  }, [openApp, navOpen, tab, browserOpen])

  if (openApp) {
    return <AppScreen projectId={openApp.id} name={openApp.name} onClose={() => setOpenApp(null)} />
  }

  if (localOpen) {
    return (
      <Prim.Col flex={1} minHeight={0}>
        <Prim.Row flexShrink={0} alignItems="center" paddingHorizontal="$3" paddingVertical="$2" borderBottomWidth={1} borderColor="$border">
          <Prim.Pressable
            onClick={() => setLocalOpen(false)}
            minHeight="$8"
            paddingHorizontal="$3"
            display="flex"
            alignItems="center"
            justifyContent="center"
            borderRadius="$radius-md"
            aria-label="Close local access"
          >
            <Prim.Text color="$primary">← Back</Prim.Text>
          </Prim.Pressable>
        </Prim.Row>
        <LocalAccess bridge={bridge} />
      </Prim.Col>
    )
  }

  return (
    // `display` and `height` are both load-bearing. `Box` renders `display: block` by default, so
    // without them `flexDirection` styles nothing, every child's `flex: 1` resolves against a
    // zero-height parent, and the shell collapses. The three shared surfaces did not show it
    // because each carries its own height internally — the browser pane, which is a raw element
    // sized by its container, does. See `reference-layout-collapse-invisible-to-gates`: nothing in
    // the gate set can see a zero-height container.
    <Prim.Box flex={1} display="flex" height="100%" flexDirection="column" minHeight={0}>
      {/* The hamburger for the pane that has no sidebar of its own to hang one off. Chat is
          excluded because `AppShell` draws its own, and two would be a duplicate; Teams gets its
          nav from `TeamChannelsView`. A row of its own rather than absolutely positioned, because
          `DashboardHome`'s first element is the greeting at display size, starting hard against the
          top edge — an overlaid button lands on top of the words. */}
      {tab === 'home' && (
        <Prim.Row flexShrink={0} alignItems="center" paddingHorizontal="$2" paddingTop="$2">
          <Prim.Pressable
            onClick={() => setNavOpen(true)}
            width="$10"
            height="$10"
            display="flex"
            alignItems="center"
            justifyContent="center"
            borderRadius="$radius-lg"
            color="$muted-foreground"
            hoverStyle={{ backgroundColor: '$muted' }}
            aria-label="Open navigation"
          >
            <Prim.Text fontSize="$lg">☰</Prim.Text>
          </Prim.Pressable>
        </Prim.Row>
      )}

      <SplitPane splitOpen={browserOpen} right={
        <WebviewPane visible={browserOpen && !navOpen} />
      } left={<>
      <Prim.Box flex={1} flexDirection="column" minHeight={0} display={tab === 'home' ? 'flex' : 'none'}>
        <DashboardHome
          key={homeKey}
          onNewChat={() => setTab('chat')}
          onOpenConversation={() => setTab('chat')}
          onOpenProject={(project) => setOpenApp({ id: project.id, name: project.name })}
          // `onOpenTeam` defaults to a cross-app browser hand-off, which would send someone out of
          // the app to a website. This shell CAN open a team — it has `TeamScreen` — so it says which.
          onOpenTeam={openTeam}
        />
      </Prim.Box>
      <Prim.Box flex={1} flexDirection="column" minHeight={0} display={tab === 'chat' ? 'flex' : 'none'}>
        <ChatShell onSwitchSurface={switchTo} {...(badges ? { surfaceBadges: badges } : {})} />
      </Prim.Box>
      <Prim.Box flex={1} flexDirection="column" minHeight={0} display={tab === 'teams' ? 'flex' : 'none'}>
        <TeamScreen
          onMentionCount={setTeamMentions}
          openTeamId={teamFocus?.teamId}
          openChannelId={teamFocus?.channelId}
          onSwitchSurface={switchTo}
        />
      </Prim.Box>
      </>} />

      <Drawer open={navOpen} onClose={() => setNavOpen(false)} side="left" width="$64">
        <Prim.Col flex={1} paddingTop="$3">
          <Prim.Box flex={1}>
            <SurfaceSwitcher current={tab} onSwitch={switchTo} {...(badges ? { badges } : {})} />
          </Prim.Box>
          <DrawerRow
            label={browserOpen ? 'Close the browser' : 'Browser'}
            onPress={() => {
              setBrowserOpen((open) => !open)
              setNavOpen(false)
            }}
          />
          <DrawerRow
            label="Local access"
            onPress={() => {
              setLocalOpen(true)
              setNavOpen(false)
            }}
          />
          <SignOutRow />
        </Prim.Col>
      </Drawer>
    </Prim.Box>
  )
}

/** A drawer entry for something that is NOT one of the three shared surfaces. */
function DrawerRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Prim.Pressable
      onClick={onPress}
      minHeight="$10"
      paddingHorizontal="$4"
      display="flex"
      flexDirection="row"
      alignItems="center"
      borderTopWidth={1}
      borderColor="$border"
      hoverStyle={{ opacity: 0.7 }}
      aria-label={label}
    >
      <Prim.Text fontWeight="$medium">{label}</Prim.Text>
    </Prim.Pressable>
  )
}

/**
 * Sign out, reachable at all — `DashboardHome`'s ACCOUNT section offers "Delete account" and
 * "Privacy policy" only. Lives in the nav drawer rather than in Home because it is the one thing in
 * this shell composed from outside the shared surfaces.
 */
function SignOutRow() {
  const { logout } = useAuth()
  return (
    <Prim.Pressable
      onClick={logout}
      minHeight="$10"
      paddingHorizontal="$4"
      display="flex"
      flexDirection="row"
      alignItems="center"
      borderTopWidth={1}
      borderColor="$border"
      hoverStyle={{ opacity: 0.7 }}
      aria-label="Sign out"
    >
      <Prim.Text color="$destructive" fontWeight="$medium">
        Sign out
      </Prim.Text>
    </Prim.Pressable>
  )
}
