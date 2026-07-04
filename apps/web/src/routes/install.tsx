import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@lmthing/auth'
import { COMPUTER_BASE_URL } from '@/lib/config'

/**
 * lmthing.app **install page** — the authenticated landing the public store
 * (`lmthing.store/projects/<appId>` → "Install to my pod") redirects to. The
 * store site can't reach a user's pod (public, unauthenticated); this page is
 * served by the static app shell on lmthing.app, so it runs in the user's signed-in
 * context and POSTs the install to the pod's own `/api/apps/install` with the user's
 * Bearer token (validated by the gateway `/api/*` route → per-user pod), then opens
 * the freshly-installed app at `/app/<project>/`.
 *
 * It lives at the TOP level (`/install`), not under `/app/*`, because on lmthing.app
 * the gateway proxies `/app/*` straight to the pod — only `/` (this static shell)
 * can serve a page that self-authenticates and calls the pod.
 */
export const Route = createFileRoute('/install')({
  validateSearch: (search: Record<string, unknown>): { appId: string } => ({
    appId: typeof search.appId === 'string' ? search.appId : '',
  }),
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
  | { status: 'error'; message: string }

function InstallPage() {
  const { appId } = Route.useSearch()
  const { getAccessToken } = useAuth()
  const [state, setState] = useState<State>({ status: 'installing' })

  const runInstall = useCallback(async () => {
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
        body: JSON.stringify({ appId }),
      })
      const body = (await res.json().catch(() => null)) as (InstalledInfo & { ok?: boolean }) | null
      if (!res.ok || !body?.ok) {
        setState({ status: 'error', message: body?.message ?? `Install failed (HTTP ${res.status}).` })
        return
      }
      setState({ status: 'done', info: body })
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [appId, getAccessToken])

  // The user arrives here to install — kick it off automatically.
  useEffect(() => {
    void runInstall()
  }, [runInstall])

  function openApp(projectId: string) {
    window.location.href = `${COMPUTER_BASE_URL}/app/${encodeURIComponent(projectId)}/`
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">
          Install {appId ? <span className="font-mono">{appId}</span> : 'app'}
        </h1>
        <p className="text-sm text-muted-foreground">Adding this app to your workspace.</p>
      </header>

      {state.status === 'installing' && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Installing <span className="font-mono text-foreground">{appId}</span> to your pod…
        </div>
      )}

      {state.status === 'done' && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
          <div className="text-sm text-foreground">
            {state.info.diverged ? (
              <>
                <span className="font-mono">{appId}</span> is already installed with local changes — kept
                as-is. Open it below.
              </>
            ) : (
              <>
                Installed <span className="font-mono">{appId}</span>
                {state.info.installed && (
                  <span className="text-muted-foreground">
                    {' '}
                    — {state.info.installed.tables?.length ?? 0} table(s),{' '}
                    {state.info.installed.endpoints?.length ?? 0} endpoint(s),{' '}
                    {state.info.installed.pages?.length ?? 0} page(s).
                  </span>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => openApp(state.info.projectId ?? appId)}
            className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Open app
          </button>
        </div>
      )}

      {state.status === 'error' && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-destructive">{state.message}</p>
          <button
            type="button"
            onClick={() => void runInstall()}
            className="w-fit rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
