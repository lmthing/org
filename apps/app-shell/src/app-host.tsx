/**
 * `AppHost` — fetch a project's view-spec payload and render it via the shared
 * `ViewRenderer`.
 *
 * This is the web port of the mobile `NativeApp` (`apps/mobile/src/AppScreen.tsx`): the
 * model writes TypeScript one statement at a time and the host evaluates each, but here the
 * "which page is on screen" fact lives in `window.location` (History API) instead of a piece
 * of React state, and the platform capabilities (`navigate`/`openExternal`/`clipboard`/…)
 * are the browser's own rather than React Native's.
 *
 * ## What the host contributes
 *
 * Exactly what the mobile host does, plus the URL:
 *
 *  1. **which page is on screen** — `ViewNavigation.navigate` hands back a route with its
 *     `[param]`s filled; the host pushes it onto History and the pure matcher picks the spec
 *     that owns it on the next render.
 *  2. **the app base + project id** — derived once from `/app/:projectId/*` in the URL.
 *  3. **`navigate`** — the one host capability `createViewClient` does NOT default (routing
 *     belongs to the host's router; guessing would break a SPA's history).
 *
 * Everything else — `openExternal`, `copyToClipboard`, `confirm`, `print`, `saveFile` — has
 * a browser default inside `createViewClient` (`libs/ui/src/view/client.ts`), so the SAME
 * spec behaves the same on web as it does on native. No host shims are needed for those.
 */

import * as React from 'react'
import {
  ViewNotFound,
  ViewRenderer,
  ViewThemeProvider,
  createViewClient,
} from '@lmthing/ui/view'
import { matchRoutes, type RoutePattern } from '@lmthing/ui/view/router'
import type { ViewClient, ViewSpec } from '@lmthing/ui/view'

import { NAV_EVENT, clientPath, navigate, projectIdFromLocation, resolveAppBase, toHref, toRoutePattern } from './router'
import { fetchAppViews, pickInitialRoute, type AppViews } from './payload'

/** One entry of the host's route table: a spec plus its pattern in the matcher's grammar. */
interface SpecRoute extends RoutePattern {
  spec: ViewSpec
}

/**
 * Module-level payload cache, keyed by project id. The project id is a RUNTIME route param
 * and is stable for the app's lifetime (navigating to a different project is a full reload),
 * so this is one entry in practice — but keying by id means a re-mount (dev StrictMode,
 * HMR) does NOT refetch, and the requirement "fetch ONCE, cache by projectId" holds even
 * across boundary resets.
 */
const payloadCache = new Map<string, AppViews>()

/** The same-origin pod root. AppHost is served BY the pod, so calls are relative + cookie-authed. */
const POD_ROOT = ''

