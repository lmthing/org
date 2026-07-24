import * as Prim from '../elements/primitives/index.js';
import { Card, CardHeader, CardBody } from '../elements/content/card'
import { Badge } from '../elements/content/badge'
import { Caption } from '../elements/typography/caption'
import { Heading } from '../elements/typography/heading'

export type RuntimeStatus = 'booting' | 'running' | 'stopped' | 'error'
export type RuntimeTier = 'webcontainer' | 'flyio'

// .computer-status-card__indicator--<status> / __dot--<status> color modifiers → conditional props
// (status-card.styled.tsx proof). The booting dot's `animate-pulse` is a Tailwind builtin (not from
// this component's CSS) so it stays a residual className until the P4 animation driver.
const INDICATOR_COLOR: Record<RuntimeStatus, string> = {
  running: '$success',
  booting: '$warning',
  stopped: '$muted-foreground',
  error: '$destructive',
}
const DOT_BG: Record<RuntimeStatus, string> = {
  running: '$success',
  booting: '$warning',
  stopped: '$muted-foreground',
  error: '$destructive',
}

export interface StatusCardProps {
  status: RuntimeStatus
  tier: RuntimeTier
  uptime: number
}

function formatUptime(ms: number): string {
  if (ms <= 0) return '--'
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

function StatusCard({ status, tier, uptime }: StatusCardProps) {
  return (
    <Card>
      <CardHeader>
        <Heading level={4}>Status</Heading>
      </CardHeader>
      <CardBody>
        <Prim.Box display="flex" flexDirection="column" gap="$2">
          <Prim.Text
            display="inline-flex"
            alignItems="center"
            gap="$1.5"
            fontSize="$sm"
            fontWeight="$medium"
            color={INDICATOR_COLOR[status]}
          >
            <Prim.Text
              width="$2"
              height="$2"
              borderRadius="$radius-full"
              backgroundColor={DOT_BG[status]}
              className={status === 'booting' ? 'animate-pulse' : undefined}
            />
            {status}
          </Prim.Text>
          <Badge variant={tier === 'flyio' ? 'primary' : 'muted'}>
            {tier === 'flyio' ? 'Computer' : 'Free'}
          </Badge>
          <Caption muted>Uptime: {formatUptime(uptime)}</Caption>
        </Prim.Box>
      </CardBody>
    </Card>
  )
}

export { StatusCard }
