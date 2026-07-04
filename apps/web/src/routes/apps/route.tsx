import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppProvider } from '@lmthing/state'
import { useAuth } from '@lmthing/auth'
import { PodEnsureGate } from '@/lib/gates'
import { COMPUTER_BASE_URL } from '@/lib/config'
import { setPodSessionCookie } from '@/lib/pod-session'

/**
 * `/apps` layout — the end-user **app surface** (lmthing.app). Same shell shape as
 * `/studio`: the shared root provides auth (login), `PodEnsureGate` provisions/awaits
 * the user's compute pod, and `AppProvider` wires the pod base URL + access token so
 * the launcher can list the user's installed apps and open them. (The surface lives at
 * `/apps`, not `/app`, because `/app/<project>/` is proxied to the pod for the app pages.)
 *
 * A project-app is single-user and carries NO auth of its own; the only auth is the
 * platform routing a request to the right pod. Because an app page navigation and its
 * relative assets can't send a Bearer header, we drop the per-user `access_token` as a
 * scoped cookie here (the platform session) so `/app/*` — pages, assets, and the app's own
 * api — all route to this user's pod. Local dev has no gateway and needs none of this.
 */
function AppLayout() {
  const { getAccessTokenSync, refreshAuth } = useAuth()

  useEffect(() => {
    setPodSessionCookie(getAccessTokenSync?.())
  }, [getAccessTokenSync])

  return (
    <PodEnsureGate>
      <AppProvider
        pod={{
          podBaseUrl: COMPUTER_BASE_URL,
          getAccessToken: getAccessTokenSync,
          refresh: refreshAuth,
        }}
      >
        <Outlet />
      </AppProvider>
    </PodEnsureGate>
  )
}

export const Route = createFileRoute('/apps')({
  component: AppLayout,
})
