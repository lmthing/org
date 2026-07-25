import * as Prim from '@lmthing/ui/elements/primitives';
import { createFileRoute } from '@tanstack/react-router'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'

function ConversationPage() {
  const { agentId, conversationId } = Route.useParams()
  return (
    <Prim.Box padding="2rem">
      <Heading level={2}>Conversation</Heading>
      <Caption muted>
        Agent: {agentId} / Conversation: {conversationId}
      </Caption>
    </Prim.Box>
  )
}

export const Route = createFileRoute(
  '/studio/$projectId/$spaceId/agent/$agentId/chat/$conversationId/',
)({
  component: ConversationPage,
})
