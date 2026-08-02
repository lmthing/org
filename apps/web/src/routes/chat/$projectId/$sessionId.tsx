import { createFileRoute, useParams } from '@tanstack/react-router'
import { ChatRouteShell } from '../-shell'

/**
 * `/chat/<project>/<conversation>` — an open conversation, addressable.
 *
 * The id is stable across a resume: `POST /api/sessions {resumeSessionId}` hands back the SAME id
 * whether the session is already live or is being rehydrated from its snapshot
 * (`libs/cli/src/server/session-manager.ts`), which is what makes this link worth sharing.
 */
function ChatConversation() {
  const { projectId, sessionId } = useParams({ from: '/chat/$projectId/$sessionId' })
  return <ChatRouteShell projectId={projectId} sessionId={sessionId} />
}

export const Route = createFileRoute('/chat/$projectId/$sessionId')({
  component: ChatConversation,
})
