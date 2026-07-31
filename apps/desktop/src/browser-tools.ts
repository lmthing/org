/**
 * The agent's tool catalogue, expressed against a real browser.
 *
 * Two catalogues arrive here over the same loopback endpoint, and both are dispatched by name:
 *
 * - The **27 `system-browser` functions**, whose descriptions were migrated verbatim from
 *   Lightpanda's catalog. Not one of those files changes; the pod forwards their JSON-RPC body and
 *   this translates it. Where a tool has no faithful expression against Chromium it is REFUSED —
 *   an agent told a tool is unavailable picks another, an agent handed a plausible lie builds on it.
 * - The **`system-desktop-browser` functions**, written for this browser specifically. They are
 *   named differently on purpose (`open` not `goto`, `clickAt` not `click`) because they behave
 *   differently: they drive the tab the person is watching, they click with real input events, and
 *   they can see and switch tabs.
 *
 * ## Real input, not synthesised DOM events
 *
 * `clickAt` moves the mouse and presses it at the element's centre via `Input.dispatchMouseEvent`,
 * rather than calling `element.click()`. Three reasons, in order of weight: a page can distinguish
 * the two and many login and payment flows do; hover and focus states change on the way, which is
 * what makes menus and comboboxes work at all; and the person watching the pane sees the pointer
 * move to the thing that is about to be clicked, which is the difference between watching an agent
 * work and watching a page change by itself.
 */

import type { CdpClient } from './cdp'
import { NAVIGATE_TIMEOUT_MS } from './cdp'

/** The MCP result envelope both catalogues parse. */
function text(s: string, isError = false) {
  return { content: [{ type: 'text', text: s }], isError }
}

/**
 * One query, used by BOTH `elements` and `clickAt`.
 *
 * They must agree exactly: `elements` hands the model an index, and `clickAt` resolves that index
 * by running the same query again. Two selector strings that drifted apart would produce an
 * off-by-one that clicks a neighbouring control — a failure that looks like the model chose wrong.
 */
const INTERACTIVE = 'a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[onclick]'

const MAX_ELEMENTS = 200

export interface ToolResult {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

export async function callTool(
  cdp: CdpClient,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const evaluate = async (expression: string): Promise<string> => {
    const r = await cdp.send<{ result?: { value?: unknown }; exceptionDetails?: { text?: string } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
    )
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'evaluation failed')
    const v = r.result?.value
    return typeof v === 'string' ? v : JSON.stringify(v ?? null)
  }

  const navigate = async (url: string): Promise<string> => {
    await cdp.send('Page.enable')
    await cdp.send('Page.navigate', { url }, NAVIGATE_TIMEOUT_MS)
    // Settle before answering: returning the instant `Page.navigate` resolves would hand the next
    // tool an empty document, which reads as "the page was blank".
    await waitForReady(evaluate, 10_000)
    return evaluate('JSON.stringify({url:location.href,title:document.title})')
  }

