/**
 * A Chrome DevTools Protocol client, and the translation from the agent's tool catalog onto it.
 *
 * ## Two callers, one browser
 *
 * The pod sends two kinds of browser frame and both land here:
 *
 * - `browser.request` — a JSON-RPC `tools/call` from one of the 27 `system-browser` functions.
 *   Those files are unchanged and unaware of any of this; they POST to `LIGHTPANDA_MCP_URL`, the
 *   pod forwards the body verbatim, and {@link callTool} below turns it into CDP.
 * - `cdp.request` — a raw protocol command from the desktop-only `devtools` agent, which the
 *   consent gate has already had a person approve.
 *
 * Both drive the SAME page, which is the point of using a real browser rather than a hidden one:
 * what the agent acts on is what the person is looking at.
 */

export interface CdpEndpoint {
  http: string
  port: number
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

/** How long any single protocol command may take. A navigation carries its own longer budget. */
const COMMAND_TIMEOUT_MS = 30_000
const NAVIGATE_TIMEOUT_MS = 60_000

export class CdpClient {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  /** Events collected since the last drain, per the `cdpSubscribe`/`cdpEvents` contract. */
  private events: Array<{ method: string; params?: unknown }> = []
  private subscribed = new Set<string>()
  private listeners = new Set<(method: string, params: unknown) => void>()

  /**
   * Connect to the browser's page target.
   *
   * `/json/list` is asked for a *page* rather than the browser target: a browser-level session
   * cannot evaluate script or read the DOM, which is most of what is wanted here.
   */
  async connect(endpoint: CdpEndpoint): Promise<void> {
    const res = await fetch(`${endpoint.http}/json/list`)
    const targets = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    if (!page?.webSocketDebuggerUrl) throw new Error('the browser has no page to attach to')

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl!)
      this.ws = ws
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('could not attach to the browser'))
      ws.onmessage = (ev) => this.onMessage(String(ev.data))
      ws.onclose = () => {
        this.ws = null
        // Fail every in-flight command rather than leaving the agent waiting on a browser that has
        // gone: a closed browser is a knowable answer, and a timeout is not.
        for (const [, p] of this.pending) p.reject(new Error('the browser closed'))
        this.pending.clear()
      }
    })
  }

  close(): void {
    this.ws?.close()
    this.ws = null
  }

  connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  onEvent(fn: (method: string, params: unknown) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private onMessage(raw: string): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown }
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
    if (msg.method) {
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
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = COMMAND_TIMEOUT_MS): Promise<T> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('the browser is not running'))
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
      ws.send(JSON.stringify({ id, method, params }))
    })
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
}

/** The MCP result envelope the 27 wrappers parse. */
function text(s: string, isError = false) {
  return { content: [{ type: 'text', text: s }], isError }
}

/**
 * Run one `tools/call` against the page.
 *
 * Most tools are expressed through `Runtime.evaluate`, because that is what they are: a question
 * about the DOM. The exceptions use the protocol directly where it has a better answer —
 * navigation, cookies, and the accessibility-shaped queries.
 *
 * Tools without a faithful CDP expression return an explicit "not supported" rather than a wrong
 * answer. An agent told a tool is unavailable will pick another; an agent handed a plausible lie
 * will build on it.
 */
