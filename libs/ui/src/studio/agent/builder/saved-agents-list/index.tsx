import * as Prim from '../../../../elements/primitives/index.js';
import '@lmthing/css/components/agent/builder/index.css'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Card, CardBody, CardFooter } from '@lmthing/ui/elements/content/card'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { PageBody } from '@lmthing/ui/elements/layouts/page'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'

interface KnowledgeField {
  id: string
  name: string
  category?: string
}

interface AgentConfigItem {
  id: string
  name: string
  description: string
  selectedFields: string[]
  enabledTools: string[]
  updatedAt: string
}

interface SavedAgentsListProps {
  fields: KnowledgeField[]
  savedAgents: AgentConfigItem[]
  onLoadAgent?: (agentId: string) => void
  onDuplicateAgent?: (agentId: string) => void
  onDeleteAgent?: (agentId: string) => void
  onNewAgent?: () => void
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return date.toLocaleDateString()
}

function AgentCard({ agent, fields, onLoad, onDuplicate, onDelete }: {
  agent: AgentConfigItem; fields: KnowledgeField[]; onLoad?: () => void; onDuplicate?: () => void; onDelete?: () => void
}) {
  const agentFields = fields.filter(f => agent.selectedFields.includes(f.id))
  return (
    <Card interactive>
      <CardBody>
        <Stack row className="saved-agents-list__card-header">
          <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0}>
            <Label className="saved-agents-list__card-name">{agent.name}</Label>
            <Caption muted className="saved-agents-list__card-description">
              {agent.description}
            </Caption>
          </Prim.Box>
          <Stack row gap="sm">
            <Button onClick={onDuplicate} variant="ghost" size="sm" title="Duplicate">⧉</Button>
            <Button onClick={onDelete} variant="ghost" size="sm" title="Delete">🗑</Button>
          </Stack>
        </Stack>
        <Prim.Box display="flex" flexWrap="wrap" gap="$1.5" marginBottom="$4">
          {agentFields.slice(0, 3).map(field => (
            <Badge key={field.id} variant="muted" className="saved-agents-list__badge-sm">{field.name}</Badge>
          ))}
          {agentFields.length > 3 && (
            <Badge variant="muted" className="saved-agents-list__badge-sm">+{agentFields.length - 3} more</Badge>
          )}
        </Prim.Box>
        <CardFooter className="saved-agents-list__card-footer">
          <Stack row gap="sm">
            <Caption muted>🔧 {agent.enabledTools.length} tools</Caption>
            <Caption muted>🕐 {formatDate(agent.updatedAt)}</Caption>
          </Stack>
          <Button onClick={onLoad} variant="ghost" size="sm">Load →</Button>
        </CardFooter>
      </CardBody>
    </Card>
  )
}

export function SavedAgentsList({ fields, savedAgents, onLoadAgent, onDuplicateAgent, onDeleteAgent, onNewAgent }: SavedAgentsListProps) {
  const sortedAgents = [...savedAgents].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return (
    <PageBody className="saved-agents-list">
      <Stack row className="saved-agents-list__header">
        <Prim.Box>
          <Heading level={2}>Saved Agents</Heading>
          <Caption muted className="saved-agents-list__subtitle">{savedAgents.length} saved agent{savedAgents.length !== 1 ? 's' : ''}</Caption>
        </Prim.Box>
        <Button onClick={onNewAgent} variant="primary">+ New Agent</Button>
      </Stack>

      {savedAgents.length === 0 ? (
        <Stack className="saved-agents-list__empty">
          <Prim.Text marginBottom="$4" fontSize={40}>📦</Prim.Text>
          <Heading level={3}>No saved agents yet</Heading>
          <Caption muted className="saved-agents-list__empty-caption">
            Create your first agent and save it for quick access later.
          </Caption>
        </Stack>
      ) : (
        <Prim.Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(300px, 1fr))" gap="$4">
          {sortedAgents.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              fields={fields}
              onLoad={() => onLoadAgent?.(agent.id)}
              onDuplicate={() => onDuplicateAgent?.(agent.id)}
              onDelete={() => onDeleteAgent?.(agent.id)}
            />
          ))}
        </Prim.Box>
      )}
    </PageBody>
  )
}
