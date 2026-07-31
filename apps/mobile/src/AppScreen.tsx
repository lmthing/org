import * as React from 'react'
import { ActivityIndicator, Alert, Linking } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as Prim from '@lmthing/ui/elements/primitives'
import { AppView } from '@lmthing/ui/elements/content/app-view'
import { ViewNotFound, ViewRenderer, createViewClient } from '@lmthing/ui/view'
import { apiBase, onDismiss } from '@lmthing/ui/platform'

import { appUrl as personalAppUrl } from './hosts'
import {
  fetchAppTarget,
  initialRoute,
  resolveRoute,
  type AppTarget,
  type AppViews,
} from './app-views'

/**
 * A project's app, full screen.
 *
 * The team surface opens an app in a rail beside the conversation, because there is a conversation
 * to sit beside. A PERSONAL project has no such context — you are opening the app itself — so on a
 * phone it takes the whole screen, with a way back.
 *
 * Until this existed a personal app could not be looked at on a phone AT ALL: `DashboardHome` has
 * always taken an `onOpenProject`, and this app never passed one, so tapping a project on Home did
 * nothing. The web app reaches the same pages through a route; native has no router, so the host
 * owns the state, exactly as it does for the team rail.
 *
 * ## The two kinds of app
 *
 * There are two builders now, and only one of them produces something a phone can render:
 *
 * - `system-appbuilder` produces an esbuild browser bundle. It is WebView-bound forever and it is
 *   the DEFAULT builder, so that path below is unchanged and stays that way.
 * - `system-viewbuilder` produces **view specs** — data. `@lmthing/ui/view` renders them on
 *   `Prim.*`, which means the same source the web bundle runs mounts here as real native views.
 *   No WebView is involved on any page of such an app; that is the single capability the whole
 *   spec pipeline exists to deliver, so the branch is total by construction — the native path has
 *   no fallback INTO a WebView, because a spec that reached the renderer already validated at save
 *   time and a section kind the renderer cannot draw is a renderer bug, not a reason to load a
 *   browser.
 *
 * The pod decides which, by answering `GET /api/apps/:id/views` with specs or with none — see
 * `./app-views.ts`.
 */