  switch (name) {
    // ---------------------------------------------------------------- desktop-browser catalogue
    case 'open':
      return text(await navigate(String(args['url'] ?? '')))
    case 'page':
      return text(
        await evaluate(
          `JSON.stringify({url:location.href,title:document.title,readyState:document.readyState,scrollY:Math.round(scrollY),scrollHeight:document.documentElement.scrollHeight})`,
        ),
      )
    case 'readText':
      return text(await evaluate('document.body ? document.body.innerText : ""'))
    case 'readHtml':
      return text(await evaluate('document.documentElement.outerHTML'))
    case 'elements':
      return text(await listElements(evaluate, String(args['containing'] ?? '')))
    case 'clickAt':
      return clickElement(cdp, evaluate, args)
    case 'typeText':
      return typeInto(cdp, evaluate, args)
    case 'pressKey': {
      const key = String(args['key'] ?? 'Enter')
      await dispatchKey(cdp, key)
      return text(`pressed ${key}`)
    }
    case 'scrollBy': {
      const dy = Number(args['dy'] ?? 600)
      return text(await evaluate(`(()=>{scrollBy(0,${dy});return 'scrollY '+Math.round(scrollY)})()`))
    }
    case 'back':
    case 'forward': {
      // The history entry list, rather than `history.back()`: a page can trap the latter, and the
      // protocol's own answer tells us whether there was anywhere to go.
      const h = await cdp.send<{ currentIndex: number; entries: Array<{ id: number }> }>(
        'Page.getNavigationHistory',
      )
      const want = h.currentIndex + (name === 'back' ? -1 : 1)
      const entry = h.entries[want]
      if (!entry) return text(`no page to go ${name === 'back' ? 'back' : 'forward'} to`, true)
      await cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id })
      await waitForReady(evaluate, 10_000)
      return text(await evaluate('JSON.stringify({url:location.href,title:document.title})'))
    }
    case 'reloadPage':
      await cdp.send('Page.reload', {})
      await waitForReady(evaluate, 10_000)
      return text(await evaluate('location.href'))
    case 'listTabs': {
      const tabs = await cdp.tabs()
      const current = cdp.currentTarget()
      return text(JSON.stringify(tabs.map((t) => ({ ...t, current: t.targetId === current }))))
    }
    case 'openTab': {
      const id = await cdp.newTab(String(args['url'] ?? 'about:blank'))
      await cdp.attachTo(id)
      await waitForReady(evaluate, 10_000)
      return text(`opened ${id}`)
    }
    case 'useTab': {
      const id = String(args['targetId'] ?? '')
      const tabs = await cdp.tabs()
      if (!tabs.some((t) => t.targetId === id)) return text(`no tab ${id} — call listTabs first`, true)
      await cdp.attachTo(id)
      return text(await evaluate('JSON.stringify({url:location.href,title:document.title})'))
    }
    case 'closeTab': {
      const id = String(args['targetId'] ?? cdp.currentTarget() ?? '')
      if (!id) return text('no tab to close', true)
      await cdp.closeTab(id)
      return text(`closed ${id}`)
    }
    case 'waitFor': {
      const selector = String(args['selector'] ?? '')
      const timeout = Number(args['timeout'] ?? 10_000)
      if (!selector) return text(await waitForReady(evaluate, timeout))
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        if ((await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) === 'true') {
          return text(`${selector} appeared`)
        }
        await sleep(150)
      }
      return text(`${selector} did not appear within ${Math.round(timeout / 1000)}s`, true)
    }

    // ------------------------------------------------------------ the 27 system-browser wrappers
    case 'goto':
      return text(`navigated to ${String(args['url'] ?? '')} — ${await navigate(String(args['url'] ?? ''))}`)
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
      if (name === 'click') return clickElement(cdp, evaluate, { selector })
      if (name === 'fill') return typeInto(cdp, evaluate, { selector, text: args['value'] ?? args['text'] ?? '' })
      const js =
        name === 'setChecked'
          ? `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'not found';e.checked=${args['checked'] === false ? 'false' : 'true'};e.dispatchEvent(new Event('change',{bubbles:true}));return 'set'})()`
          : name === 'selectOption'
            ? `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'not found';e.value=${JSON.stringify(String(args['value'] ?? ''))};e.dispatchEvent(new Event('change',{bubbles:true}));return 'selected'})()`
            : `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'not found';e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return 'hovered'})()`
      const out = await evaluate(js)
      return out === 'not found' ? text(`no element matches ${selector}`, true) : text(out)
    }
    case 'scroll':
      return text(await evaluate(`(()=>{window.scrollBy(0, ${Number(args['dy'] ?? 500)});return 'scrolled'})()`))
    case 'press':
      await dispatchKey(cdp, String(args['key'] ?? 'Enter'))
      return text(`pressed ${String(args['key'] ?? 'Enter')}`)
    case 'waitForSelector': {
      const selector = String(args['selector'] ?? '')
      const deadline = Date.now() + Number(args['timeout'] ?? 10_000)
      while (Date.now() < deadline) {
        if ((await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) === 'true') {
          return text(`${selector} appeared`)
        }
        await sleep(200)
      }
      return text(`${selector} did not appear`, true)
    }
    case 'waitForState':
      return text(await evaluate('document.readyState'))
    case 'interactiveElements':
    case 'detectForms':
      return text(await listElements(evaluate, ''))
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
      return text(
        await evaluate(`JSON.stringify({url:location.href,title:document.title,userAgent:navigator.userAgent})`),
      )
    case 'tree':
    case 'nodeDetails':
    case 'findElement':
      // These are `backendNodeId`-shaped in the original catalog. Answering with a selector-based
      // approximation would hand the model ids that do not mean what it thinks they mean, so they
      // are refused with a pointer to what does work here.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll `document.readyState` rather than trusting a fixed delay after navigation. */
async function waitForReady(evaluate: (e: string) => Promise<string>, timeout: number): Promise<string> {
  const deadline = Date.now() + timeout
  let state = 'loading'
  while (Date.now() < deadline) {
    state = await evaluate('document.readyState').catch(() => 'loading')
    if (state === 'complete' || state === 'interactive') return state
    await sleep(100)
  }
  return state
}

/**
 * The interactive elements of the page, with the index `clickAt` accepts.
 *
 * `box` is included because it is what makes a real click possible, and `visible` because an agent
 * that clicks a `display:none` element gets no error from anything — the click simply lands on
 * whatever is behind it.
 */
