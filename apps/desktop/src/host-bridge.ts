import { invoke } from '@tauri-apps/api/core'
import { wsUrl } from '@lmthing/ui/platform'
import type { CdpClient } from './cdp'
import { callTool } from './browser-tools'
import { browserSession } from './browser-session'

/**
 * The desktop half of the host bridge: dial the pod, answer its requests.
 *
 * ## Why the desktop dials
 *
 * A cloud pod cannot reach this machine. It is behind NAT, has no stable address, and is asleep
 * half the time. So the direction is fixed — and it is free, because it reuses the same TLS, the
 * same Envoy JWT-`sub` routing and the same `?access_token=` convention the chat socket already
 * uses.
 *
 * ## Why this lives in the webview rather than in Rust
 *
 * The security boundary is not the socket. It is `src-tauri/src/grants.rs`, which every operation
 * below routes through via the `fs_op` command. Given that, putting the transport here costs
 * nothing and buys two things: a socket, a JWT and a reconnect loop are trivial in a renderer and
 * would be an async runtime plus a token-plumbing problem in Rust; and the bridge runs only while
 * the window is open, which is the honest behaviour — a person can see that their machine is
 * reachable, and closing the app ends it.
 */

/** Must match `HOST_PROTOCOL_VERSION` in `libs/cli/src/rpc/host-events.ts`. */
const HOST_PROTOCOL_VERSION = 1

interface FsRequestFrame {
  type: 'fs.request'
  id: string
  op: string
  rootId?: string
  path?: string
  query?: string
  content?: string
  offset?: number
  limit?: number
}

type ServerFrame =
  | { type: 'hello'; protocolVersion: number; podId: string }
  | { type: 'evicted'; reason: string }
  | { type: 'error'; message: string }
  | FsRequestFrame
  | { type: 'browser.request'; id: string; body: unknown }
  | { type: 'cdp.request'; id: string; method: string; params?: Record<string, unknown> }

export interface Grant {
  id: string
  label: string
  mode: 'ro' | 'rw'
}

/** One line for the activity log — part of the security design, not decoration. */
export interface HostActivity {
  at: number
  op: string
  rootId?: string
  path?: string
  ok: boolean
  error?: string
}

export interface HostBridgeState {
  status: 'idle' | 'connecting' | 'connected' | 'evicted' | 'error'
  detail?: string
  activity: HostActivity[]
}

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
/** Keep the last N operations. Enough to answer "what did it just do?", bounded so it cannot grow. */
const ACTIVITY_LIMIT = 200

export class DesktopHostBridge {
  private socket: WebSocket | null = null
  private closed = false
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private state: HostBridgeState = { status: 'idle', activity: [] }
  private listeners = new Set<(s: HostBridgeState) => void>()

  constructor(private getAccessToken: () => Promise<string>) {}

  subscribe(fn: (s: HostBridgeState) => void): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  /** Open the socket and keep it open. Safe to call twice. */
  start(): void {
    this.closed = false
    if (this.socket) return
    void this.connect()
  }

  /**
   * Disconnect, and stay disconnected.
   *
   * The kill switch. It has to be instant and total: the person clicking "disconnect" is saying
   * "stop reaching my files NOW", and anything that keeps a socket alive for a few more seconds is
   * answering a different question. The pod side fails every in-flight request the moment the
   * socket drops, so nothing is left half-done.
   */
  stop(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.socket?.close()
    this.socket = null
    // The browser goes with it. Leaving a signed-in browser running after the person said "stop
    // reaching my computer" would answer a narrower question than the one they asked.
    void browserSession.stop().catch(() => {})
    this.set({ status: 'idle' })
  }

  private set(patch: Partial<HostBridgeState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l(this.state)
  }

  private log(entry: HostActivity): void {
    const activity = [entry, ...this.state.activity].slice(0, ACTIVITY_LIMIT)
    this.set({ activity })
  }

  private async connect(): Promise<void> {
    if (this.closed) return
    this.set({ status: 'connecting' })
    let token: string
    try {
      token = await this.getAccessToken()
    } catch (err) {
      this.set({ status: 'error', detail: err instanceof Error ? err.message : String(err) })
      return this.scheduleReconnect()
    }

    // The token rides in the query string because a browser cannot set a header on a WebSocket
    // handshake — the same reason every other socket in this product does it.
    const url = wsUrl(`/api/host/ws?access_token=${encodeURIComponent(token)}`)
    const ws = new WebSocket(url)
    this.socket = ws

    ws.onopen = () => {
      this.attempt = 0
      this.set({ status: 'connected', detail: undefined })
      void this.pushGrants()
    }

    ws.onmessage = (ev) => void this.onFrame(String(ev.data))

    ws.onclose = () => {
      this.socket = null
      if (this.state.status !== 'evicted' && !this.closed) this.set({ status: 'connecting' })
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      // `onclose` always follows, and it owns the reconnect — doing it here as well would double
      // every backoff.
      this.set({ detail: 'connection failed' })
    }
  }

