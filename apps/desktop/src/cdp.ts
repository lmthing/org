/**
 * A Chrome DevTools Protocol client for a whole browser — not a single page.
 *
 * ## Why the browser target and not a page
 *
 * The first version of this file opened `/json/list`, found one page, and connected straight to
 * it. That is enough to read a document and it is not enough to be a browser: a page-level
 * connection cannot enumerate tabs, cannot open one, cannot notice that the person closed the one
 * it was holding, and dies silently when that happens.
 *
 * So this connects to the BROWSER target (`/json/version`) and attaches to pages underneath it
 * with `Target.attachToTarget({ flatten: true })`. Flat mode multiplexes every session down the
 * one socket, tagged with a `sessionId` — which is why {@link CdpClient.send} decides per method
 * whether the command belongs to the browser or to the current page, rather than making every
 * caller know.
 *
 * ## Three callers, one browser
 *
 * - The **pane** (`BrowserPane.tsx`) — screencast frames out, mouse and keys in.
 * - The **27 `system-browser` functions**, which POST a JSON-RPC `tools/call` the pod forwards
 *   verbatim; `browser-tools.ts` turns it into CDP.
 * - The **`devtools` agent**, which sends raw protocol commands a person has approved.
 *
 * All three drive the same target. That is the entire point of a real browser here: what the agent
 * acts on is what the person is looking at, with one DOM and one cookie jar between them.
 */

export interface CdpEndpoint {
  /**
   * The browser target's WebSocket URL, resolved in Rust.
   *
   * Not an HTTP base to look it up from: Chromium's `/json/version` sends no
   * `Access-Control-Allow-Origin`, so fetching it from the renderer is blocked by CORS. A
   * WebSocket is not subject to CORS at all — its origin check is `--remote-allow-origins`, which
   * the launch sets.
   */
  wsUrl: string
  port: number
  headless: boolean
}

/** One open tab, as the pane's tab strip and the agent's `listTabs` both see it. */
export interface TabInfo {
  targetId: string
  title: string
  url: string
}

/** A screencast frame: base64 JPEG plus the geometry needed to map a click back onto the page. */
export interface Frame {
  data: string
  /** CSS pixels of the page as rendered into this frame. */
  deviceWidth: number
  deviceHeight: number
  scrollOffsetX: number
  scrollOffsetY: number
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

/** How long any single protocol command may take. A navigation carries its own longer budget. */
const COMMAND_TIMEOUT_MS = 30_000
export const NAVIGATE_TIMEOUT_MS = 60_000

/**
 * Methods that belong to the browser rather than to a page.
 *
 * A prefix list rather than a per-call flag because getting it wrong is silent in the worst
 * direction: `Target.*` sent WITH a page session id is answered by the page session, which does
 * not implement it, and comes back as a flat "not found" that reads like the tab is gone.
 */
const BROWSER_LEVEL = ['Target.', 'Browser.', 'SystemInfo.', 'Storage.getCookies']

function isBrowserLevel(method: string): boolean {
  return BROWSER_LEVEL.some((p) => method.startsWith(p))
}

/** Pages the person could plausibly be looking at — not devtools windows or service workers. */
function isRealPage(t: { type?: string; url?: string }): boolean {
  return t.type === 'page' && !String(t.url ?? '').startsWith('devtools://')
}

export class CdpClient {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  /** The flat-mode session for the page currently being driven. */
  private sessionId: string | null = null
  private targetId: string | null = null
  /** Events collected since the last drain, per the `cdpSubscribe`/`cdpEvents` contract. */
  private events: Array<{ method: string; params?: unknown }> = []
  private subscribed = new Set<string>()
  private listeners = new Set<(method: string, params: unknown) => void>()
  private frameListeners = new Set<(f: Frame) => void>()
  private targetListeners = new Set<(tabs: TabInfo[]) => void>()
  /**
   * The tab list, maintained from target events rather than re-fetched on every change.
   *
   * Re-fetching raced: a page that renames itself twice in quick succession — which any page with
   * a live-updating title does — fires two changes, and if the two `Target.getTargets` replies
   * arrive out of order the STALE one is written last. The strip then shows a title the page had
   * seconds ago and never corrects itself, because nothing further happens. The events already
   * carry the new `targetInfo`, so there is nothing to ask for.
   */
  private tabList: TabInfo[] = []
  private closeListeners = new Set<() => void>()
  private screencasting = false
  private viewport: { width: number; height: number } | null = null
  private userAgent: string | null = null