export async function callTool(
  cdp: CdpClient,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const evaluate = async (expression: string): Promise<string> => {
    const r = await cdp.send<{ result?: { value?: unknown }; exceptionDetails?: { text?: string } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
    )
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'evaluation failed')
    const v = r.result?.value
    return typeof v === 'string' ? v : JSON.stringify(v ?? null)
  }

  switch (name) {
    case 'goto': {
      const url = String(args['url'] ?? '')
      await cdp.send('Page.enable')
      await cdp.send('Page.navigate', { url }, NAVIGATE_TIMEOUT_MS)
      // Settle before answering: returning the instant `Page.navigate` resolves would hand the
      // next tool an empty document, which reads as "the page was blank".
      await new Promise((r) => setTimeout(r, 500))
      return text(`navigated to ${url}`)
    }
    case 'getUrl':
      return text(await evaluate('location.href'))
    case 'html':
      return text(await evaluate('document.documentElement.outerHTML'))
    case 'markdown':
    case 'extract':
      // `innerText` rather than a markdown conversion: it is what the person sees, already free of
      // script and style, and inventing a second HTML→markdown implementation here would diverge
      // from `webFetch`'s.
      return text(await evaluate('document.body ? document.body.innerText : ""'))
    case 'links':
      return text(
        await evaluate(
          `JSON.stringify([...document.querySelectorAll('a[href]')].slice(0,300).map(a=>({text:a.innerText.trim().slice(0,120),href:a.href})))`,
        ),
      )
    case 'evaluate':
      return text(await evaluate(String(args['expression'] ?? args['script'] ?? '')))
    case 'click':
    case 'hover':
    case 'setChecked':
    case 'selectOption':
    case 'fill': {
      const selector = String(args['selector'] ?? '')
      if (!selector) return text('this browser requires a CSS selector', true)
      const js =
        name === 'fill'
          ? `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'not found';e.focus();e.value=${JSON.stringify(String(args['value'] ?? args['text'] ?? ''))};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 'filled'})()`
          : name === 'setChecked'
            ? `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'not found';e.checked=${args['checked'] === false ? 'false' : 'true'};e.dispatchEvent(new Event('change',{bubbles:true}));return 'set'})()`
            : name === 'selectOption'
              ? `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'not found';e.value=${JSON.stringify(String(args['value'] ?? ''))};e.dispatchEvent(new Event('change',{bubbles:true}));return 'selected'})()`
              : name === 'hover'
                ? `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'not found';e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return 'hovered'})()`
                : `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'not found';e.click();return 'clicked'})()`
      const out = await evaluate(js)
      return out === 'not found' ? text(`no element matches ${selector}`, true) : text(out)
    }
    case 'scroll':
      return text(await evaluate(`(()=>{window.scrollBy(0, ${Number(args['dy'] ?? 500)});return 'scrolled'})()`))
    case 'press':
      // Real key events, not synthesised DOM ones: a page listening for `keydown` on `document`
      // behaves differently for the two, and forms in particular do.
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: String(args['key'] ?? 'Enter') })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: String(args['key'] ?? 'Enter') })
      return text(`pressed ${String(args['key'] ?? 'Enter')}`)
    case 'waitForSelector': {
      const selector = String(args['selector'] ?? '')
      const deadline = Date.now() + Number(args['timeout'] ?? 10_000)
      while (Date.now() < deadline) {
        const found = await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)
        if (found === 'true') return text(`${selector} appeared`)
        await new Promise((r) => setTimeout(r, 200))
      }
      return text(`${selector} did not appear`, true)
    }
    case 'waitForState':
      return text(await evaluate('document.readyState'))
    case 'interactiveElements':
    case 'detectForms':
      return text(
        await evaluate(
          `JSON.stringify([...document.querySelectorAll('a[href],button,input,select,textarea,[role=button]')].slice(0,200).map((e,i)=>({i,tag:e.tagName.toLowerCase(),type:e.type||null,name:e.name||null,id:e.id||null,text:(e.innerText||e.value||e.placeholder||'').trim().slice(0,80)})))`,
        ),
      )
    case 'structuredData':
      return text(
        await evaluate(
          `JSON.stringify([...document.querySelectorAll('script[type="application/ld+json"]')].map(s=>s.textContent))`,
        ),
      )
    case 'getCookies': {
      // Deliberately the protocol rather than `document.cookie`, which cannot see HttpOnly — and an
      // agent that silently got a partial answer would report it as the whole one.
      const r = await cdp.send<{ cookies?: unknown }>('Network.getCookies')
      return text(JSON.stringify(r.cookies ?? []))
    }
    case 'consoleLogs':
      return text(JSON.stringify(cdp.drainEvents().filter((e) => e.method.startsWith('Runtime.consoleAPICalled'))))
    case 'getEnv':
      return text(await evaluate(`JSON.stringify({url:location.href,title:document.title,userAgent:navigator.userAgent})`))
    case 'tree':
    case 'nodeDetails':
    case 'findElement':
      // These are `backendNodeId`-shaped in the original catalog. Answering with a selector-based
      // approximation would hand the model ids that do not mean what it thinks they mean, so they
      // are refused with a pointer to what does work here.
      return text(
        `${name} is not available on the desktop browser — use interactiveElements and drive by CSS selector`,
        true,
      )
    case 'search':
      return text('search is not available on the desktop browser — use goto with a search URL', true)
    default:
      return text(`unknown tool: ${name}`, true)
  }
}