async function listElements(evaluate: (e: string) => Promise<string>, containing: string): Promise<string> {
  const filter = containing
    ? `.filter(e=>((e.innerText||e.value||e.placeholder||e.getAttribute('aria-label')||'')).toLowerCase().includes(${JSON.stringify(containing.toLowerCase())}))`
    : ''
  return evaluate(
    `JSON.stringify([...document.querySelectorAll(${JSON.stringify(INTERACTIVE)})]${filter}.slice(0,${MAX_ELEMENTS}).map((e,i)=>{const r=e.getBoundingClientRect();return{i,tag:e.tagName.toLowerCase(),type:e.getAttribute('type'),name:e.getAttribute('name'),id:e.id||null,text:((e.innerText||e.value||e.placeholder||e.getAttribute('aria-label')||'')+'').trim().slice(0,80),visible:r.width>0&&r.height>0,box:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}}}))`,
  )
}

/**
 * Locate an element by index or selector and return its centre in viewport coordinates.
 *
 * Scrolls it into view first: a click at a negative `y` is dispatched into the void and reports
 * success, which is the worst possible outcome — the agent believes it clicked.
 */
async function centreOf(
  evaluate: (e: string) => Promise<string>,
  args: Record<string, unknown>,
): Promise<{ x: number; y: number } | { error: string }> {
  const selector = args['selector'] ? String(args['selector']) : ''
  const index = args['index'] !== undefined ? Number(args['index']) : null
  const locator = selector
    ? `document.querySelector(${JSON.stringify(selector)})`
    : `[...document.querySelectorAll(${JSON.stringify(INTERACTIVE)})][${index ?? 0}]`
  const raw = await evaluate(
    `(()=>{const e=${locator};if(!e)return JSON.stringify({error:'not found'});e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();if(r.width===0||r.height===0)return JSON.stringify({error:'element is not visible'});return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()`,
  )
  return JSON.parse(raw) as { x: number; y: number } | { error: string }
}

async function clickElement(
  cdp: CdpClient,
  evaluate: (e: string) => Promise<string>,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const at = await centreOf(evaluate, args)
  if ('error' in at) {
    const what = args['selector'] ? String(args['selector']) : `index ${String(args['index'])}`
    return text(`${what}: ${at.error}`, true)
  }
  const before = await evaluate('location.href')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none' })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: at.x,
    y: at.y,
    button: 'left',
    clickCount: 1,
    buttons: 1,
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: at.x,
    y: at.y,
    button: 'left',
    clickCount: 1,
    buttons: 0,
  })
  // A click that navigates is the common case and the one worth reporting, so the agent does not
  // have to guess whether to re-read the page.
  await sleep(400)
  const after = await evaluate('location.href').catch(() => before)
  return text(after === before ? `clicked at ${at.x},${at.y}` : `clicked — now at ${after}`)
}

/**
 * Type into an element with real key events.
 *
 * `Input.insertText` would be one call and is what a naive implementation reaches for, but it
 * produces no `keydown`, so search boxes that open a suggestion list, forms that validate as you
 * type, and anything driven by a key handler simply do not react.
 */
async function typeInto(
  cdp: CdpClient,
  evaluate: (e: string) => Promise<string>,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const value = String(args['text'] ?? args['value'] ?? '')
  if (args['selector'] !== undefined || args['index'] !== undefined) {
    const at = await centreOf(evaluate, args)
    if ('error' in at) {
      const what = args['selector'] ? String(args['selector']) : `index ${String(args['index'])}`
      return text(`${what}: ${at.error}`, true)
    }
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: at.x,
      y: at.y,
      button: 'left',
      clickCount: 1,
      buttons: 1,
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: at.x,
      y: at.y,
      button: 'left',
      clickCount: 1,
      buttons: 0,
    })
    if (args['clear'] !== false) {
      // Select-all then type replaces rather than appends. Without it, typing into a field that
      // already holds a value silently produces a concatenation.
      await evaluate(
        `(()=>{const e=document.activeElement;if(e&&('value' in e))e.select&&e.select();return 'ok'})()`,
      )
    }
  }
  for (const ch of value) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
  }
  if (args['submit'] === true) await dispatchKey(cdp, 'Enter')
  const where = await evaluate('location.href')
  return text(`typed ${value.length} characters${args['submit'] === true ? ' and submitted' : ''} — at ${where}`)
}

/** Key codes for the non-printable keys a page actually branches on. */
const KEY_CODES: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Backspace: 8,
  Delete: 46,
  Escape: 27,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
}

async function dispatchKey(cdp: CdpClient, key: string): Promise<void> {
  const code = KEY_CODES[key]
  const base: Record<string, unknown> = {
    key,
    ...(code ? { windowsVirtualKeyCode: code, nativeVirtualKeyCode: code } : {}),
    // Enter is the one key where a missing `text` changes behaviour: without it a form does not
    // submit, because the page never sees a keypress.
    ...(key === 'Enter' ? { text: '\r' } : {}),
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}
