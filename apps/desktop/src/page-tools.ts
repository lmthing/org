/**
 * The agent's tool catalogue, expressed against the webview pane.
 *
 * Two catalogues arrive here over the same loopback endpoint and both are dispatched by name:
 *
 * - The **27 `system-browser` functions**, whose descriptions were migrated verbatim from
 *   Lightpanda's catalog. Not one of those files changes; the pod forwards their JSON-RPC body and
 *   this translates it. Where a tool has no faithful expression here it is REFUSED — an agent told
 *   a tool is unavailable picks another; an agent handed a plausible lie builds on it.
 * - The **`system-desktop-browser` functions**, written for this browser specifically. Named
 *   differently on purpose (`open` not `goto`, `clickAt` not `click`) because they behave
 *   differently: they drive the page the person is actually looking at.
 *
 * ## What replaced CDP, and what that costs
 *
 * This used to drive a headless Chromium over the DevTools Protocol. The pane is now a real
 * webview (see `WebviewPane.tsx`), and only WebView2 speaks CDP — WKWebView and WebKitGTK do not.
 * So every operation here is JavaScript evaluated in the page.
 *
 * Reading is unaffected: `innerText`, `querySelectorAll` and `location` are the same facts however
 * you reach them. **Acting is genuinely weaker**, and the honest list is short enough to state:
 *
 * - A dispatched `click()` is not an OS-level mouse press. Most pages cannot tell; some payment
 *   and login flows can, and bot checks are designed to.
 * - There is no pointer to watch move across the page, so the person sees the result rather than
 *   the intent.
 * - `KeyboardEvent` is not a real key press, which is why `key` special-cases submitting a form.
 *
 * Every one of those is a case where the person is sitting in front of the page and can do it
 * themselves, which is the argument for the trade rather than an excuse for it.
 */

/** What this module needs from the host. Small on purpose — it is the whole testing seam. */
export interface PageDriver {
  /** Evaluate an expression in the page and return its JSON value as a string. */
  evaluate(expression: string): Promise<string>
  /** Navigate the pane and resolve once the document is usable. */
  navigate(url: string): Promise<void>
  /** The pane's current URL, from the host rather than the page. */
  currentUrl(): Promise<string>
}

