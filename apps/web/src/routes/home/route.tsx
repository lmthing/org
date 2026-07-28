import { createFileRoute, Outlet } from '@tanstack/react-router'
import { PodEnsureGate } from '@/lib/gates'

/**
 * Home reads projects and conversations from the pod, so it needs the same wake-and-wait gate the
 * chat surface does. Teams come from the gateway and would resolve without it, but a dashboard that
 * painted its teams and then sat empty for twenty seconds waiting on a cold pod would look broken.
 */
function HomeLayout() {
  return (
    <PodEnsureGate>
      <Outlet />
    </PodEnsureGate>
  )
}

export const Route = createFileRoute('/home')({
  component: HomeLayout,
})
