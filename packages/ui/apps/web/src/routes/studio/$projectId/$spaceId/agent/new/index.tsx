import { createFileRoute } from '@tanstack/react-router'
import { AgentBuilder } from '@lmthing/ui/studio'

export const Route = createFileRoute('/studio/$projectId/$spaceId/agent/new/')({
  component: () => <AgentBuilder />,
})