/** The MCP result envelope both catalogues parse. */
function text(s: string, isError = false) {
  return { content: [{ type: 'text', text: s }], isError }
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

const MAX_ELEMENTS = 200
const READY_TIMEOUT_MS = 10_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Call into the injected helper, which owns the definition of "the elements on this page". */
function helper(call: string): string {
  // The guard matters: the script is injected before page scripts on every navigation, but a
  // request can still land in the gap between a navigation starting and the new document existing.
  // Without it the failure is `undefined is not an object`, which says nothing about timing.
  return `JSON.stringify(window.__lmthing ? window.__lmthing.${call} : {error:'the page is still loading'})`
}

export async function callTool(
  page: PageDriver,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const { evaluate } = page
  const ev = (e: string) => page.evaluate(e)

  const navigated = async (url: string): Promise<string> => {
    await page.navigate(url)
    await waitForReady(ev, READY_TIMEOUT_MS)
    return ev(`JSON.stringify({url:location.href,title:document.title})`)
  }

  void evaluate

  // `url` means "go there first, then do this" — for EVERY tool that takes one, not just `goto`.
  //
  // Dropping it is the worst bug this file can have, and it is silent: asked to read
  // `markdown({url: 'https://www.google.com'})`, an implementation that ignores the argument reads
  // whatever page happens to be loaded and returns it as the answer. It happened. The model was
  // handed the default landing page, noticed the mismatch, and explained it away as a privacy
  // extension redirecting Google — a completely coherent story about something that never occurred.
  // Nothing anywhere reported an error, because from the DOM's point of view nothing went wrong.
  const wantedUrl = typeof args['url'] === 'string' ? String(args['url']).trim() : ''
  if (wantedUrl && name !== 'open' && name !== 'goto') {
    const here = await ev('location.href')
    if (!sameTarget(here, wantedUrl)) await navigated(wantedUrl)
  }

  switch (name) {
    // ---------------------------------------------------------------- desktop-browser catalogue
    case 'open':
      return text(await navigated(String(args['url'] ?? '')))
    case 'page':
      return text(await ev(helper('info()')))
    case 'readText':
      return text(await ev(helper(`text(${Number(args['max'] ?? 40000)})`)))
    case 'readHtml':
      return text(await ev('document.documentElement.outerHTML'))
    case 'elements':
      return text(await listElements(ev, String(args['containing'] ?? '')))
    case 'clickAt': {
      const index = await resolveIndex(ev, args)
      if (index === null) return text('clickAt needs an index or a selector', true)
      return text(await ev(helper(`click(${index})`)))
    }
    case 'typeText': {
      const index = await resolveIndex(ev, args)
      if (index === null) return text('typeText needs an index or a selector', true)
      const value = String(args['text'] ?? args['value'] ?? '')
      return text(await ev(helper(`type(${index},${JSON.stringify(value)})`)))
    }
    case 'pressKey':
    case 'press': {
      const key = String(args['key'] ?? 'Enter')
      const out = await ev(helper(`key(${JSON.stringify(key)})`))
      // Enter usually means "submit", and a submit navigates. Answering before the new document
      // exists hands the next tool the OLD page and reads as the form having done nothing.
      if (key === 'Enter') await waitForReady(ev, READY_TIMEOUT_MS)
      return text(out)
    }
    case 'scrollBy':
    case 'scroll':
      return text(await ev(helper(`scrollBy(${Number(args['dy'] ?? 600)})`)))
    case 'back':
    case 'forward': {
      // `history.back()` rather than the protocol's entry list, which no longer exists here. A page
      // CAN trap this, so the answer is derived from whether the URL actually changed rather than
      // from the call returning.
      const before = await ev('location.href')
      await ev(`history.${name === 'back' ? 'back' : 'forward'}()`)
      await sleep(300)
      await waitForReady(ev, READY_TIMEOUT_MS)
      const after = await ev('location.href')
      if (after === before) {
        return text(`no page to go ${name} to (or the page blocked it)`, true)
      }
      return text(await ev(`JSON.stringify({url:location.href,title:document.title})`))
    }
    case 'reloadPage':
      await ev('location.reload()')
      await sleep(300)
      await waitForReady(ev, READY_TIMEOUT_MS)
      return text(await ev('location.href'))

    // Tabs. The pane is ONE webview, so there is exactly one page and saying otherwise would be a
    // lie the model would then build a plan on. `listTabs` answers truthfully with the one; the
    // rest are refused with what to do instead.
    case 'listTabs':
      return text(
        JSON.stringify([
          { targetId: 'pane', url: await page.currentUrl(), current: true },
        ]),
      )
    case 'openTab':
    case 'useTab':
    case 'closeTab':
      return text(
        `${name} is not available — the desktop browser pane shows one page at a time. Use open to go somewhere else.`,
        true,
      )

    case 'waitFor':
    case 'waitForSelector': {
      const selector = String(args['selector'] ?? '')
      const timeout = Number(args['timeout'] ?? READY_TIMEOUT_MS)
      if (!selector) return text(await waitForReady(ev, timeout))
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        if ((await ev(`!!document.querySelector(${JSON.stringify(selector)})`)) === 'true') {
          return text(`${selector} appeared`)
        }
        await sleep(150)
      }
      return text(`${selector} did not appear within ${Math.round(timeout / 1000)}s`, true)
    }

    // ------------------------------------------------------------ the 27 system-browser wrappers
    case 'goto':
      return text(`navigated to ${String(args['url'] ?? '')} — ${await navigated(String(args['url'] ?? ''))}`)
    case 'getUrl':
      return text(await ev('location.href'))
    case 'html': {
      const selector = String(args['selector'] ?? '')
      if (!selector) return text(await ev('document.documentElement.outerHTML'))
      const out = await ev(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});` +
          `return e?e.outerHTML:'\u0000notfound'})()`,
      )
      return out === '\u0000notfound' ? text(`no element matches ${selector}`, true) : text(out)
    }
    case 'markdown':
    case 'extract': {
      // `innerText` rather than a markdown conversion: it is what the person sees, already free of
      // script and style, and a second HTML→markdown implementation here would diverge from
      // `webFetch`'s.
      //
      // `selector` is honoured for the same reason `url` is: asked for one part of a page and
      // handed the whole thing, a model has no way to tell it was not answered.
      const max = Number(args['maxBytes'] ?? 40000)
      const selector = String(args['selector'] ?? '')
      if (!selector) return text(await ev(helper(`text(${max})`)))
      const out = await ev(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});` +
          `return e?e.innerText.slice(0,${max}):'\u0000notfound'})()`,
      )
      return out === '\u0000notfound' ? text(`no element matches ${selector}`, true) : text(out)
    }
    case 'links':
      return text(
        await ev(
          `JSON.stringify([...document.querySelectorAll('a[href]')].slice(0,300).map(a=>({text:a.innerText.trim().slice(0,120),href:a.href})))`,
        ),
      )
    case 'evaluate':
      return text(await ev(String(args['expression'] ?? args['script'] ?? '')))
    case 'click':
    case 'hover':
    case 'setChecked':
    case 'selectOption':
    case 'fill': {
      const selector = String(args['selector'] ?? '')
      if (!selector) return text('this browser requires a CSS selector', true)
      const q = JSON.stringify(selector)
      const js =
        name === 'click'
          ? `(()=>{const e=document.querySelector(${q});if(!e)return 'not found';e.scrollIntoView({block:'center'});e.focus&&e.focus();e.click();return 'clicked'})()`
          : name === 'fill'
            ? `(()=>{const e=document.querySelector(${q});if(!e)return 'not found';const i=[...document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[onclick],[contenteditable="true"]')].indexOf(e);return i<0?'not found':JSON.stringify(window.__lmthing.type(i,${JSON.stringify(String(args['value'] ?? args['text'] ?? ''))}))})()`
            : name === 'setChecked'
              ? `(()=>{const e=document.querySelector(${q});if(!e)return 'not found';e.checked=${args['checked'] === false ? 'false' : 'true'};e.dispatchEvent(new Event('change',{bubbles:true}));return 'set'})()`
              : name === 'selectOption'
                ? `(()=>{const e=document.querySelector(${q});if(!e)return 'not found';e.value=${JSON.stringify(String(args['value'] ?? ''))};e.dispatchEvent(new Event('change',{bubbles:true}));return 'selected'})()`
                : `(()=>{const e=document.querySelector(${q});if(!e)return 'not found';e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return 'hovered'})()`
      const out = await ev(js)
      return out === 'not found' || out === '"not found"'
        ? text(`no element matches ${selector}`, true)
        : text(out)
    }
    case 'waitForState':
      return text(await ev('document.readyState'))
    case 'interactiveElements':
    case 'detectForms':
      return text(await listElements(ev, ''))
    case 'structuredData':
      return text(
        await ev(
          `JSON.stringify([...document.querySelectorAll('script[type="application/ld+json"]')].map(s=>s.textContent))`,
        ),
      )
    case 'getCookies':
      // `document.cookie` cannot see HttpOnly, and CDP's `Network.getCookies` — which could — is
      // gone with the protocol. The shortfall is STATED rather than left implicit: an agent handed
      // a partial answer with no note reports it as the whole one, and session cookies are exactly
      // the ones that are HttpOnly.
      return text(
        JSON.stringify({
          cookies: JSON.parse(await ev('JSON.stringify(document.cookie)')),
          note: 'document.cookie only — HttpOnly cookies are not visible to this browser',
        }),
      )
    case 'consoleLogs':
      return text(await ev(helper('logs()')))
    case 'getEnv':
      return text(
        await ev(`JSON.stringify({url:location.href,title:document.title,userAgent:navigator.userAgent})`),
      )
    case 'tree':
    case 'nodeDetails':
    case 'findElement':
      // `backendNodeId`-shaped in the original catalog, and that id space does not exist here.
      // Answering with a selector-based approximation would hand the model ids that do not mean
      // what it thinks they mean.
      return text(
        `${name} is not available on the desktop browser — use elements and drive by index or CSS selector`,
        true,
      )
    case 'waitForScript':
      return text('waitForScript is not available on the desktop browser — use waitFor', true)
    case 'search':
      return text('search is not available on the desktop browser — use open with a search URL', true)
    default:
      return text(`unknown tool: ${name}`, true)
  }
}

