import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAuth } from '@lmthing/auth'
import { PodEnsureGate } from '@/lib/gates'
import { setPodSessionCookie } from '@/lib/pod-session'

function ChatLayout() {
  const { getAccessTokenSync } = useAuth()
  // The chat surface's data calls carry a Bearer header, but dropping the platform-session
  // `access_token` cookie (`path=/`) here too — exactly as the former `/apps` launcher did — keeps
  // any same-origin sub-request (an app page opened from another surface, a served asset) routed to
  // this user's pod. Local dev needs none of it.
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
