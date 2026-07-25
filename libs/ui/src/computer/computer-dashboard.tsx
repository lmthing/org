import * as Prim from '../elements/primitives/index';
import { StatusCard, type RuntimeStatus, type RuntimeTier } from './status-card'
import { MetricsCard } from './metrics-card'
import { ProcessesPanel, type RuntimeProcess } from './processes-panel'
import { AgentsPanel, type RuntimeAgent } from './agents-panel'
import { LogsViewer, type LogEntry } from './logs-viewer'
import { NetworkPanel, type NetworkEntry } from './network-panel'

export interface ComputerDashboardProps {
  status: RuntimeStatus
  tier: RuntimeTier
  uptime: number
  cpuPercent: number | null
  memoryUsedMB: number | null
  memoryTotalMB: number | null
  processes: RuntimeProcess[]
  agents: RuntimeAgent[]
  logs: LogEntry[]
  network: NetworkEntry[]
}

function ComputerDashboard({
  status,
  tier,
  uptime,
  cpuPercent,
  memoryUsedMB,
  memoryTotalMB,
  processes,
  agents,
  logs,
  network,
}: ComputerDashboardProps) {
  return (
    <Prim.Box
      display="grid"
      gridTemplateColumns="repeat(1, minmax(0, 1fr))"
      gap="$4"
      padding="$4"
      $gtSm={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
      $gtLg={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
    >
      <StatusCard status={status} tier={tier} uptime={uptime} />
      <MetricsCard
        cpuPercent={cpuPercent}
        memoryUsedMB={memoryUsedMB}
        memoryTotalMB={memoryTotalMB}
      />
      <ProcessesPanel processes={processes} />
      <AgentsPanel agents={agents} />
      <Prim.Box
        $gtSm={{ gridColumn: 'span 2 / span 2' }}
        $gtLg={{ gridColumn: 'span 3 / span 3' }}
      >
        <LogsViewer logs={logs} />
      </Prim.Box>
      <Prim.Box
        $gtSm={{ gridColumn: 'span 2 / span 2' }}
        $gtLg={{ gridColumn: 'span 3 / span 3' }}
      >
        <NetworkPanel network={network} unavailable={tier === 'webcontainer'} />
      </Prim.Box>
    </Prim.Box>
  )
}

export { ComputerDashboard }
