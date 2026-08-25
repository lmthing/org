import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAuth } from '@lmthing/auth'
import { PodEnsureGate } from '@/lib/gates'
import { setPodSessionCookie } from '@/lib/pod-session'

function ChatLayout() {
  const { getAccessTokenSync } = useAuth()
  // The chat surface now renders a project's app inline (an iframe of the pod's `/app/<project>/`
  // mount — see `AppFrame`). App page navigations and their assets cannot send a Bearer header, so
  // drop the platform-session `access_token` cookie (`path=/`) here, exactly as the `/apps` launcher
  // does, so the framed app's pages/assets/api route to this user's pod. Local dev needs none of it.
  useEffect(() => {
    setPodSessionCookie(getAccessTokenSync?.())
  }, [getAccessTokenSync])

  return (
    <PodEnsureGate>
      <Outlet />
    </PodEnsureGate>
  )
}

export const Route = createFileRoute('/chat')({
  component: ChatLayout,
})
