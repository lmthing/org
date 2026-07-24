import * as Prim from '../elements/primitives/index.js';
import { Panel, PanelHeader, PanelBody } from '../elements/content/panel'
import { ListItem } from '../elements/content/list-item'
import { Badge } from '../elements/content/badge'
import { Heading } from '../elements/typography/heading'
import { Caption } from '../elements/typography/caption'

export interface RuntimeAgent {
  id: string
  name: string
  status: 'idle' | 'running' | 'error'
  spaceId?: string
}

export interface AgentsPanelProps {
  agents: RuntimeAgent[]
}

function AgentsPanel({ agents }: AgentsPanelProps) {
  return (
    <Panel>
      <PanelHeader>
        <Heading level={4}>Agents</Heading>
        <Caption muted>{agents.length} active</Caption>
      </PanelHeader>
      <PanelBody>
        <Prim.Box display="flex" flexDirection="column" gap="$1">
          {agents.length === 0 ? (
            <Prim.Text
              fontSize="$sm"
              color="$muted-foreground"
              paddingVertical="$4"
              textAlign="center"
            >
              No agents running
            </Prim.Text>
          ) : (
            agents.map((agent) => (
              <ListItem
                key={agent.id}
                label={agent.name}
                meta={
                  <Badge variant={agent.status === 'running' ? 'success' : agent.status === 'error' ? 'default' : 'muted'}>
                    {agent.status}
                  </Badge>
                }
              />
            ))
          )}
        </Prim.Box>
      </PanelBody>
    </Panel>
  )
}

export { AgentsPanel }
