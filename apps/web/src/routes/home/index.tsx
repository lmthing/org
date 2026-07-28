import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { DashboardHome } from '@lmthing/ui/dashboard'

/**
 * `/home` — the same dashboard `apps/mobile` lands on, from the same source.
 *
 * Navigation is the one thing the surface does NOT own (see `DashboardHomeProps`), so it is supplied
 * here as real router pushes. On mobile the same props switch a tab instead; the component itself
 * cannot tell the difference, which is what keeps it one screen rather than two.
 */
function HomePage() {
  const navigate = useNavigate()
  return (
    <DashboardHome
      onNewChat={() => void navigate({ to: '/chat' })}
      onOpenConversation={() => void navigate({ to: '/chat' })}
      onOpenProject={(project) => void navigate({ to: '/studio/$projectId', params: { projectId: project.id } })}
    />
  )
}

export const Route = createFileRoute('/home/')({
  component: HomePage,
})
