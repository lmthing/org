import { createFileRoute } from '@tanstack/react-router'
import { useProjects } from '@lmthing/state'
import { useAuth } from '@lmthing/auth'
import { COMPUTER_BASE_URL } from '@/lib/config'

/**
 * lmthing.app landing — the user's **app launcher**. Lists the projects installed
 * in their pod and opens the pod-served app at `/app/<project>/`. Auth is exactly
 * like studio/chat: the app opens with the `access_token` query param (the same way
 * chat opens its authenticated WS), which the gateway `/app/*` route validates and
 * routes to this user's pod. No special-case auth for apps.
 */
function AppLauncher() {
  const { projects, isLoading } = useProjects()
  const { getAccessTokenSync } = useAuth()

  function openApp(id: string) {
    const token = getAccessTokenSync?.()
    const q = token ? `?access_token=${encodeURIComponent(token)}` : ''
    window.open(`${COMPUTER_BASE_URL}/app/${encodeURIComponent(id)}/${q}`, '_blank', 'noopener')
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Your apps</h1>
        <p className="text-sm text-muted-foreground">
          Open an app installed in your workspace, or browse the{' '}
          <a href="https://lmthing.store/apps" className="text-primary underline">
            app store
          </a>{' '}
          to install more.
        </p>
      </header>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading your apps…</div>
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No apps yet. Install one from the{' '}
          <a href="https://lmthing.store/apps" className="text-primary underline">
            app store
          </a>
          .
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => openApp(p.id)}
                className="flex w-full flex-col gap-1 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-muted"
              >
                <span className="font-medium text-foreground">{p.title ?? p.id}</span>
                <span className="font-mono text-xs text-muted-foreground">/app/{p.id}/</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const Route = createFileRoute('/app/')({
  component: AppLauncher,
})
