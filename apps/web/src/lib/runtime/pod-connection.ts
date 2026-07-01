import type { ClientMessage, ServerMessage } from './ws-protocol'
import { encodeMessage, decodeMessage } from './ws-protocol'
import type { RuntimeStatus, LogEntry } from './types'

const MAX_RETRIES = 5
const BASE_DELAY_MS = 1000

export interface PodConnectionOptions {
  /** Base URL of lmthing.computer (e.g. "https://lmthing.computer") */
  computerBaseUrl: string
  /** Returns a live access token (JWT), refreshing first if near expiry.
   *  Envoy validates this at the edge. The getter is called on every
   *  (re)connection so the long-lived WebSocket always uses a fresh token. */
  getAccessToken: () => Promise<string>
}

export interface PodConnectionCallbacks {
  /** Current runtime status, used to distinguish a boot-time close from a mid-session drop. */
  getStatus: () => RuntimeStatus
  setStatus: (status: RuntimeStatus) => void
  emitLog: (level: LogEntry['level'], source: string, message: string) => void
  /** Fired once the socket is open, before the auth handshake completes. */
  onOpen: () => void
  /** All server messages except the auth handshake (auth.ok/auth.fail), which
   *  this class handles itself to drive the connect() promise and reconnects. */
  onMessage: (msg: ServerMessage) => void
}

/**
 * Owns the raw WebSocket lifecycle for PodRuntime: connecting with a fresh
 * token, the auth handshake, and exponential-backoff reconnection. Message
 * *interpretation* beyond the auth handshake is delegated back to the
 * runtime via `callbacks.onMessage`.
 */
export class PodConnection {
  private ws: WebSocket | null = null
  private retryCount = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  private readonly options: PodConnectionOptions
  private readonly callbacks: PodConnectionCallbacks

  constructor(options: PodConnectionOptions, callbacks: PodConnectionCallbacks) {
    this.options = options
    this.callbacks = callbacks
  }

  /** True while the underlying WebSocket is open and ready to send. */
  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /** Clears the disposed flag and retry counter ahead of a fresh boot. */
  reset() {
    this.disposed = false
    this.retryCount = 0
  }

  async connect(): Promise<void> {
    // Fetch a fresh token on every (re)connection — access tokens expire
    // after ~12h and this WebSocket is long-lived, so a stale token would
    // stick the runtime on auth.fail after the first expiry.
    const token = await this.options.getAccessToken()

    return new Promise<void>((resolve, reject) => {
      // Connect via lmthing.computer/api/ws — Envoy strips /api, pod sees /ws
      // JWT passed as query param since browsers can't set WebSocket headers
      const wsBase = this.options.computerBaseUrl.replace(/^http/, 'ws')
      const url = `${wsBase}/api/ws?access_token=${encodeURIComponent(token)}`
      const ws = new WebSocket(url)
      this.ws = ws

      ws.onopen = () => {
        this.callbacks.onOpen()
      }

      ws.onmessage = (event) => {
        const msg = decodeMessage(event.data as string)
        this.handleAuthAndDispatch(msg, resolve, reject)
      }

      ws.onerror = () => {
        // onclose fires after — handle reconnect there
      }

      ws.onclose = (event) => {
        if (this.disposed) return

        if (this.callbacks.getStatus() === 'booting') {
          reject(new Error(`WebSocket closed during boot (code ${event.code})`))
          return
        }

        this.callbacks.emitLog('warn', 'runtime', `Connection lost (code ${event.code})`)
        this.callbacks.setStatus('error')
        this.scheduleReconnect()
      }
    })
  }

  send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeMessage(msg))
    }
  }

  close(code?: number, reason?: string) {
    this.disposed = true
    this.clearReconnectTimer()
    if (this.ws) {
      this.ws.close(code, reason)
      this.ws = null
    }
  }

  private handleAuthAndDispatch(
    msg: ServerMessage,
    resolve: (value: void) => void,
    reject: (reason: Error) => void,
  ) {
    if (msg.type === 'auth.ok') {
      this.retryCount = 0
      this.callbacks.setStatus('running')
      this.callbacks.emitLog('info', 'runtime', 'Connected to compute pod')
      resolve()
      return
    }

    if (msg.type === 'auth.fail') {
      this.callbacks.emitLog('error', 'runtime', `Auth failed: ${msg.reason}`)
      this.callbacks.setStatus('error')
      this.ws?.close()
      reject(new Error(`Auth failed: ${msg.reason}`))
      return
    }

    this.callbacks.onMessage(msg)
  }

  private scheduleReconnect() {
    if (this.disposed || this.retryCount >= MAX_RETRIES) {
      if (this.retryCount >= MAX_RETRIES) {
        this.callbacks.emitLog('error', 'runtime', 'Max reconnection attempts reached')
      }
      return
    }

    const delay = BASE_DELAY_MS * Math.pow(2, this.retryCount)
    this.retryCount++
    this.callbacks.emitLog('info', 'runtime', `Reconnecting in ${delay}ms (attempt ${this.retryCount}/${MAX_RETRIES})`)

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect()
      } catch {
        // connect() failure triggers onclose → scheduleReconnect
      }
    }, delay)
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
