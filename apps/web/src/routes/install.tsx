import * as Prim from '@lmthing/ui/elements/primitives';
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { COMPUTER_BASE_URL, APP_PATH_PREFIX } from '@/lib/config'
import { setPodSessionCookie } from '@/lib/pod-session'

/**
 * lmthing.app **install page** — the authenticated landing the public store
 * redirects to. The store site can't reach a user's pod (public,
 * unauthenticated); this page is served by the static app shell on lmthing.app,
 * so it runs in the user's signed-in context and POSTs the install to the pod's
 * own endpoint with the user's Bearer token.
 *
 * Two kinds of catalog entry install here:
 *  - `?appId=<id>`   — a project-app (`POST /api/apps/install`), then opens the app.
 *  - `?spaceId=<id>` — an integration space (`POST /api/store/spaces/install`) into
 *    a project the user picks, then points them to that project's Settings →
 *    Integrations in Studio to add tokens (integrations have no app page to open).
 *
 * It lives at the TOP level (`/install`), not under `/app/*`, because on lmthing.app
 * the gateway proxies `/app/*` straight to the pod — only `/` (this static shell)
 * can serve a page that self-authenticates and calls the pod.
 */
export const Route = createFileRoute('/install')({
  validateSearch: (search: Record<string, unknown>): { appId: string; spaceId: string } => ({
    appId: typeof search.appId === 'string' ? search.appId : '',
    spaceId: typeof search.spaceId === 'string' ? search.spaceId : '',
  }),
  // Runs during routing, BEFORE the auth gate renders the login screen — so an
  // unauthenticated arrival (store → install → sign in) still records the intent.
  // The SSO callback returns to `/` (callbackPath), where the root waiter reads this
  // and forwards back here once login completes.
  beforeLoad: ({ search }) => {
    if (typeof window !== 'undefined') {
      try {
        if (search.appId) sessionStorage.setItem('lmthing_pending_install', search.appId)
        if (search.spaceId) sessionStorage.setItem('lmthing_pending_install_space', search.spaceId)
      } catch {
        /* ignore */
      }
    }
  },
  component: InstallPage,
})

type InstalledInfo = {
  projectId?: string
  installed?: { tables?: string[]; pages?: string[]; endpoints?: string[]; hooks?: string[] }
  diverged?: boolean
  message?: string
}

type State =
  | { status: 'installing' }
  | { status: 'done'; info: InstalledInfo }
  // The app is already installed with local edits that diverge from the store
  // template. The pod held the install back (`ok:false, diverged:true`) rather
  // than clobber the edits — we surface an explicit "upgrade & replace" choice
  // that re-runs the install with `force:true`.
  | { status: 'diverged'; info: InstalledInfo }
  | { status: 'error'; message: string }

/**
 * Classify the pod's install response into the UI state. Kept a pure, exported
 * function (no DOM/network) so the install-vs-upgrade branching is unit-testable.
 * The pod returns HTTP 200 with `{ ok:false, diverged:true }` when the destination
 * has local edits — that is NOT an error, it's the "offer an upgrade" signal, so it
 * must not fall through to the error branch. Shared by the app + space flows (both
 * pod endpoints return the same `{ ok } | { ok:false, diverged }` shape).
 */
export function classifyInstallResponse(
  httpOk: boolean,
  httpStatus: number,
  body: (InstalledInfo & { ok?: boolean }) | null,
): State {
  if (httpOk && body?.ok) return { status: 'done', info: body }
  if (httpOk && body?.diverged) return { status: 'diverged', info: body }
  return { status: 'error', message: body?.message ?? `Install failed (HTTP ${httpStatus}).` }
}

/** Studio origin for a "configure in Studio" hand-off, resolved from the current
 *  host (prod lmthing.app → lmthing.studio; the `*.test` proxy → studio.test;
 *  localhost single-serve → same origin, which serves the studio route too). */
function studioSettingsUrl(projectId: string): string {
  if (typeof window === 'undefined') return `/studio/${encodeURIComponent(projectId)}/settings`
  const { hostname, origin } = window.location
  const base =
    hostname === 'lmthing.app'
      ? 'https://lmthing.studio'
      : hostname.endsWith('.test')
        ? 'https://studio.test'
        : origin
  return `${base}/studio/${encodeURIComponent(projectId)}/settings`
}

function InstallPage() {
  const { appId, spaceId } = Route.useSearch()
  if (spaceId) return <SpaceInstall spaceId={spaceId} />
  return <AppInstall appId={appId} />
}

