import { createFileRoute } from '@tanstack/react-router'
import { ProjectsLayout } from '@lmthing/ui/studio'

export const Route = createFileRoute('/studio/')({
  component: () => <ProjectsLayout />,
})
