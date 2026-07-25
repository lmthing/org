import * as Prim from '@lmthing/ui/elements/primitives';
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import { useAgentList } from '@lmthing/state'
import { AgentCard } from '@lmthing/ui/studio'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'

export const Route = createFileRoute('/studio/$projectId/$spaceId/agent/')({
  component: AgentListPage,
})

function AgentListPage() {
  const params = useParams({ strict: false }) as {
    projectId?: string; spaceId?: string
  }
  const { projectId, spaceId } = params
  const navigate = useNavigate()
  const agents = useAgentList()

  const spacePath = projectId && spaceId
    ? `/studio/${projectId}/${spaceId}`
    : ''

  return (
    <Prim.Box padding="1.5rem">
      <Stack gap="lg">
        <Stack row justifyContent="space-between" alignItems="center">
          <Prim.Box>
            <Heading level={2}>Agents</Heading>
            <Caption muted>{agents.length} agent{agents.length !== 1 ? 's' : ''}</Caption>
          </Prim.Box>
          <Button
            variant="primary"
            onClick={() => navigate({ to: `${spacePath}/agent/new` })}
          >
            + New Agent
          </Button>
        </Stack>

        {agents.length === 0 ? (
          <Stack alignItems="center" paddingVertical="3rem" paddingHorizontal="0">
            <Caption muted>No agents yet. Create your first agent.</Caption>
          </Stack>
        ) : (
          <Stack gap="sm">
            {agents.map(a => (
              <Prim.Box
                key={a.id}
                cursor="pointer"
                onClick={() => navigate({ to: `${spacePath}/agent/${encodeURIComponent(a.id)}` })}
              >
                <AgentCard id={a.id} />
              </Prim.Box>
            ))}
          </Stack>
        )}
      </Stack>
    </Prim.Box>
  )
}
