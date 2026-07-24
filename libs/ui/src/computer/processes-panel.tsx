import * as Prim from '../elements/primitives/index.js';
import { Panel, PanelHeader, PanelBody } from '../elements/content/panel'
import { ListItem } from '../elements/content/list-item'
import { Caption } from '../elements/typography/caption'
import { Heading } from '../elements/typography/heading'

export interface RuntimeProcess {
  pid: number
  command: string
  cpu: number | null
  memoryMB: number | null
}

export interface ProcessesPanelProps {
  processes: RuntimeProcess[]
}

function ProcessesPanel({ processes }: ProcessesPanelProps) {
  return (
    <Panel>
      <PanelHeader>
        <Heading level={4}>Processes</Heading>
        <Caption muted>{processes.length} running</Caption>
      </PanelHeader>
      <PanelBody>
        <Prim.Box display="flex" flexDirection="column" gap="$1">
          {processes.length === 0 ? (
            <Prim.Text
              fontSize="$sm"
              color="$muted-foreground"
              paddingVertical="$4"
              textAlign="center"
            >
              No processes
            </Prim.Text>
          ) : (
            processes.map((proc) => (
              <ListItem
                key={proc.pid}
                label={proc.command}
                meta={<Caption muted>PID {proc.pid}</Caption>}
              />
            ))
          )}
        </Prim.Box>
      </PanelBody>
    </Panel>
  )
}

export { ProcessesPanel }