export function AppScreen({
  projectId,
  name,
  onClose,
  getToken,
  baseUrl = apiBase(),
  appUrl = personalAppUrl,
  target: decided,
}: {
  projectId: string
  name: string
  onClose: () => void
  /** The pod token. Absolute-URL calls, no cookie or same-origin assumption. */
  getToken: () => Promise<string>
  /** The pod's ROOT (not the app base). Defaults to this device's own pod. */
  baseUrl?: string
  /** Where the app's page BUNDLE is served — the WebView path only. */
  appUrl?: (projectId: string) => string
  /**
   * A decision this host already made. The team surface has to probe before it opens
   * anything, because it chooses between a rail and this screen; passing the answer in
   * saves a second round trip for the same question.
   */
  target?: AppTarget
}) {
  const [target, setTarget] = React.useState<AppTarget | null>(decided ?? null)

  // `Drawer`/`Dialog` (`libs/ui`) already wire the Android back button to their own `onDismiss`,
  // but a full-screen project app had no listener at all — with none claiming the event, the
  // DEFAULT action (background, or exit at the top of the stack) took over, and the only way out
  // was the tiny corner × below. This makes back behave like that × everywhere this screen is
  // reached from (Home's `openApp` cover, `TeamScreen`'s pinned-app screen).
  React.useEffect(() => onDismiss(onClose), [onClose])

  React.useEffect(() => {
    if (decided) {
      setTarget(decided)
      return
    }
    let cancelled = false
    setTarget(null)
    void fetchAppTarget(baseUrl, getToken, projectId).then((t) => {
      if (!cancelled) setTarget(t)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, baseUrl, getToken, decided])

  return (
    <Prim.Col flex={1} minHeight={0}>
      <Prim.Row
        alignItems="center"
        gap="$2"
        paddingHorizontal="$3"
        paddingVertical="$2"
        borderBottomWidth={1}
        borderColor="$border"
        flexShrink={0}
      >
        <Prim.Text fontSize="$sm" fontWeight="$semibold" flex={1} minWidth={0}>
          {name}
        </Prim.Text>
        <Prim.Pressable
          onClick={onClose}
          aria-label="Close app"
          // 16px icon + 16px padding each side = 48×48 — Android's stated minimum (and above
          // Apple's 44) rather than the 24×24 this was (`padding="$1"`, 4px).
          padding="$4"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          {/*
            Drawn from the SVG primitives rather than taken from `elements/primitives/icons`.
            That barrel re-exports `@tamagui/lucide-icons-2`, which is DECLARED in `libs/ui`'s
            package.json and not installed — so on a device the import yields `undefined` and React
            Native fails with "View config getter callback for component `path`". The team surface
            draws its icons this way for the same reason.
          */}
          <Prim.Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <Prim.Path d="M18 6 6 18" />
            <Prim.Path d="m6 6 12 12" />
          </Prim.Svg>
        </Prim.Pressable>
      </Prim.Row>
      {target === null ? (
        <Centered>Opening {name}…</Centered>
      ) : target.kind === 'native' ? (
        <NativeApp app={target.app} projectId={projectId} baseUrl={baseUrl} getToken={getToken} />
      ) : (
        <AppView url={appUrl(projectId)} title={name} />
      )}
    </Prim.Col>
  )
}

/**
 * A viewbuilder app, rendered natively.
 *
 * This host contributes exactly two things, and both are the kind the divergence budget is for:
 *
 *  1. **which page is on screen**, because native has no URL for it to live in. `ViewNavigation`'s
 *     `navigate` hands back a route with its `[param]`s already filled, so the host stores that
 *     literal path and `resolveRoute` matches it back to the spec that owns it.
 *  2. **the platform capabilities the client leaves to its host** — opening a `tel:`/`https:` link,
 *     the clipboard, a confirmation. Each is one line of React Native, and each would otherwise be
 *     a silent no-op on a device.
 *
 * Everything else is `@lmthing/ui/view`'s, which is the point: the web wrapper page renders these
 * same specs with the same renderer and the same client.
 */
function NativeApp({
  app,
  projectId,
  baseUrl,
  getToken,
}: {
  app: AppViews
  projectId: string
  baseUrl: string
  getToken: () => Promise<string>
}) {
  const [path, setPath] = React.useState<string | null>(() => initialRoute(app.views, app.shell))

  const client = React.useMemo(
    () =>
      createViewClient({
        // The APP base, not the pod root: `buildViewRequest` appends `/api<routePath>`, and a
        // project's handlers are served under `/app/<project>/api/*`. Absolute, because a React
        // Native bundle has no origin to be relative to — the same reason `hosts.ts` exists.
        baseUrl: `${baseUrl}/app/${projectId}`,
        getToken,
        endpoints: app.endpoints,
        projectId,
        navigate: setPath,
        openExternal: (href) => {
          void Linking.openURL(href)
        },
        // `.catch` matters here specifically: an unhandled rejection from a fire-and-forget
        // clipboard write (permission denied, no clipboard service on this ROM) would otherwise
        // surface as a red-screen crash unrelated to whatever the member was doing.
        copyToClipboard: (text) =>
          Clipboard.setStringAsync(text)
            .then(() => undefined)
            .catch(() => undefined),
        confirm: (message) =>
          new Promise<boolean>((resolve) => {
            Alert.alert('', message, [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Continue', onPress: () => resolve(true) },
            ])
          }),
      }),
    [app.endpoints, baseUrl, projectId, getToken],
  )

  const routes = React.useMemo(() => app.views.map((v) => v.route), [app.views])
  const resolved = path === null ? null : resolveRoute(app.views, path)

  // Only reachable if a `{ navigate }` names a route no spec owns — which `validateAppViews`
  // rejects at save time. The renderer's own not-found beats a blank screen if one gets through.
  if (!resolved) return <ViewNotFound route={path ?? undefined} />

  return (
    <ViewRenderer
      spec={resolved.spec}
      components={app.components}
      shell={app.shell ?? undefined}
      client={client}
      // The host-routing seam. On web these come from the URL and the generated wrapper; here
      // the host is the only thing that knows them, because there is no URL to hold them.
      route={{ path, params: resolved.params }}
      routes={routes}
    />
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Prim.Col flex={1} alignItems="center" justifyContent="center" padding="$4" gap="$3">
      {/* Deciding native-vs-WebView (`fetchAppTarget`) is one round trip to the pod, not
          instant — bare text alone read as a hang, with no way to tell "still working" from
          "frozen". */}
      <ActivityIndicator />
      <Prim.Text textAlign="center">{children}</Prim.Text>
    </Prim.Col>
  )
}