/**
 * Is the page already where the caller wants it?
 *
 * Compared loosely on purpose. A site answers `https://example.com` at `https://example.com/`, and
 * often at `https://www.example.com/` — treating those as different means a redundant navigation
 * that throws away the page state the previous call just built up. Anything beyond host and path
 * (a query, a fragment) is a real difference and is not smoothed over.
 */
export function sameTarget(here: string, wanted: string): boolean {
  const norm = (raw: string): string | null => {
    try {
      const u = new URL(raw.includes('://') ? raw : `https://${raw}`)
      const host = u.host.replace(/^www\./, '')
      const path = u.pathname.replace(/\/$/, '')
      return `${host}${path}${u.search}`
    } catch {
      return null
    }
  }
  const a = norm(here)
  const b = norm(wanted)
  return a !== null && b !== null && a === b
}

/** Poll `document.readyState` rather than trusting a fixed delay after navigation. */
async function waitForReady(ev: (e: string) => Promise<string>, timeout: number): Promise<string> {
  const deadline = Date.now() + timeout
  let state = 'loading'
  while (Date.now() < deadline) {
    state = (await ev('document.readyState').catch(() => 'loading')).replace(/"/g, '')
    if (state === 'complete' || state === 'interactive') return state
    await sleep(100)
  }
  return state
}

/**
 * The interactive elements of the page, with the index the action tools accept.
 *
 * The list comes from the injected helper rather than being queried here, and that is the whole
 * point: `elements` hands the model an index and `clickAt` resolves that index by asking for the
 * list again. Two definitions of "the elements on this page" that drifted apart would produce an
 * off-by-one that clicks a neighbouring control — a failure that looks like the model choosing
 * wrong rather than like a bug.
 */
async function listElements(ev: (e: string) => Promise<string>, containing: string): Promise<string> {
  const raw = await ev(helper('elements()'))
  let list: Array<{ i: number; label?: string }> = []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) list = parsed as typeof list
  } catch {
    return raw
  }
  const needle = containing.trim().toLowerCase()
  const filtered = needle
    ? list.filter((e) => (e.label ?? '').toLowerCase().includes(needle))
    : list
  return JSON.stringify(filtered.slice(0, MAX_ELEMENTS))
}

/**
 * Accept either an index or a CSS selector, because both catalogues reach these.
 *
 * The desktop functions pass an index from `elements`; the Lightpanda-shaped ones pass a selector.
 * Resolving a selector to an index — against the SAME list the helper builds — is what lets one
 * implementation serve both without either meaning something slightly different by "this element".
 */
async function resolveIndex(
  ev: (e: string) => Promise<string>,
  args: Record<string, unknown>,
): Promise<number | null> {
  if (args['index'] !== undefined && args['index'] !== null) return Number(args['index'])
  const selector = String(args['selector'] ?? '')
  if (!selector) return null
  const raw = await ev(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return -1;` +
      `return [...document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[onclick],[contenteditable="true"]')].indexOf(e)})()`,
  )
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}
