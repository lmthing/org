import { describe, it, expect } from 'vitest'
import { addressBarUrl, cdpKeyEvent, modifiersOf, paneToPage, wheelDeltas, SHIFT, CTRL } from './browser-input'

/**
 * The pane is a picture of a browser. Everything here decides where a real click lands on the real
 * page — and every one of these translations fails SILENTLY when it is wrong: the wrong element is
 * clicked, or a character nobody pressed is typed. There is no exception to catch and nothing in a
 * log. That is why the arithmetic lives in pure functions with a suite instead of inside an event
 * handler.
 */

const RECT = { left: 100, top: 50, width: 800, height: 600 }

describe('mapping a click in the pane onto the page', () => {
  it('is the identity when the frame and the pane are the same size', () => {
    expect(paneToPage(100, 50, RECT, { width: 800, height: 600 })).toEqual({ x: 0, y: 0 })
    expect(paneToPage(500, 350, RECT, { width: 800, height: 600 })).toEqual({ x: 400, y: 300 })
  })

  it('scales when the frame is larger than the pane', () => {
    // A frame arriving from before the last resize. Ignoring the scale would put every click at
    // half its true depth into the page — near the top of a long document, which is exactly where
    // most navigation lives, so it would often click SOMETHING and look like a model mistake.
    const at = paneToPage(500, 350, RECT, { width: 1600, height: 1200 })
    expect(at).toEqual({ x: 800, y: 600 })
  })

  it('accounts for the letterbox when the aspect ratios differ', () => {
    // A 800×200 frame inside an 800×600 pane is drawn as a band with 200px of margin above it.
    // Without the offset, a click on the first row of the page would be reported 200px too low.
    const frame = { width: 800, height: 200 }
    expect(paneToPage(100, 250, RECT, frame)).toEqual({ x: 0, y: 0 })
    expect(paneToPage(900, 450, RECT, frame)).toEqual({ x: 800, y: 200 })
  })

  it('refuses a point in the letterbox rather than clamping it', () => {
    // Clamping would turn "the person clicked the grey margin" into "the person clicked the first
    // pixel of the page" — a click they did not make, on an element they cannot see.
    expect(paneToPage(100, 60, RECT, { width: 800, height: 200 })).toBeNull()
    expect(paneToPage(0, 0, RECT, { width: 800, height: 600 })).toBeNull()
  })

  it('refuses to divide by a frame that has no size', () => {
    expect(paneToPage(200, 200, RECT, { width: 0, height: 0 })).toBeNull()
    expect(paneToPage(200, 200, { ...RECT, width: 0 }, { width: 800, height: 600 })).toBeNull()
  })
})

describe('turning a DOM key event into a CDP one', () => {
  it('sets text for a character key, so something is actually typed', () => {
    // CDP generates a keypress — and therefore any character appearing in an input — only when
    // `text` is set. Without it the key moves focus and types nothing.
    const down = cdpKeyEvent({ key: 'a' }, 'keyDown')
    expect(down['text']).toBe('a')
    expect(down['windowsVirtualKeyCode']).toBe(65)
  })

  it('does NOT set text for a named key', () => {
    // The bug this prevents is specific and absurd: setting `text` for ArrowDown types the literal
    // string "ArrowDown" into whatever field has focus.
    expect(cdpKeyEvent({ key: 'ArrowDown' }, 'keyDown')['text']).toBeUndefined()
    expect(cdpKeyEvent({ key: 'Escape' }, 'keyDown')['text']).toBeUndefined()
  })

  it('gives Enter a carriage return, because a form will not submit without one', () => {
    expect(cdpKeyEvent({ key: 'Enter' }, 'keyDown')['text']).toBe('\r')
    expect(cdpKeyEvent({ key: 'Enter' }, 'keyDown')['windowsVirtualKeyCode']).toBe(13)
  })

  it('suppresses text when a command modifier is held', () => {
    // Otherwise ⌘C and Ctrl+A insert a letter instead of reaching the page as a shortcut — which
    // on Ctrl+A means replacing the person's selection with the letter "a".
    expect(cdpKeyEvent({ key: 'c', metaKey: true }, 'keyDown')['text']).toBeUndefined()
    expect(cdpKeyEvent({ key: 'a', ctrlKey: true }, 'keyDown')['text']).toBeUndefined()
    // Shift is NOT a command modifier — a capital letter must still be typed.
    expect(cdpKeyEvent({ key: 'A', shiftKey: true }, 'keyDown')['text']).toBe('A')
  })

  it('never sets text on the way up', () => {
    expect(cdpKeyEvent({ key: 'a' }, 'keyUp')['text']).toBeUndefined()
    expect(cdpKeyEvent({ key: 'Enter' }, 'keyUp')['text']).toBeUndefined()
  })

  it('packs the modifier bitmask CDP expects', () => {
    expect(modifiersOf({})).toBe(0)
    expect(modifiersOf({ shiftKey: true })).toBe(SHIFT)
    expect(modifiersOf({ shiftKey: true, ctrlKey: true })).toBe(SHIFT | CTRL)
  })
})

describe('normalising wheel deltas', () => {
  it('passes pixel scrolling through untouched', () => {
    expect(wheelDeltas({ deltaX: 0, deltaY: 120, deltaMode: 0 })).toEqual({ deltaX: 0, deltaY: 120 })
  })

  it('converts line and page modes, which CDP does not understand', () => {
    // A line-mode mouse reports deltaY: 3. Forwarded raw, one notch of the wheel scrolls three
    // pixels — which reads as scrolling being broken rather than as a unit mismatch.
    expect(wheelDeltas({ deltaX: 0, deltaY: 3, deltaMode: 1 }).deltaY).toBe(48)
    expect(wheelDeltas({ deltaX: 0, deltaY: 1, deltaMode: 2 }).deltaY).toBe(800)
  })
})

describe('what the address bar does with what was typed', () => {
  it('keeps anything with a scheme verbatim', () => {
    expect(addressBarUrl('https://example.com/a?b=c')).toBe('https://example.com/a?b=c')
    expect(addressBarUrl('about:blank')).toBe('about:blank')
    expect(addressBarUrl('file:///tmp/x.html')).toBe('file:///tmp/x.html')
  })

  it('treats a bare host as a URL', () => {
    expect(addressBarUrl('example.com')).toBe('https://example.com')
    expect(addressBarUrl('example.com/path')).toBe('https://example.com/path')
    expect(addressBarUrl('example.com:8080/x')).toBe('https://example.com:8080/x')
  })

  it('does not read a port as a scheme', () => {
    // `localhost:3000` matches "word, colon" exactly as `https:` does. Treated as a scheme it goes
    // to the browser as the protocol "localhost", which fails with an error naming nothing useful.
    expect(addressBarUrl('localhost:3000')).toBe('http://localhost:3000')
    expect(addressBarUrl('127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x')
  })

  it('uses http for loopback, because a dev server is not on TLS', () => {
    expect(addressBarUrl('localhost')).toBe('http://localhost')
  })

  it('searches for anything else', () => {
    // The failure that matters is the other direction: guessing "URL" for a phrase produces a DNS
    // error page, but guessing "search" for something private sends it to a search engine. So the
    // host test is deliberately strict — a space anywhere means it is not a URL.
    expect(addressBarUrl('how tall is nelsons column')).toContain('duckduckgo.com')
    expect(addressBarUrl('my bank account number')).toContain('duckduckgo.com')
    expect(addressBarUrl('example com')).toContain('duckduckgo.com')
  })

  it('does not navigate anywhere on empty input', () => {
    expect(addressBarUrl('   ')).toBe('about:blank')
  })
})
