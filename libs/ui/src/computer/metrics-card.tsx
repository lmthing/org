import * as Prim from '../elements/primitives/index.js';
import { Card, CardHeader, CardBody } from '../elements/content/card'
import { Caption } from '../elements/typography/caption'
import { Heading } from '../elements/typography/heading'

export interface MetricsCardProps {
  cpuPercent: number | null
  memoryUsedMB: number | null
  memoryTotalMB: number | null
}

function MetricsCard({ cpuPercent, memoryUsedMB, memoryTotalMB }: MetricsCardProps) {
  const memPercent = memoryUsedMB != null && memoryTotalMB != null && memoryTotalMB > 0
    ? Math.round((memoryUsedMB / memoryTotalMB) * 100)
    : null

  return (
    <Card>
      <CardHeader>
        <Heading level={4}>Metrics</Heading>
      </CardHeader>
      <CardBody>
        <Prim.Box display="flex" flexDirection="column" gap="$3">
          <Prim.Box display="flex" alignItems="center" justifyContent="space-between">
            <Caption muted>CPU</Caption>
            <Caption>{cpuPercent != null ? `${cpuPercent}%` : 'N/A'}</Caption>
          </Prim.Box>
          {cpuPercent != null && (
            <Prim.Box height="$2" width="100%" borderRadius="$radius-full" backgroundColor="$muted" overflow="hidden">
              <Prim.Box
                height="100%"
                borderRadius="$radius-full"
                backgroundColor="$primary"
                transition="slow" style={{ width: `${cpuPercent}%` }}
              />
            </Prim.Box>
          )}
          <Prim.Box display="flex" alignItems="center" justifyContent="space-between">
            <Caption muted>Memory</Caption>
            <Caption>
              {memoryUsedMB != null
                ? `${memoryUsedMB} MB${memoryTotalMB != null ? ` / ${memoryTotalMB} MB` : ''}`
                : 'N/A'}
            </Caption>
          </Prim.Box>
          {memPercent != null && (
            <Prim.Box height="$2" width="100%" borderRadius="$radius-full" backgroundColor="$muted" overflow="hidden">
              <Prim.Box
                height="100%"
                borderRadius="$radius-full"
                backgroundColor="$primary"
                transition="slow" style={{ width: `${memPercent}%` }}
              />
            </Prim.Box>
          )}
        </Prim.Box>
      </CardBody>
    </Card>
  )
}

export { MetricsCard }
