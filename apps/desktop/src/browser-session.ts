import { invoke } from '@tauri-apps/api/core'
import { CdpClient, type CdpEndpoint, type Frame, type TabInfo, NAVIGATE_TIMEOUT_MS } from './cdp'

/**
 * The one browser, shared by the person and the agent.
 *
 * ## Why a singleton and not a hook
 *
 * Two parties drive this browser: the pane the person is looking at, and the pod's bridge acting
 * for an agent. If each owned its own {@link CdpClient} they would attach to different targets,
 * hold separate screencasts and disagree about which tab is current — and the disagreement would
 * be invisible, because both would be reporting truthfully about different pages. Sharing one
 * session is what makes "the agent acts on what you are watching" true rather than aspirational.
 *
 * It also makes the honest thing possible: because every agent operation passes through here, the
 * pane can show that the agent is driving, right now, on the page in front of the person.
 */

export interface BrowserState {
  status: 'off' | 'starting' | 'ready' | 'error'
  detail?: string
  /** False while the browser is popped out into a window of its own. */
  headless: boolean
  url: string
  title: string
  loading: boolean
  tabs: TabInfo[]
  currentTargetId: string | null
  /** What the agent last did, and when — the pane's "the agent is driving" indicator. */
  agentActivity: { op: string; at: number } | null
}

const IDLE: BrowserState = {
  status: 'off',
  headless: true,
  url: '',
  title: '',
  loading: false,
  tabs: [],
  currentTargetId: null,
  agentActivity: null,
}

/** How long the "agent is driving" indicator stays lit after the last operation. */
const AGENT_INDICATOR_MS = 4_000

/** Fast enough to feel immediate, slow enough that it is one small round trip a second. */
const TAB_POLL_MS = 1_000

export class BrowserSession {
  private client: CdpClient | null = null
  private starting: Promise<CdpClient> | null = null
  private state: BrowserState = IDLE
  private listeners = new Set<(s: BrowserState) => void>()
  private frameListeners = new Set<(f: Frame) => void>()
  private lastFrame: Frame | null = null
  private indicatorTimer: ReturnType<typeof setTimeout> | null = null
  private tabPoll: ReturnType<typeof setInterval> | null = null
  private tabPollInFlight = false

  subscribe(fn: (s: BrowserState) => void): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  /** The most recent frame, so a pane mounted mid-stream paints immediately instead of staying blank. */
  onFrame(fn: (f: Frame) => void): () => void {
    this.frameListeners.add(fn)
    if (this.lastFrame) fn(this.lastFrame)
    return () => this.frameListeners.delete(fn)
  }

  current(): BrowserState {
    return this.state
  }

  private set(patch: Partial<BrowserState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l(this.state)
  }

  /**
   * Start the browser if it is not running, and return a connected client.
   *
   * Concurrent callers share one launch. Without that, an agent request arriving while the pane is
   * opening starts a SECOND Chromium on the same profile directory — which fails, because
   * Chromium holds a lock on it, and the failure names the profile rather than the race.
   */
  async ensure(): Promise<CdpClient> {
    if (this.client?.connected()) return this.client
    if (this.starting) return this.starting
    this.set({ status: 'starting', detail: undefined })
    this.starting = (async () => {
      try {
        const endpoint = await invoke<CdpEndpoint>('browser_start')
        const client = await this.attach(endpoint)
        return client
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        this.set({ status: 'error', detail })
        throw err
      } finally {
        this.starting = null
      }
    })()
    return this.starting
  }

  private async attach(endpoint: CdpEndpoint): Promise<CdpClient> {
    const client = new CdpClient()
    await client.connect(endpoint)
    this.client = client
    this.set({ status: 'ready', headless: endpoint.headless, detail: undefined })

    client.onFrame((f) => {
      this.lastFrame = f
      for (const l of this.frameListeners) l(f)
    })
    // The list arrives here from two places: `Target.targetCreated`/`targetDestroyed` for
    // immediate feedback when a tab opens or closes, and the poll below for titles — which CDP
    // has no event for at all. See `startTabPoll`.
    client.onTargetsChanged((tabs) => this.set({ tabs, currentTargetId: client.currentTarget() }))
    client.onClose(() => {
      this.client = null
      this.lastFrame = null
      this.set({ ...IDLE, status: 'off' })
    })
    client.onEvent((method) => {
      // Navigation is reported from four different places depending on how it happened — a link, a
      // history entry, a pushState, a reload. Reacting to all of them and re-reading the answer is
      // simpler and more reliable than trying to derive the URL from each event's own shape.
      if (method === 'Page.frameStartedLoading') this.set({ loading: true })
      else if (
        method === 'Page.frameNavigated' ||
        method === 'Page.navigatedWithinDocument' ||
        method === 'Page.loadEventFired' ||
        method === 'Page.frameStoppedLoading'
      ) {
        this.set({ loading: method === 'Page.frameNavigated' })
        void this.refreshLocation()
      }
    })

    // One read at connect, so the strip is populated before the first poll comes round.
    await client.tabs().catch(() => [])
    await this.refreshLocation()
    return client
  }

