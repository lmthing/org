import * as Prim from '../elements/primitives/index.js';
import '@lmthing/css/components/computer/computer-dashboard.css'
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
    <Prim.Box className="computer-dashboard">
      <StatusCard status={status} tier={tier} uptime={uptime} />
      <MetricsCard
        cpuPercent={cpuPercent}
        memoryUsedMB={memoryUsedMB}
        memoryTotalMB={memoryTotalMB}
      />
      <ProcessesPanel processes={processes} />
      <AgentsPanel agents={agents} />
      <Prim.Box className="computer-dashboard__full-width">
        <LogsViewer logs={logs} />
      </Prim.Box>
      <Prim.Box className="computer-dashboard__full-width">
        <NetworkPanel network={network} unavailable={tier === 'webcontainer'} />
      </Prim.Box>
    </Prim.Box>
  )
}

export { ComputerDashboard }