// ── Project-app install (unchanged behaviour) ────────────────────────────────

function AppInstall({ appId }: { appId: string }) {
  const { getAccessToken } = useAuth()
  const [state, setState] = useState<State>({ status: 'installing' })

  // `force` re-runs the install past a divergence guard, replacing the app's files
  // with the current store template (used by the "Upgrade & replace files" action).
  const runInstall = useCallback(
    async (force = false) => {
      if (!appId) {
        setState({ status: 'error', message: 'No app was specified (missing ?appId=).' })
        return
      }
      setState({ status: 'installing' })
      try {
        const token = await getAccessToken()
        const res = await fetch(`${COMPUTER_BASE_URL}/api/apps/install`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ appId, force }),
        })
        const body = (await res.json().catch(() => null)) as (InstalledInfo & { ok?: boolean }) | null
        setState(classifyInstallResponse(res.ok, res.status, body))
      } catch (err) {
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    },
    [appId, getAccessToken],
  )

  // The user arrives here to install — kick it off automatically.
  useEffect(() => {
    void runInstall()
  }, [runInstall])

  async function openApp(projectId: string) {
    // Single-user app, no app auth — just set the platform-session cookie so the pod-served
    // pages + assets route to this user's pod (no-op / unneeded in local dev).
    setPodSessionCookie(await getAccessToken())
    window.location.href = `${COMPUTER_BASE_URL}${APP_PATH_PREFIX}/${encodeURIComponent(projectId)}/`
  }

  return (
    <Prim.Box marginHorizontal="auto" display="flex" height="100%" width="100%" maxWidth={576} flexDirection="column" gap="$6" padding="$8">
      <Prim.Box as="header" display="flex" flexDirection="column" gap="$1">
        <Prim.Text as="h1" fontSize="$2xl" fontWeight="$semibold" color="$foreground">
          Install {appId ? <Prim.Text fontFamily="$mono">{appId}</Prim.Text> : 'app'}
        </Prim.Text>
        <Prim.Text as="p" fontSize="$sm" color="$muted-foreground">Adding this app to your workspace.</Prim.Text>
      </Prim.Box>

      {state.status === 'installing' && (
        <Prim.Box borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$card" padding="$6" fontSize="$sm" color="$muted-foreground">
          Installing <Prim.Text fontFamily="$mono" color="$foreground">{appId}</Prim.Text> to your pod…
        </Prim.Box>
      )}

      {state.status === 'done' && (
        <Prim.Box display="flex" flexDirection="column" gap="$4" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$card" padding="$6">
          <Prim.Box fontSize="$sm" color="$foreground">
            Installed <Prim.Text fontFamily="$mono">{appId}</Prim.Text>
            {state.info.installed && (
              <Prim.Text color="$muted-foreground">
                {' '}
                — {state.info.installed.tables?.length ?? 0} table(s),{' '}
                {state.info.installed.endpoints?.length ?? 0} endpoint(s),{' '}
                {state.info.installed.pages?.length ?? 0} page(s).
              </Prim.Text>
            )}
          </Prim.Box>
          <Prim.Pressable
            type="button"
            onClick={() => openApp(state.info.projectId ?? appId)}
            width="fit-content" borderRadius="$radius-md" backgroundColor="$primary" paddingHorizontal="$4" paddingVertical="$2" fontSize="$sm" fontWeight="$medium" color="$primary-foreground" hoverStyle={{ opacity: 0.9 }}
          >
            Open app
          </Prim.Pressable>
        </Prim.Box>
      )}

      {state.status === 'diverged' && (
        <Prim.Box display="flex" flexDirection="column" gap="$4" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$card" padding="$6">
          <Prim.Box fontSize="$sm" color="$foreground">
            <Prim.Text fontFamily="$mono">{appId}</Prim.Text> is already installed and has local changes.
            Upgrading replaces its app files (pages, API, hooks, database schema and spaces) with the
            latest version from the store. Your saved data is kept.
          </Prim.Box>
          <Prim.Box display="flex" flexWrap="wrap" gap="$3">
            <Prim.Pressable
              type="button"
              onClick={() => void runInstall(true)}
              width="fit-content" borderRadius="$radius-md" backgroundColor="$primary" paddingHorizontal="$4" paddingVertical="$2" fontSize="$sm" fontWeight="$medium" color="$primary-foreground" hoverStyle={{ opacity: 0.9 }}
            >
              Upgrade &amp; replace files
            </Prim.Pressable>
            <Prim.Pressable
              type="button"
              onClick={() => openApp(state.info.projectId ?? appId)}
              width="fit-content" borderRadius="$radius-md" borderWidth={1} borderColor="$border" paddingHorizontal="$4" paddingVertical="$2" fontSize="$sm" fontWeight="$medium" color="$foreground" hoverStyle={{ backgroundColor: "$muted" }}
            >
              Keep my version &amp; open
            </Prim.Pressable>
          </Prim.Box>
        </Prim.Box>
      )}

      {state.status === 'error' && (
        <Prim.Box display="flex" flexDirection="column" gap="$4" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$card" padding="$6">
          <Prim.Text as="p" fontSize="$sm" color="$destructive">{state.message}</Prim.Text>
          <Prim.Pressable
            type="button"
            onClick={() => void runInstall()}
            width="fit-content" borderRadius="$radius-md" borderWidth={1} borderColor="$border" paddingHorizontal="$4" paddingVertical="$2" fontSize="$sm" fontWeight="$medium" color="$foreground" hoverStyle={{ backgroundColor: "$muted" }}
          >
            Try again
          </Prim.Pressable>
        </Prim.Box>
      )}
    </Prim.Box>
  )
}

