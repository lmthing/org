import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useProjects } from '@lmthing/state'
import { buildProjectPath } from '@lmthing/ui/lib/space-path'

/**
 * Studio landing: redirect straight into the default (`user`) project so the
 * shared sidebar opens with a project already selected. Falls back to the first
 * available project.
 */
function StudioIndex() {
  const navigate = useNavigate()
  const { projects, isLoading } = useProjects()

  useEffect(() => {
    if (isLoading || projects.length === 0) return
    const def = projects.find((p) => p.id === 'user') ?? projects[0]
    navigate({ to: buildProjectPath(def.id), replace: true })
  }, [projects, isLoading, navigate])

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  )
}

export const Route = createFileRoute('/studio/')({
  component: StudioIndex,
})
