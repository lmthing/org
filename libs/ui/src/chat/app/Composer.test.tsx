import { render, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TamaguiProvider } from '@tamagui/core'
import { tamaguiWebConfig } from '../../theme/tamagui.config'
import { Composer } from './Composer'

/**
 * The composer's one-line ⇄ stacked arrangement.
 *
 * The bug these pin is a RECONCILIATION bug, not a styling one, which is why it is asserted on the
 * DOM node's IDENTITY rather than on anything you can see. The two arrangements were written as
 * two branches — `<>{field}<Row/></>` against `<Row>…{field}…</Row>` — which put the field under a
 * different parent in each. React reconciles by position and a `key` only disambiguates siblings,
 * so crossing that boundary remounts the input however it is keyed. On web that silently loses the
 * caret; on a phone the native `TextInput` is destroyed and THE KEYBOARD CLOSES, mid-sentence,
 * the moment a message grows past one line.
 *
 * jsdom can prove this because the reconciler is the same on both targets — a parent change
 * remounts everywhere. What jsdom cannot see is the consequence (there is no keyboard), so the
 * assertion is the cause: same element object before and after.
 */
const P = ({ children }: { children: React.ReactNode }) => (
  <TamaguiProvider config={tamaguiWebConfig} defaultTheme="app">
    {children}
  </TamaguiProvider>
)

/**
 * `scrollHeight` is how the web half measures wrapped text, and jsdom lays nothing out — it is a
 * hard 0 for every element. Driving it directly is the only way to reach the stacked arrangement
 * here, and it is exactly what a browser would report.
 */
let scrollHeight = 20
const originalScrollHeight = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  'scrollHeight',
)

describe('Composer — growing past one line', () => {
  beforeEach(() => {
    scrollHeight = 20
    Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
  })
  afterEach(() => {
    if (originalScrollHeight) {
      Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', originalScrollHeight)
    }
    vi.unstubAllGlobals()
  })

  /** Type `value`, reporting `height` as the content height a browser would have measured. */
  const type = (field: HTMLTextAreaElement, value: string, height: number) => {
    scrollHeight = height
    act(() => {
      fireEvent.change(field, { target: { value } })
    })
  }

  /**
   * ONE_LINE and TWO_LINES are deliberately not the numbers a web textarea reports. The composer
   * learns the height of one line from the measurements themselves, so a suite that fed it the
   * web's own figures would only prove it against the target that never had the problem — an
   * Android `TextInput` reports its own padding on top and can exceed the old fixed 28px threshold
   * with a single character in the box.
   */
  const ONE_LINE = 33
  const TWO_LINES = 66

  /** Mount, and let the composer see one line before anything wraps — as a real session does. */
  const mount = () => {
    const view = render(
      <P>
        <Composer onSend={() => {}} />
      </P>,
    )
    const field = view.container.querySelector('textarea')!
    expect(field).toBeTruthy()
    type(field, 'a', ONE_LINE)
    return { ...view, field }
  }

  const sendButton = (container: HTMLElement) =>
    container.querySelector('[aria-label="Send message"]')!

  it('keeps the SAME input element when the message wraps', () => {
    const { container, field } = mount()

    type(field, 'a message long enough to occupy two full lines of the composer', TWO_LINES)

    // It really did stack — otherwise this asserts nothing.
    expect(field.parentElement?.contains(sendButton(container))).toBe(false)
    // And it is the same object, not merely an element that looks the same. A remount would put a
    // NEW textarea here, which is the keyboard dismissal expressed in the only terms jsdom has.
    expect(container.querySelector('textarea')).toBe(field)
  })

  it('keeps the SAME input element across a wrap and back to empty', () => {
    const { container, field } = mount()

    type(field, 'a message long enough to occupy two full lines of the composer', TWO_LINES)
    // Emptying is the one transition that unstacks — the second remount the old structure caused,
    // and the one a user hits every time they send.
    type(field, '', ONE_LINE)

    expect(field.parentElement?.contains(sendButton(container))).toBe(true)
    expect(container.querySelector('textarea')).toBe(field)
  })

  it('does not stack on the first keystroke, whatever one line happens to measure', () => {
    const { container, field } = mount()

    // Stacked moves the buttons to a second row, so the row holding the field would no longer hold
    // the send button. One line: they are siblings under one parent.
    expect(field.parentElement?.contains(sendButton(container))).toBe(true)
  })

  it('moves the controls below the field once it really has wrapped', () => {
    const { container, field } = mount()

    type(field, 'a message long enough to occupy two full lines of the composer', TWO_LINES)

    expect(field.parentElement?.contains(sendButton(container))).toBe(false)
    expect(container.querySelector('textarea')).toBe(field)
  })

  it('collapses back to one line after sending', () => {
    // The sibling of the device bug, on the side jsdom can reach.
    //
    // On a phone the composer stayed stacked with an EMPTY box after every send: the baseline had
    // been learned from a freshly mounted field's `minHeight` clamp — lower than what an empty box
    // settles at — so the empty composer measured as "wrapped" and re-stacked itself the instant
    // the send cleared it. That exact sequence cannot be reproduced here, because the web half
    // measures only in `adjustHeight`, called only from the change handler, so nothing re-measures
    // an emptied box on web at all. The device run is what verified that fix.
    //
    // What this pins is the web-reachable claim: a send returns the composer to one line.
    //
    // CLAMP is what a freshly mounted field reports (`minHeight`), SETTLED is what the same EMPTY
    // field reports once laid out, and SETTLED > CLAMP * 1.5 — the relationship that made a
    // smallest-measurement baseline judge an empty box as wrapped.
    const CLAMP = 24
    const SETTLED = 38
    const WRAPPED = 76

    const sent: string[] = []
    const view = render(
      <P>
        <Composer onSend={(text) => sent.push(text)} />
      </P>,
    )
    const field = view.container.querySelector('textarea')!
    type(field, 'a', CLAMP)
    type(field, 'a message long enough to occupy two full lines of the composer', WRAPPED)
    expect(field.parentElement?.contains(sendButton(view.container))).toBe(false)

    act(() => {
      fireEvent.click(sendButton(view.container))
    })
    type(field, '', SETTLED)

    expect(sent).toEqual(['a message long enough to occupy two full lines of the composer'])
    expect(field.parentElement?.contains(sendButton(view.container))).toBe(true)
    expect(view.container.querySelector('textarea')).toBe(field)
  })
})
