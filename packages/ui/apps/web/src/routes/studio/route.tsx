import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AppProvider } from '@lmthing/state'
import { useAuth } from '@lmthing/auth'
import { PodEnsureGate } from '@/lib/gates'

// Compute pod REST API origin. Studio keeps the JWT and calls the pod API
// directly (unlike chat, it does NOT full-route to the pod's served UI).
const COMPUTER_BASE_URL =
  import.meta.env.VITE_COMPUTER_BASE_URL ??
  (import.meta.env.DEV ? 'https://computer.test' : window.location.origin)

/**
 * `/studio` layout — studio-specific providers (pod readiness + AppProvider)
 * wrapping the studio subtree. Auth + pin are provided by the shared root.
 */
function StudioLayout() {
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

export const Route = createFileRoute('/studio')({
  component: StudioLayout,
})