  private async refreshLocation(): Promise<void> {
    const c = this.client
    if (!c?.connected()) return
    try {
      const r = await c.send<{ result?: { value?: string } }>('Runtime.evaluate', {
        expression: 'JSON.stringify({u:location.href,t:document.title})',
        returnByValue: true,
      })
      const { u, t } = JSON.parse(r.result?.value ?? '{}') as { u?: string; t?: string }
      this.set({ url: u ?? '', title: t ?? '' })
    } catch {
      /* mid-navigation the context is torn down; the next event re-reads it */
    }
  }

  /** Called by the bridge for every agent operation, so the pane can say who is driving. */
  noteAgentActivity(op: string): void {
    this.set({ agentActivity: { op, at: Date.now() } })
    if (this.indicatorTimer) clearTimeout(this.indicatorTimer)
    this.indicatorTimer = setTimeout(() => this.set({ agentActivity: null }), AGENT_INDICATOR_MS)
  }

  /**
   * Send one command on the shared session.
   *
   * The pane's input path uses this rather than holding a client of its own, so that a mouse event
   * and an agent's command are addressed to the same page by construction. A no-op when nothing is
   * attached: a click that arrives a frame after the browser closed is not worth an error.
   */
  async send(method: string, params: Record<string, unknown>): Promise<void> {
    if (!this.client?.connected()) return
    await this.client.send(method, params)
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.client?.setViewport(width, height)
  }

  async startScreencast(): Promise<void> {
    await this.client?.startScreencast()
    this.startTabPoll()
  }

  async stopScreencast(): Promise<void> {
    this.stopTabPoll()
    await this.client?.stopScreencast()
  }

  /**
   * Keep the tab strip's titles current.
   *
   * A poll, and not for want of trying an event. CDP has no "the title changed" notification:
   * `Target.targetInfoChanged` fires only on navigation, and reports the URL rather than the
   * document's title. Asking `Target.getTargets` is the only way to learn what a tab is actually
   * called — so the strip asks, at a rate a person perceives as immediate, and only while they are
   * looking at it.
   *
   * Single-flight, because two overlapping replies can arrive out of order and leave the strip
   * showing a title the page had two seconds ago, permanently, with nothing further to correct it.
   */
  private startTabPoll(): void {
    if (this.tabPoll) return
    this.tabPoll = setInterval(() => {
      if (this.tabPollInFlight || !this.client?.connected()) return
      this.tabPollInFlight = true
      void this.client
        .tabs()
        .catch(() => [])
        .finally(() => {
          this.tabPollInFlight = false
        })
    }, TAB_POLL_MS)
  }

  private stopTabPoll(): void {
    if (this.tabPoll) clearInterval(this.tabPoll)
    this.tabPoll = null
  }

  async navigate(url: string): Promise<void> {
    const c = await this.ensure()
    this.set({ loading: true })
    await c.send('Page.navigate', { url }, NAVIGATE_TIMEOUT_MS)
  }

  async goBack(): Promise<void> {
    await this.history(-1)
  }

  async goForward(): Promise<void> {
    await this.history(1)
  }

  private async history(delta: number): Promise<void> {
    const c = this.client
    if (!c?.connected()) return
    const h = await c.send<{ currentIndex: number; entries: Array<{ id: number }> }>(
      'Page.getNavigationHistory',
    )
    const entry = h.entries[h.currentIndex + delta]
    if (entry) await c.send('Page.navigateToHistoryEntry', { entryId: entry.id })
  }

  async reload(): Promise<void> {
    await this.client?.send('Page.reload', {})
  }

  async selectTab(targetId: string): Promise<void> {
    await this.client?.attachTo(targetId)
    await this.refreshLocation()
  }

  async newTab(url: string): Promise<void> {
    const c = await this.ensure()
    await c.attachTo(await c.newTab(url))
    await this.refreshLocation()
  }

  async closeTab(targetId: string): Promise<void> {
    await this.client?.closeTab(targetId)
  }

  /**
   * Move the browser between the pane and a window of its own.
   *
   * The page is restored afterwards because the relaunch loses open tabs — the profile survives,
   * so the person is still signed in, but landing them on `about:blank` after clicking "open in a
   * window" would read as having lost their place.
   */
  async setPoppedOut(poppedOut: boolean): Promise<void> {
    const url = this.state.url
    this.client?.close()
    this.client = null
    this.lastFrame = null
    this.set({ status: 'starting' })
    const endpoint = await invoke<CdpEndpoint>('browser_relaunch', { headless: !poppedOut })
    await this.attach(endpoint)
    if (url && url !== 'about:blank') await this.navigate(url)
  }

  /**
   * Stop the browser entirely.
   *
   * Killing the process rather than just closing the socket, because a browser signed into
   * somebody's accounts that outlives the app is exactly the wrong thing to leave behind.
   */
  async stop(): Promise<void> {
    this.stopTabPoll()
    this.client?.close()
    this.client = null
    this.lastFrame = null
    this.set({ ...IDLE })
    await invoke('browser_stop').catch(() => {})
  }
}

/** The process-wide instance. See the class comment for why there is only one. */
export const browserSession = new BrowserSession()