// ── Integration-space install (pick a project, then configure in Studio) ─────

type ProjectMeta = { id: string; name?: string }

function SpaceInstall({ spaceId }: { spaceId: string }) {
  // `authFetch` attaches a FRESH token (refreshing if needed) and retries a waking
  // pod — a plain `getAccessToken()` can hand over a stale token → 401.
  const { authFetch, isAuthenticated } = useAuth()
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null)
  const [projectId, setProjectId] = useState('user')
  const [state, setState] = useState<State | { status: 'choose' }>({ status: 'choose' })

  // Load the user's projects for the target picker (default `user`, the project
  // THING chats under so an installed integration is reachable by THING). `user`
  // always exists as the scaffolded default, so fall back to it if the list can't
  // be read — the picker must never be empty.
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    void (async () => {
      try {
        const res = await authFetch(`${COMPUTER_BASE_URL}/api/projects`)
        const body = (await res.json().catch(() => null)) as { projects?: ProjectMeta[] } | ProjectMeta[] | null
        const list = Array.isArray(body) ? body : (body?.projects ?? [])
        const installable = list.filter((p) => p.id !== 'system')
        if (cancelled) return
        const usable = installable.length > 0 ? installable : [{ id: 'user' }]
        setProjects(usable)
        setProjectId(usable.some((p) => p.id === 'user') ? 'user' : usable[0]!.id)
      } catch {
        if (!cancelled) {
          setProjects([{ id: 'user' }])
          setProjectId('user')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authFetch, isAuthenticated])

  const runInstall = useCallback(
    async (force = false) => {
      setState({ status: 'installing' })
      try {
        const res = await authFetch(`${COMPUTER_BASE_URL}/api/store/spaces/install`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ spaceId, projectId, force }),
        })
        const body = (await res.json().catch(() => null)) as (InstalledInfo & { ok?: boolean }) | null
        setState(classifyInstallResponse(res.ok, res.status, { ...body, projectId } as InstalledInfo & { ok?: boolean }))
      } catch (err) {
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    },
    [spaceId, projectId, authFetch],
  )

  function configure(pid: string) {
    window.location.href = studioSettingsUrl(pid)
  }

  return (
    <Prim.Box marginHorizontal="auto" display="flex" height="100%" width="100%" maxWidth={576} flexDirection="column" gap="$6" padding="$8">
      <Prim.Box as="header" display="flex" flexDirection="column" gap="$1">
        <Prim.Text as="h1" fontSize="$2xl" fontWeight="$semibold" color="$foreground">
          Install <Prim.Text fontFamily="$mono">{spaceId}</Prim.Text>
        </Prim.Text>
        <Prim.Text as="p" fontSize="$sm" color="$muted-foreground">
          Add this integration to a project. You&apos;ll add your own token afterwards in the project&apos;s settings.
        </Prim.Text>
      </Prim.Box>

      {state.status === 'choose' && (
        <Prim.Box display="flex" flexDirection="column" gap="$4" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$card" padding="$6">
          <Prim.Text as="label" display="flex" flexDirection="column" gap="$1.5" fontSize="$sm" color="$foreground">
            Install into project
            <Prim.Select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={projects === null}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {(projects ?? []).map((p) => (
                <Prim.Option key={p.id} value={p.id}>
                  {p.name ?? p.id}
                  {p.id === 'user' ? ' (used by THING)' : ''}
                </Prim.Option>
              ))}
            </Prim.Select>
          </Prim.Text>
          <Prim.Pressable
            type="button"
            onClick={() => void runInstall()}
            disabled={projects === null || !projectId}
            width="fit-content" borderRadius="$radius-md" backgroundColor="$primary" paddingHorizontal="$4" paddingVertical="$2" fontSize="$sm" fontWeight="$medium" color="$primary-foreground" hoverStyle={{ opacity: 0.9 }} disabledStyle={{ opacity: 0.5 }}
          >
            {projects === null ? 'Loading projects…' : 'Install'}
          </Prim.Pressable>
        </Prim.Box>
      )}

      {state.status === 'installing' && (
        <Prim.Box borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$card" padding="$6" fontSize="$sm" color="$muted-foreground">
          Installing <Prim.Text fontFamily="$mono" color="$foreground">{spaceId}</Prim.Text> into{' '}
          <Prim.Text fontFamily="$mono" color="$foreground">{projectId}</Prim.Text>…
        </Prim.Box>
      )}

      {state.status === 'done' && (
        <Prim.Box display="flex" flexDirection="column" gap="$4" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$card" padding="$6">
          <Prim.Box fontSize="$sm" color="$foreground">
            Installed <Prim.Text fontFamily="$mono">{spaceId}</Prim.Text> into{' '}
            <Prim.Text fontFamily="$mono">{state.info.projectId ?? projectId}</Prim.Text>. Add your token in the
            project&apos;s Settings → Integrations to finish.
          </Prim.Box>
          <Prim.Pressable
            type="button"
            onClick={() => configure(state.info.projectId ?? projectId)}
            width="fit-content" borderRadius="$radius-md" backgroundColor="$primary" paddingHorizontal="$4" paddingVertical="$2" fontSize="$sm" fontWeight="$medium" color="$primary-foreground" hoverStyle={{ opacity: 0.9 }}
          >
            Add your token in Studio
          </Prim.Pressable>
        </Prim.Box>
      )}

      {state.status === 'diverged' && (
        <Prim.Box display="flex" flexDirection="column" gap="$4" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$card" padding="$6">
          <Prim.Box fontSize="$sm" color="$foreground">
            <Prim.Text fontFamily="$mono">{spaceId}</Prim.Text> is already installed in{' '}
            <Prim.Text fontFamily="$mono">{projectId}</Prim.Text> with local changes. Reinstalling replaces its files
            with the latest version from the store.
          </Prim.Box>
          <Prim.Box display="flex" flexWrap="wrap" gap="$3">
            <Prim.Pressable
              type="button"
              onClick={() => void runInstall(true)}
              width="fit-content" borderRadius="$radius-md" backgroundColor="$primary" paddingHorizontal="$4" paddingVertical="$2" fontSize="$sm" fontWeight="$medium" color="$primary-foreground" hoverStyle={{ opacity: 0.9 }}
            >
              Reinstall &amp; replace files
            </Prim.Pressable>
            <Prim.Pressable
              type="button"
              onClick={() => configure(projectId)}
              width="fit-content" borderRadius="$radius-md" borderWidth={1} borderColor="$border" paddingHorizontal="$4" paddingVertical="$2" fontSize="$sm" fontWeight="$medium" color="$foreground" hoverStyle={{ backgroundColor: "$muted" }}
            >
              Keep my version &amp; configure
            </Prim.Pressable>
          </Prim.Box>
        </Prim.Box>
      )}

      {state.status === 'error' && (
        <Prim.Box display="flex" flexDirection="column" gap="$4" borderRadius="$radius-lg" borderWidth={1} borderColor="$border" backgroundColor="$card" padding="$6">
          <Prim.Text as="p" fontSize="$sm" color="$destructive">{state.message}</Prim.Text>
          <Prim.Pressable
            type="button"
            onClick={() => void runInstall()}
            width="fit-content" borderRadius="$radius-md" borderWidth={1} borderColor="$border" paddingHorizontal="$4" paddingVertical="$2" fontSize="$sm" fontWeight="$medium" color="$foreground" hoverStyle={{ backgroundColor: "$muted" }}
          >
            Try again
          </Prim.Pressable>
        </Prim.Box>
      )}
    </Prim.Box>
  )
}
