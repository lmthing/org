import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AppProvider } from '@lmthing/state'
import { useAuth } from '@lmthing/auth'
import { PodEnsureGate } from '@/lib/gates'
import { COMPUTER_BASE_URL } from '@/lib/config'

/**
 * `/apps` layout — the end-user **app surface** (lmthing.app). Same shell shape as
 * `/studio`: the shared root provides auth (login), `PodEnsureGate` provisions/awaits
 * the user's compute pod, and `AppProvider` wires the pod base URL + access token so
 * the launcher can list the user's installed apps and open them. (The surface lives at
 * `/apps`, not `/app`, because `/app/<project>/` is proxied to the pod for the app pages.)
 */
function AppLayout() {
  const { getAccessTokenSync, refreshAuth } = useAuth()
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
