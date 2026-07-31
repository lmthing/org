/**
 * Turning what the person did in the pane into what the page should receive.
 *
 * Everything here is a pure function of its arguments, which is deliberate: the pane is a picture
 * of a browser, and every one of these translations is a place where a click can land somewhere
 * the person did not point. A coordinate that is off by a scroll offset or a letterbox margin
 * produces no error anywhere — the wrong thing is simply clicked — so the arithmetic is separated
 * out and tested rather than inlined into an event handler.
 */

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface FrameSize {
  width: number
  height: number
}

/** CDP's modifier bitmask. */
export const ALT = 1
export const CTRL = 2
export const META = 4
export const SHIFT = 8

export function modifiersOf(e: {
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}): number {
  return (
    (e.altKey ? ALT : 0) | (e.ctrlKey ? CTRL : 0) | (e.metaKey ? META : 0) | (e.shiftKey ? SHIFT : 0)
  )
}

/**
 * Map a point in the pane onto a point in the page.
 *
 * The frame is drawn letterboxed inside the pane (`object-fit: contain`), so the mapping is a
 * uniform scale plus a centring offset. Both matter: the scale is 1 only while the viewport
 * override and the pane agree about the size, which they do not during a resize, and the offset is
 * non-zero whenever the aspect ratios differ.
 *
 * Returns `null` for a point in the letterbox rather than clamping it to the edge. Clamping would
 * turn "the person clicked the grey margin" into "the person clicked the first pixel of the page",
 * which is a click they did not make.
 */
export function paneToPage(
  clientX: number,
  clientY: number,
  rect: Rect,
  frame: FrameSize,
): { x: number; y: number } | null {
  if (frame.width <= 0 || frame.height <= 0 || rect.width <= 0 || rect.height <= 0) return null
  const scale = Math.min(rect.width / frame.width, rect.height / frame.height)
  const drawnW = frame.width * scale
  const drawnH = frame.height * scale
  const offsetX = (rect.width - drawnW) / 2
  const offsetY = (rect.height - drawnH) / 2
  const x = (clientX - rect.left - offsetX) / scale
  const y = (clientY - rect.top - offsetY) / scale
  if (x < 0 || y < 0 || x > frame.width || y > frame.height) return null
  return { x: Math.round(x), y: Math.round(y) }
}

/** Key codes for the keys a page branches on. Printable characters derive theirs from the text. */
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
  Shift: 16,
  Control: 17,
  Alt: 18,
  Meta: 91,
  ' ': 32,
}

export interface DomKey {
  key: string
  code?: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
}

/**
 * Translate a DOM keyboard event into `Input.dispatchKeyEvent` parameters.
 *
 * The subtle part is `text`. CDP generates a `keypress` — and therefore any character actually
 * appearing in an input — only when `text` is set, and it must be set ONLY for keys that produce a
 * character. Setting it for `ArrowDown` types a character named "ArrowDown" into the focused
 * field; omitting it for `a` moves focus and types nothing. `key.length === 1` is what separates
 * the two, and it is why this is a function with a test rather than three lines in a handler.
 *
 * A modifier held down (`ctrlKey`) also suppresses `text`, so ⌘C and Ctrl+A reach the page as
 * shortcuts instead of inserting a letter.
 */
export function cdpKeyEvent(e: DomKey, type: 'keyDown' | 'keyUp'): Record<string, unknown> {
  const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey
  const vk = KEY_CODES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase().charCodeAt(0) : 0)
  return {
    type,
    key: e.key,
    ...(e.code ? { code: e.code } : {}),
    ...(vk ? { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk } : {}),
    modifiers: modifiersOf(e),
    ...(e.repeat ? { autoRepeat: true } : {}),
    // Enter is a character key for this purpose even though `key` is four letters long: without
    // `text` the page sees no keypress and a form does not submit.
    ...(type === 'keyDown' && printable ? { text: e.key, unmodifiedText: e.key } : {}),
    ...(type === 'keyDown' && e.key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
  }
}

/**
 * Wheel deltas, normalised out of the DOM's three `deltaMode`s.
 *
 * A browser reports scrolling in pixels, lines or pages depending on the device and the platform,
 * and CDP only understands pixels. Forwarding the raw delta makes a line-mode mouse scroll three
 * pixels per notch — which looks exactly like scrolling being broken.
 */
export function wheelDeltas(e: { deltaX: number; deltaY: number; deltaMode?: number }): {
  deltaX: number
  deltaY: number
} {
  const LINE = 16
  const PAGE = 800
  const factor = e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? PAGE : 1
  return { deltaX: e.deltaX * factor, deltaY: e.deltaY * factor }
}

/**
 * What to type into the address bar's request.
 *
 * A person types `example.com`, `localhost:3000` or `how tall is nelson's column` into one box and
 * expects the right thing. Guessing wrong in the "search" direction leaks the text to a search
 * engine; guessing wrong in the "URL" direction produces a DNS error page. The rule here is
 * conservative: anything with a scheme, or a dotted host with no spaces, is a URL; everything else
 * is a search.
 */
export function addressBarUrl(input: string): string {
  const raw = input.trim()
  if (!raw) return 'about:blank'
  // A scheme must be followed by `//`, or be one of the few that legitimately are not. Testing for
  // a bare `word:` instead treats `localhost:3000` as the scheme "localhost" — which the browser
  // cannot resolve, and which no error explains.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(about|data|file|mailto|view-source):/i.test(raw)) {
    return raw
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(raw)
  // `http` for a loopback address, deliberately. A dev server is almost never on TLS, and `https`
  // fails with a protocol error that reads as "the site is down".
  if (local) return `http://${raw}`
  if (!/\s/.test(raw) && /^[^/\s]+\.[a-z]{2,}(:\d+)?(\/|\?|$)/i.test(raw)) return `https://${raw}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`
}