  private scheduleReconnect(): void {
    // An evicted shell must NOT reconnect: the workspace is deliberately attached somewhere else,
    // and racing to steal it back would leave two machines fighting over one bridge.
    if (this.closed || this.state.status === 'evicted') return
    if (this.timer) clearTimeout(this.timer)
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt++, RECONNECT_MAX_MS)
    this.timer = setTimeout(() => void this.connect(), delay)
  }

  /** Tell the pod which folders exist. Ids and labels only — never a path. */
  private async pushGrants(): Promise<void> {
    try {
      const roots = await invoke<Grant[]>('grant_list')
      this.send({ type: 'grants', roots })
    } catch {
      this.send({ type: 'grants', roots: [] })
    }
  }

  /** Call after the person adds or removes a grant, so the pod never acts on a stale list. */
  async refreshGrants(): Promise<void> {
    if (this.state.status === 'connected') await this.pushGrants()
  }

  private send(msg: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg))
  }

  private async onFrame(raw: string): Promise<void> {
    let frame: ServerFrame
    try {
      frame = JSON.parse(raw) as ServerFrame
    } catch {
      return
    }

    switch (frame.type) {
      case 'hello': {
        if (frame.protocolVersion !== HOST_PROTOCOL_VERSION) {
          // Refuse rather than guess. A pod speaking a protocol this build does not understand
          // would be answered with frames it may read as something else entirely.
          this.set({ status: 'error', detail: 'This workspace expects a newer desktop app.' })
          this.closed = true
          this.socket?.close()
        }
        return
      }
      case 'evicted': {
        // Deliberate, and not an error: the person opened the app on another computer. Say so and
        // stay down — see `scheduleReconnect`.
        this.set({ status: 'evicted', detail: frame.reason })
        this.socket?.close()
        return
      }
      case 'fs.request': {
        await this.handleFs(frame)
        return
      }
      case 'browser.request': {
        await this.handleBrowser(frame.id, frame.body)
        return
      }
      case 'cdp.request': {
        await this.handleCdp(frame.id, frame.method, frame.params)
        return
      }
      default:
        // Ignoring an unknown frame is always safe; answering one we do not understand is not.
        return
    }
  }

  /**
   * Ensure the browser is running and attached.
   *
   * Started on FIRST USE rather than at connect: a browser signed into somebody's accounts should
   * appear because an agent needed one, at a moment the person can see in the activity log — not
   * quietly, at launch, forever.
   *
   * The session is SHARED with the pane, so an agent that navigates is navigating the tab the
   * person is watching. That is the design, not a coincidence: see `browser-session.ts`.
   */
  private async ensureCdp(): Promise<CdpClient> {
    return browserSession.ensure()
  }

  /**
   * A `tools/call` from one of the 27 `system-browser` functions.
   *
   * The reply is a JSON-RPC envelope because that is exactly what those wrappers parse — they were
   * written against Lightpanda's MCP server and have not been touched.
   */
  private async handleBrowser(id: string, body: unknown): Promise<void> {
    const rpc = body as { id?: unknown; params?: { name?: string; arguments?: Record<string, unknown> } }
    const name = rpc?.params?.name ?? ''
    // Told to the pane BEFORE the call, not after: the point of the indicator is that a person
    // watching sees the agent take the wheel as it happens, not once the page has already changed.
    browserSession.noteAgentActivity(name)
    try {
      const client = await this.ensureCdp()
      const result = await callTool(client, name, rpc?.params?.arguments ?? {})
      this.log({ at: Date.now(), op: `browser.${name}`, ok: result.isError !== true })
      this.send({ type: 'result', id, ok: true, value: { jsonrpc: '2.0', id: rpc?.id ?? 1, result } })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log({ at: Date.now(), op: `browser.${name}`, ok: false, error: message })
      // A JSON-RPC error, not a transport failure: the wrappers surface `error.message` to the
      // model, so this arrives as something it can act on.
      this.send({
        type: 'result',
        id,
        ok: true,
        value: { jsonrpc: '2.0', id: rpc?.id ?? 1, error: { code: -32000, message } },
      })
    }
  }

  /** A raw protocol command from the desktop-only devtools agent. Consent already granted. */
  private async handleCdp(id: string, method: string, params?: Record<string, unknown>): Promise<void> {
    browserSession.noteAgentActivity(method)
    try {
      const client = await this.ensureCdp()
      if (method === 'subscribe') {
        await client.subscribe(String(params?.['domain'] ?? ''))
        this.log({ at: Date.now(), op: `cdp.subscribe ${String(params?.['domain'] ?? '')}`, ok: true })
        this.send({ type: 'result', id, ok: true, value: { ok: true } })
        return
      }
      if (method === 'events') {
        this.send({ type: 'result', id, ok: true, value: { ok: true, events: client.drainEvents() } })
        return
      }
      const result = await client.send(method, params ?? {})
      this.log({ at: Date.now(), op: `cdp ${method}`, ok: true })
      this.send({ type: 'result', id, ok: true, value: { ok: true, result } })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      this.log({ at: Date.now(), op: `cdp ${method}`, ok: false, error })
      this.send({ type: 'result', id, ok: true, value: { ok: false, error } })
    }
  }

  private async handleFs(frame: FsRequestFrame): Promise<void> {
    try {
      // EVERY operation goes through the Rust command, which resolves the path against the grant
      // jail before touching the disk. Nothing here inspects a path, and nothing here may.
      const value = await invoke<Record<string, unknown>>('fs_op', {
        req: {
          op: frame.op,
          rootId: frame.rootId ?? '',
          path: frame.path,
          query: frame.query,
          content: frame.content,
          offset: frame.offset,
          limit: frame.limit,
        },
      })
      this.log({
        at: Date.now(),
        op: frame.op,
        ...(frame.rootId ? { rootId: frame.rootId } : {}),
        ...(frame.path ? { path: frame.path } : {}),
        ok: value?.['ok'] !== false,
        ...(typeof value?.['error'] === 'string' ? { error: value['error'] as string } : {}),
      })
      this.send({ type: 'result', id: frame.id, ok: true, value })
    } catch (err) {
      // The command itself failed — distinct from a REFUSAL, which comes back inside `value` as
      // `{ ok: false, error }` because it is a normal outcome the agent must be able to act on.
      const error = err instanceof Error ? err.message : String(err)
      this.log({ at: Date.now(), op: frame.op, ok: false, error })
      this.send({ type: 'result', id: frame.id, ok: false, error })
    }
  }
}
