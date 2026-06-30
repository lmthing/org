import { createFileRoute, Outlet } from '@tanstack/react-router'
import { PodEnsureGate } from '@/lib/gates'

function ChatLayout() {
  return (
    <PodEnsureGate>
      <Outlet />
    </PodEnsureGate>
  )
}

export const Route = createFileRoute('/chat')({
  component: ChatLayout,
})
