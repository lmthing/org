import type {
  ComputerRuntime,
  RuntimeTier,
  RuntimeStatus,
  RuntimeMetrics,
  RuntimeProcess,
  RuntimeAgent,
  LogEntry,
  NetworkEntry,
  TerminalSession,
} from './types'
import type { ServerMessage } from './ws-protocol'
import { PodConnection } from './pod-connection'

type Listener<T> = (value: T) => void

let sessionCounter = 0

export interface PodRuntimeOptions {
  /** Base URL of lmthing.computer (e.g. "https://lmthing.computer") */
  computerBaseUrl: string
  /** Returns a live access token (JWT), refreshing first if near expiry.
   *  Envoy validates this at the edge. The getter is called on every
   *  (re)connection so the long-lived WebSocket always uses a fresh token. */
  getAccessToken: () => Promise<string>
}

/**
 * PodRuntime connects to a dedicated K8s compute pod via lmthing.computer.
 * Envoy Gateway handles JWT validation and routes /api/* to the user's pod.
 * Uses the same WebSocket protocol (ws-protocol.ts). Connection lifecycle
 * (open/auth/reconnect-with-backoff) lives in pod-connection.ts; this class
 * owns the public API and dispatches decoded server messages to listeners.
 */
export class PodRuntime implements ComputerRuntime {
  readonly tier: RuntimeTier = 'pod'
  private _status: RuntimeStatus = 'stopped'
  private readonly connection: PodConnection

  private statusListeners = new Set<Listener<RuntimeStatus>>()
  private metricsListeners = new Set<Listener<RuntimeMetrics>>()
  private processListeners = new Set<Listener<RuntimeProcess[]>>()
  private agentListeners = new Set<Listener<RuntimeAgent[]>>()
  private logListeners = new Set<Listener<LogEntry>>()
  private networkListeners = new Set<Listener<NetworkEntry>>()

  private terminalDataListeners = new Map<string, Set<Listener<string>>>()

  constructor(options: PodRuntimeOptions) {
    this.connection = new PodConnection(options, {
      getStatus: () => this._status,
      setStatus: (status) => this.setStatus(status),
      emitLog: (level, source, message) => this.emitLog(level, source, message),
      onOpen: () => {
        this.connection.send({
          type: 'subscribe',
          channels: ['metrics', 'processes', 'agents', 'logs', 'network'],
        })
      },
      onMessage: (msg) => this.handleMessage(msg),
    })
  }

  get status(): RuntimeStatus {
    return this._status
  }

  private setStatus(status: RuntimeStatus) {
    this._status = status
    for (const cb of this.statusListeners) cb(status)
  }

  async boot(): Promise<void> {
    if (this._status === 'running' || this._status === 'booting') return

    this.connection.reset()
    this.setStatus('booting')

    try {
      await this.connection.connect()
    } catch (err) {
      this.setStatus('error')
      this.emitLog('error', 'runtime', `Boot failed: ${err}`)
      throw err
    }
  }

  async shutdown(): Promise<void> {
    this.connection.close(1000, 'shutdown')
    this.setStatus('stopped')
  }

  async createTerminalSession(command?: string): Promise<TerminalSession> {
    if (!this.connection.isOpen()) {
      throw new Error('Not connected to compute pod')
    }

    const id = `pod-session-${++sessionCounter}`
    const dataListeners = new Set<Listener<string>>()
    this.terminalDataListeners.set(id, dataListeners)

    this.connection.send({ type: 'terminal.open', sessionId: id, ...(command ? { command } : {}) })

    return {
      id,
      write: (data: string) => {
        this.connection.send({ type: 'terminal.input', sessionId: id, data })
      },
      onData: (cb: Listener<string>) => {
        dataListeners.add(cb)
        return () => { dataListeners.delete(cb) }
      },
      resize: (cols: number, rows: number) => {
        this.connection.send({ type: 'terminal.resize', sessionId: id, cols, rows })
      },
      dispose: () => {
        this.connection.send({ type: 'terminal.close', sessionId: id })
        dataListeners.clear()
        this.terminalDataListeners.delete(id)
      },
    }
  }

  onStatusChange(cb: Listener<RuntimeStatus>) {
    this.statusListeners.add(cb)
    return () => { this.statusListeners.delete(cb) }
  }

  onMetrics(cb: Listener<RuntimeMetrics>) {
    this.metricsListeners.add(cb)
    return () => { this.metricsListeners.delete(cb) }
  }

  onProcessList(cb: Listener<RuntimeProcess[]>) {
    this.processListeners.add(cb)
    return () => { this.processListeners.delete(cb) }
  }

  onAgentList(cb: Listener<RuntimeAgent[]>) {
    this.agentListeners.add(cb)
    return () => { this.agentListeners.delete(cb) }
  }

  onLog(cb: Listener<LogEntry>) {
    this.logListeners.add(cb)
    return () => { this.logListeners.delete(cb) }
  }

  onNetwork(cb: Listener<NetworkEntry>) {
    this.networkListeners.add(cb)
    return () => { this.networkListeners.delete(cb) }
  }

  // --- Private ---

  /** Dispatches decoded server messages (excluding the auth handshake,
   *  which PodConnection handles itself) to the registered listeners. */
  private handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'terminal.data': {
        const listeners = this.terminalDataListeners.get(msg.sessionId)
        if (listeners) {
          for (const cb of listeners) cb(msg.data)
        }
        break
      }

      case 'terminal.opened':
        break

      case 'metrics':
        for (const cb of this.metricsListeners) {
          cb({
            cpuPercent: msg.cpuPercent,
            memoryUsedMB: msg.memoryUsedMB,
            memoryTotalMB: msg.memoryTotalMB,
          })
        }
        break

      case 'processes':
        for (const cb of this.processListeners) cb(msg.processes)
        break

      case 'agents':
        for (const cb of this.agentListeners) cb(msg.agents)
        break

      case 'log':
        for (const cb of this.logListeners) {
          cb({
            timestamp: msg.timestamp,
            level: msg.level,
            source: msg.source,
            message: msg.message,
          })
        }
        break

      case 'network':
        for (const cb of this.networkListeners) {
          cb({
            id: msg.id,
            timestamp: msg.timestamp,
            method: msg.method,
            url: msg.url,
            status: msg.status,
            durationMs: msg.durationMs,
            sizeBytes: msg.sizeBytes,
          })
        }
        break

      case 'error':
        this.emitLog('error', 'server', msg.message)
        break
    }
  }

  private emitLog(level: LogEntry['level'], source: string, message: string) {
    const entry: LogEntry = { timestamp: Date.now(), level, source, message }
    for (const cb of this.logListeners) cb(entry)
  }
}
