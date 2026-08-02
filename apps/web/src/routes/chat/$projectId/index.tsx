import { createFileRoute, useParams } from '@tanstack/react-router'
import { ChatRouteShell } from '../-shell'

/** `/chat/<project>` — a project is open, no conversation is. A real state, not a redirect stop. */
function ChatProject() {
  const { projectId } = useParams({ from: '/chat/$projectId/' })
  return <ChatRouteShell projectId={projectId} />
}

export const Route = createFileRoute('/chat/$projectId/')({
  component: ChatProject,
})