  /**
   * Connect to the browser and attach to a page.
   *
   * If the browser has no page — which happens when the person closes the last tab — one is
   * created rather than failing. A browser with no tab is a state a person can leave it in and
   * would not expect to be fatal.
   */
  async connect(endpoint: CdpEndpoint): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(endpoint.wsUrl)
      this.ws = ws
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('could not attach to the browser'))
      ws.onmessage = (ev) => this.onMessage(String(ev.data))
      ws.onclose = () => {
        this.ws = null
        this.sessionId = null
        this.targetId = null
        this.screencasting = false
        // Fail every in-flight command rather than leaving the agent waiting on a browser that has
        // gone: a closed browser is a knowable answer, and a timeout is not.
        for (const [, p] of this.pending) p.reject(new Error('the browser closed'))
        this.pending.clear()
        for (const l of this.closeListeners) l()
      }
    })

    // Discovery first, so a tab opened by a link — or by the agent — shows up in the strip
    // without anyone polling for it.
    await this.send('Target.setDiscoverTargets', { discover: true })
    this.userAgent = await this.honestUserAgent()
    const tabs = await this.tabs()
    const first = tabs[0]?.targetId ?? (await this.newTab('about:blank'))
    await this.attachTo(first)
  }

  close(): void {
    this.ws?.close()
    this.ws = null
  }

  connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  currentTarget(): string | null {
    return this.targetId
  }

  onEvent(fn: (method: string, params: unknown) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  onFrame(fn: (f: Frame) => void): () => void {
    this.frameListeners.add(fn)
    return () => this.frameListeners.delete(fn)
  }

  /** Fired with the whole list whenever a tab appears, disappears, or renames itself. */
  onTargetsChanged(fn: (tabs: TabInfo[]) => void): () => void {
    this.targetListeners.add(fn)
    return () => this.targetListeners.delete(fn)
  }

  private announceTabs(): void {
    for (const l of this.targetListeners) l([...this.tabList])
  }

  private upsertTab(info: { targetId: string; type?: string; title?: string; url?: string }): void {
    if (!isRealPage(info)) return
    const tab: TabInfo = { targetId: info.targetId, title: info.title ?? '', url: info.url ?? '' }
    const at = this.tabList.findIndex((t) => t.targetId === tab.targetId)
    if (at >= 0) this.tabList[at] = tab
    else this.tabList.push(tab)
    this.announceTabs()
  }

  onClose(fn: () => void): () => void {
    this.closeListeners.add(fn)
    return () => this.closeListeners.delete(fn)
  }

  private onMessage(raw: string): void {
    let msg: {
      id?: number
      result?: unknown
      error?: { message?: string }
      method?: string
      params?: unknown
      sessionId?: string
    }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message ?? 'CDP error'))
      else p.resolve(msg.result)
      return
    }
    if (!msg.method) return

    // The person closed the tab this client was driving, or the agent did. Move to another rather
    // than going dark: every later command would otherwise fail against a session that is gone,
    // and the error would name the protocol rather than the cause.
    if (msg.method === 'Target.targetDestroyed') {
      const gone = (msg.params as { targetId?: string })?.targetId
      if (gone) this.tabList = this.tabList.filter((t) => t.targetId !== gone)
      this.announceTabs()
      if (gone && gone === this.targetId) void this.recoverFromLostTarget()
      return
    }
    if (msg.method === 'Target.targetCreated') {
      // Only creation, deliberately. `Target.targetInfoChanged` fires on NAVIGATION and carries the
      // URL in its `title` field, and it does not fire at all when a page sets `document.title`
      // from script — so it can neither report a title nor be relied on to notice one changed.
      // Titles come from `tabs()`, which asks the browser. See the poll in `browser-session.ts`.
      const info = (msg.params as { targetInfo?: { targetId: string; type?: string; title?: string; url?: string } })
        ?.targetInfo
      if (info) this.upsertTab(info)
      return
    }

    if (msg.method === 'Page.screencastFrame') {
      this.onScreencastFrame(msg.params as ScreencastFrameParams)
      return
    }

    for (const l of this.listeners) {
      try {
        l(msg.method, msg.params)
      } catch {
        /* a listener's failure is not the client's problem */
      }
    }
    // Only collected for domains the agent asked for — otherwise a single `Network.enable` would
    // bury every later `cdpEvents()` in traffic nobody requested.
    const domain = msg.method.split('.')[0] ?? ''
    if (this.subscribed.has(domain)) {
      this.events.push({ method: msg.method, ...(msg.params !== undefined ? { params: msg.params } : {}) })
      // Bounded: a busy page can emit thousands of events a second.
      if (this.events.length > 1000) this.events.splice(0, this.events.length - 1000)
    }
  }

  private async recoverFromLostTarget(): Promise<void> {
    this.sessionId = null
    this.targetId = null
    try {
      const tabs = await this.tabs()
      const next = tabs[0]?.targetId ?? (await this.newTab('about:blank'))
      await this.attachTo(next)
    } catch {
      /* the browser itself is going away; `onclose` handles that */
    }
  }

  /**
   * Send one command.
   *
   * Browser-level methods go without a session; everything else is addressed to the page currently
   * attached. A command sent before any page is attached is an error rather than a silent
   * browser-level send, which would be answered by the wrong party.
   */
  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<T> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('the browser is not running'))
    }
    const browserLevel = isBrowserLevel(method)
    if (!browserLevel && !this.sessionId) {
      return Promise.reject(new Error('no page is attached'))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} did not answer within ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(browserLevel ? {} : { sessionId: this.sessionId }),
        }),
      )
    })
  }

  /**
   * The browser's own user-agent, with `HeadlessChrome` corrected to `Chrome`.
   *
   * This is not evasion. The browser is genuinely being used by a person, at their keyboard,
   * watching the page — it is headless only in the sense that its window is drawn inside this app
   * instead of by the OS. Announcing `HeadlessChrome` gets that person served a bot-check or a
   * degraded page in their OWN browser, on their OWN account, which is simply a wrong answer.
   *
   * Returns null on failure rather than guessing at a plausible string: a made-up user-agent is
   * worse than an honest one.
   */
  private async honestUserAgent(): Promise<string | null> {
    try {
      const v = await this.send<{ userAgent?: string }>('Browser.getVersion')
      const ua = v.userAgent
      if (!ua || !ua.includes('HeadlessChrome')) return null
      return ua.replace('HeadlessChrome', 'Chrome')
    } catch {
      return null
    }
  }

  /**
   * The current tabs, re-read from the browser.
   *
   * Used at connect and by the agent's `listTabs`, where an authoritative answer is worth a round
   * trip. The pane reads the event-maintained list instead — see {@link onTargetsChanged}.
   */
  async tabs(): Promise<TabInfo[]> {
    const r = await this.send<{ targetInfos?: Array<{ targetId: string; type: string; title: string; url: string }> }>(
      'Target.getTargets',
    )
    this.tabList = (r.targetInfos ?? [])
      .filter(isRealPage)
      .map((t) => ({ targetId: t.targetId, title: t.title, url: t.url }))
    this.announceTabs()
    return [...this.tabList]
  }

  /**
   * Make `targetId` the page every non-browser-level command addresses.
   *
   * The previous session is detached first. Leaving it attached would keep its screencast running
   * and its events flowing into the same collector, so the agent would be reading one page while
   * the person watched another.
   */
  async attachTo(targetId: string): Promise<void> {
    if (this.sessionId) {
      const old = this.sessionId
      this.sessionId = null
      await this.send('Target.detachFromTarget', { sessionId: old }).catch(() => {})
    }
    const r = await this.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId,
      flatten: true,
    })
    this.sessionId = r.sessionId
    this.targetId = targetId
    await this.send('Page.enable').catch(() => {})
    // Per SESSION, so a new tab does not silently announce itself differently from the last one.
    if (this.userAgent) {
      await this.send('Emulation.setUserAgentOverride', { userAgent: this.userAgent }).catch(() => {})
    }
    // A browser with no window of its own is never the focused window, and a page that believes it
    // is unfocused DROPS key events — the mouse still works, so this presents as "clicking is fine
    // but typing does nothing", with no error on either side. `Page.bringToFront` alone is not
    // enough; the page has to be told it holds focus.
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
    await this.send('Page.bringToFront').catch(() => {})
    // Re-apply both, because they are properties of a SESSION rather than of the browser: a tab
    // switch would otherwise drop the pane back to Chromium's own window size and stop the stream.
    if (this.viewport) await this.setViewport(this.viewport.width, this.viewport.height)
    if (this.screencasting) await this.restartScreencast()
    this.announceTabs()
  }

  async newTab(url: string): Promise<string> {
    const r = await this.send<{ targetId: string }>('Target.createTarget', { url })
    return r.targetId
  }

  async closeTab(targetId: string): Promise<void> {
    await this.send('Target.closeTarget', { targetId })
  }

  async subscribe(domain: string): Promise<void> {
    this.subscribed.add(domain)
    // `enable` first, or the domain emits nothing — and "no events" would read as "no traffic",
    // which is a different and wrong answer.
    try {
      await this.send(`${domain}.enable`)
    } catch {
      /* some domains have no enable; subscribing is still meaningful */
    }
  }

  drainEvents(): Array<{ method: string; params?: unknown }> {
    const out = this.events
    this.events = []
    return out
  }

  /**
   * Tell the page how big it is.
   *
   * Without an override the page lays out for whatever window Chromium happened to create, and the
   * pane then shows a scaled-down picture of a differently-shaped page — every coordinate the
   * person clicks lands somewhere else. With it, one frame pixel is one CSS pixel and the mapping
   * in `browser-input.ts` is a single scale factor.
   */
  async setViewport(width: number, height: number): Promise<void> {
    this.viewport = { width, height }
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
  }

  async startScreencast(): Promise<void> {
    this.screencasting = true
    await this.restartScreencast()
  }

  private async restartScreencast(): Promise<void> {
    await this.send('Page.startScreencast', {
      format: 'jpeg',
      // Quality and size are a bandwidth decision, not a fidelity one: these frames cross a
      // WebSocket on the same machine, but they also re-encode on every repaint of a busy page.
      quality: 70,
      maxWidth: this.viewport?.width ?? 1280,
      maxHeight: this.viewport?.height ?? 800,
      everyNthFrame: 1,
    })
  }

  async stopScreencast(): Promise<void> {
    this.screencasting = false
    await this.send('Page.stopScreencast').catch(() => {})
  }

  /**
   * Hand a frame on, then acknowledge it.
   *
   * The ack is not optional and not a formality. Chromium keeps a small number of frames in flight
   * and stops sending entirely once they are unacknowledged — so a client that renders frames and
   * never acks shows the first two or three and then a still image forever, with no error
   * anywhere. It looks exactly like a page that stopped changing.
   */
  private onScreencastFrame(params: ScreencastFrameParams): void {
    const m = params?.metadata
    if (params?.data && m) {
      const frame: Frame = {
        data: params.data,
        deviceWidth: m.deviceWidth,
        deviceHeight: m.deviceHeight,
        scrollOffsetX: m.scrollOffsetX ?? 0,
        scrollOffsetY: m.scrollOffsetY ?? 0,
      }
      for (const l of this.frameListeners) {
        try {
          l(frame)
        } catch {
          /* a renderer's failure must not stall the ack below */
        }
      }
    }
    if (typeof params?.sessionId === 'number') {
      void this.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {})
    }
  }
}

interface ScreencastFrameParams {
  data: string
  sessionId: number
  metadata: {
    deviceWidth: number
    deviceHeight: number
    scrollOffsetX?: number
    scrollOffsetY?: number
  }
}