export function AppHost() {
  // projectId + appBase are derived ONCE — the URL prefix does not change without a reload.
  const initial = React.useMemo(() => {
    const pathname = window.location.pathname
    const projectId = projectIdFromLocation(pathname)
    const appBase = resolveAppBase(pathname)
    return { projectId, appBase }
  }, [])

  const [payload, setPayload] = React.useState<AppViews | null>(null)
  const [error, setError] = React.useState<Error | null>(null)
  const [path, setPath] = React.useState<string>(() => window.location.pathname)

  // Fetch ONCE per project id (cached). A missing project id is a configuration error.
  React.useEffect(() => {
    if (!initial.projectId) {
      setError(new Error('No project id in this URL — expected /app/<projectId>/.'))
      return
    }
    const cached = payloadCache.get(initial.projectId)
    if (cached) {
      setPayload(cached)
      return
    }
    let cancelled = false
    setPayload(null)
    setError(null)
    fetchAppViews(initial.projectId, POD_ROOT)
      .then((app) => {
        if (cancelled) return
        payloadCache.set(initial.projectId!, app)
        setPayload(app)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
      })
    return () => {
      cancelled = true
    }
  }, [initial.projectId])

  // Subscribe to History navigation (back/forward via popstate; in-app via the custom event).
  React.useEffect(() => {
    const onNav = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onNav)
    window.addEventListener(NAV_EVENT, onNav)
    return () => {
      window.removeEventListener('popstate', onNav)
      window.removeEventListener(NAV_EVENT, onNav)
    }
  }, [])

  const routeTable = React.useMemo<SpecRoute[]>(
    () => (payload ? payload.views.map((v) => ({ routePath: toRoutePattern(v.route), spec: v })) : []),
    [payload],
  )

  const cp = clientPath(path)

  // When the user lands at the bare app base (client path `/`), redirect to the landing page
  // — mirroring the mobile host's `initialRoute`. `replaceState` (not `pushState`) so no
  // back-button trap is left: the URL reflects the page without adding a history entry.
  React.useEffect(() => {
    if (!payload || cp !== '/') return
    const initialRoute = pickInitialRoute(payload.views, payload.shell)
    if (initialRoute) {
      // Re-apply the mount prefix so a root landing does not navigate outside this app.
      window.history.replaceState({}, '', toHref('/' + initialRoute))
      setPath(window.location.pathname)
    }
  }, [payload, cp])

  const match = React.useMemo(
    () => (cp === '/' ? null : matchRoutes(routeTable, cp)),
    [routeTable, cp],
  )

  // The data client. `navigate` is the one host capability createViewClient leaves to the
  // host; `credentials: 'include'` carries the pod's session cookie on every endpoint call.
  const client = React.useMemo<ViewClient | null>(() => {
    if (!payload || !initial.projectId) return null
    return createViewClient({
      baseUrl: initial.appBase,
      endpoints: payload.endpoints,
      navigate,
      projectId: initial.projectId,
      credentials: 'include',
    })
  }, [payload, initial.appBase, initial.projectId])

  if (error) return <ErrorView message={error.message} />
  if (!initial.projectId) return <ErrorView message="No project id in this URL — expected /app/<projectId>/." />
  if (!payload || !client) return <LoadingView />

  const routes = payload.views.map((v) => v.route)

  return (
    <ViewThemeProvider>
      {match ? (
        <PageErrorBoundary key={cp}>
          <ViewRenderer
            spec={match.entry.spec}
            components={payload.components}
            shell={payload.shell ?? undefined}
            layouts={payload.layouts}
            routes={routes}
            client={client}
            route={{ path: cp, params: match.params }}
          />
        </PageErrorBoundary>
      ) : (
        <ViewNotFound route={cp} />
      )}
    </ViewThemeProvider>
  )
}

/**
 * Contain a page's render crash to THAT page — the same boundary the cli's `@app/runtime`
 * carries (`libs/cli/src/app/runtime/router.tsx#PageErrorBoundary`).
 *
 * A spec page is data-bound to a live, drifting database, so one will eventually hit a null
 * it did not expect. Without a boundary React unmounts the whole tree: every route 200s, the
 * data API is fine, and the user gets a blank page for the ENTIRE app. Wrapping the page (not
 * the shell) means the crash costs only that page's body; navigating away and back resets it
 * (`key={cp}`), which is enough to retry.
 */
class PageErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override componentDidCatch(error: Error): void {
    console.error('[app-shell] page render failed:', error)
  }

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return <ErrorView message={this.state.error.message || String(this.state.error)} />
  }
}

/** A clear, never-silent failure surface. Design-system tokens only (no raw colors). */
function ErrorView({ message }: { message: string }) {
  return (
    <div style={{ padding: 24, color: 'var(--foreground)', maxWidth: 560, margin: '0 auto' }}>
      <p style={{ fontWeight: 600, marginBottom: 8 }}>This app could not be displayed.</p>
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: 'var(--muted-foreground)',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 13,
          background: 'var(--muted)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 12,
        }}
      >
        {message}
      </pre>
    </div>
  )
}

/** The deciding state — `fetchAppViews` is one round trip, not instant. */
function LoadingView() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--muted-foreground)',
      }}
    >
      Opening app…
    </div>
  )
}
