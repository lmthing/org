import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
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
 * the launcher can list the user's installed apps and open them. (The SPA route stays
 * `/apps`, never `/app`: `/app/<project>/` is the pod's app mount on localhost, and on
 * lmthing.app the browser shows this surface at a clean `/` via the prefixed history.)
 *
 * A project-app is single-user and carries NO auth of its own; the only auth is the
 * platform routing a request to the right pod. Because an app page navigation and its
 * relative assets can't send a Bearer header, we drop the per-user `access_token` as a
 * `path=/` cookie here (the platform session) so the app pages, assets, and the app's own
 * api — at `/<project>/…` in prod, `/app/<project>/…` on localhost — all route to this
 * user's pod. Local dev has no gateway and needs none of this.
 */
function AppLayout() {
  const { getAccessTokenSync, refreshAuth, isAuthenticated } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    setPodSessionCookie(getAccessTokenSync?.())
  }, [getAccessTokenSync])

  // Resume a pending install captured before login (store → /install → sign in). On
  // lmthing.app the SSO callback returns to `/` which the prefixed history routes to this
  // surface (internal `/apps`), NOT the index `/` route — so the resume that lives there
  // (for non-prefixed hosts) never runs here. Re-check once auth settles and forward.
  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return
    const pending = sessionStorage.getItem('lmthing_pending_install')
    if (!pending) return
    sessionStorage.removeItem('lmthing_pending_install')
    void navigate({ to: '/install', search: { appId: pending }, replace: true })
  }, [isAuthenticated, navigate])

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
