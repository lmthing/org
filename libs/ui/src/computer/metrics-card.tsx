import * as Prim from '../elements/primitives/index.js';
import '@lmthing/css/components/computer/metrics-card.css'
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
        <Prim.Box className="computer-metrics-card">
          <Prim.Box className="computer-metrics-card__row">
            <Caption muted>CPU</Caption>
            <Caption>{cpuPercent != null ? `${cpuPercent}%` : 'N/A'}</Caption>
          </Prim.Box>
          {cpuPercent != null && (
            <Prim.Box className="computer-metrics-card__bar">
              <Prim.Box className="computer-metrics-card__bar-fill" style={{ width: `${cpuPercent}%` }} />
            </Prim.Box>
          )}
          <Prim.Box className="computer-metrics-card__row">
            <Caption muted>Memory</Caption>
            <Caption>
              {memoryUsedMB != null
                ? `${memoryUsedMB} MB${memoryTotalMB != null ? ` / ${memoryTotalMB} MB` : ''}`
                : 'N/A'}
            </Caption>
          </Prim.Box>
          {memPercent != null && (
            <Prim.Box className="computer-metrics-card__bar">
              <Prim.Box className="computer-metrics-card__bar-fill" style={{ width: `${memPercent}%` }} />
            </Prim.Box>
          )}
        </Prim.Box>
      </CardBody>
    </Card>
  )
}

export { MetricsCard }
