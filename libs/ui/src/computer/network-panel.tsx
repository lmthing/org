import * as Prim from '../elements/primitives/index';
import { Panel, PanelHeader, PanelBody } from '../elements/content/panel'
import { Badge } from '../elements/content/badge'
import { Caption } from '../elements/typography/caption'
import { Heading } from '../elements/typography/heading'

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
        <Prim.Box display="flex" flexDirection="column" gap="$1">
          {unavailable ? (
            <Prim.Text fontSize="$sm" color="$muted-foreground" paddingVertical="$4" textAlign="center">Not available on free tier</Prim.Text>
          ) : network.length === 0 ? (
            <Prim.Text fontSize="$sm" color="$muted-foreground" paddingVertical="$4" textAlign="center">No requests</Prim.Text>
          ) : (
            network.map((entry) => (
              <Prim.Box key={entry.id} display="flex" alignItems="center" gap="$3" fontSize="$sm">
                <Prim.Text fontFamily="monospace" fontSize="$xs" fontWeight="$medium" flexShrink={0} width="$12">{entry.method}</Prim.Text>
                <Prim.Text overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" flexGrow={1} flexShrink={1} flexBasis="0%">{entry.url}</Prim.Text>
                {entry.status != null && (
                  <Badge variant={entry.status < 400 ? 'success' : 'default'}>
                    <Prim.Text color={entry.status < 400 ? '$success' : '$destructive'}>
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
