import * as Prim from '../elements/primitives/index.js';
import '@lmthing/css/components/computer/network-panel.css'
import { Panel, PanelHeader, PanelBody } from '../elements/content/panel'
import { Badge } from '../elements/content/badge'
import { Caption } from '../elements/typography/caption'
import { Heading } from '../elements/typography/heading'
import { cn } from '../lib/utils'

export interface NetworkEntry {
  id: string
  timestamp: number
  method: string
  url: string
  status: number | null
  durationMs: number | null
  sizeBytes: number | null
}

export interface NetworkPanelProps {
  network: NetworkEntry[]
  unavailable?: boolean
}

function NetworkPanel({ network, unavailable }: NetworkPanelProps) {
  return (
    <Panel>
      <PanelHeader>
        <Heading level={4}>Network</Heading>
        <Caption muted>{network.length} requests</Caption>
      </PanelHeader>
      <PanelBody>
        <Prim.Box className="computer-network-panel">
          {unavailable ? (
            <Prim.Box className="computer-network-panel__empty">Not available on free tier</Prim.Box>
          ) : network.length === 0 ? (
            <Prim.Box className="computer-network-panel__empty">No requests</Prim.Box>
          ) : (
            network.map((entry) => (
              <Prim.Box key={entry.id} className="computer-network-panel__entry">
                <Prim.Text className="computer-network-panel__method">{entry.method}</Prim.Text>
                <Prim.Text className="computer-network-panel__url">{entry.url}</Prim.Text>
                {entry.status != null && (
                  <Badge variant={entry.status < 400 ? 'success' : 'default'}>
                    <Prim.Text className={cn(
                      entry.status < 400 && 'computer-network-panel__status--ok',
                      entry.status >= 400 && 'computer-network-panel__status--error',
                    )}>
                      {entry.status}
                    </Prim.Text>
                  </Badge>
                )}
                {entry.durationMs != null && (
                  <Caption muted>{entry.durationMs}ms</Caption>
                )}
              </Prim.Box>
            ))
          )}
        </Prim.Box>
      </PanelBody>
    </Panel>
  )
}

export { NetworkPanel }
