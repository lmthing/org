import * as Prim from '../elements/primitives/index.js';
import '@lmthing/css/components/computer/agents-panel.css'
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
        <Prim.Box className="computer-agents-panel">
          {agents.length === 0 ? (
            <Prim.Box className="computer-agents-panel__empty">No agents running</Prim.Box>
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
