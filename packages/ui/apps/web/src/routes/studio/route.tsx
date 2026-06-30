import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AppProvider } from '@lmthing/state'
import { useAuth } from '@lmthing/auth'
import { PodEnsureGate } from '@/lib/gates'
import { COMPUTER_BASE_URL } from '@/lib/config'

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
