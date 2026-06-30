import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useCallback } from 'react'
import { SpaceProvider } from '@lmthing/state'
import { useAuth } from '@lmthing/auth'
import { StudioLayout } from '@lmthing/ui/studio'
import { AgentChatPanel } from '@lmthing/ui/chat'
import { COMPUTER_BASE_URL, CLOUD_BASE_URL } from '@/lib/config'

/** The always-on right-side THING chat (pod-backed `thing` agent). */
function ThingDock() {
  const { getAccessToken } = useAuth()
  const getToken = useCallback(async () => {
    const token = await getAccessToken()
    try {
      await fetch(`${CLOUD_BASE_URL}/api/compute/ensure`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
    } catch {
      /* non-fatal */
    }
    return token
  }, [getAccessToken])

  return (
    <AgentChatPanel
      computeBaseUrl={COMPUTER_BASE_URL}
      getAccessToken={getToken}
      target={{ mode: 'agentOnly', agentSlug: 'thing' }}
      style={{ flex: 1, minHeight: 0 }}
    />
  )
}

function SpaceLayout() {
  const { spaceId } = Route.useParams()

  return (
    <SpaceProvider spaceId={spaceId}>
      <StudioLayout rightPanel={<ThingDock />}>
        <Outlet />
      </StudioLayout>
    </SpaceProvider>
  )
}

export const Route = createFileRoute('/studio/$projectId/$spaceId')({
  component: SpaceLayout,
})
