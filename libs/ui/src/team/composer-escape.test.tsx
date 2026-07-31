/**
 * Companion to round 2, item 3 (Escape now dismisses the rail/drawer via
 * `platform/keyboard#onDismiss`, which listens on `document`). The composer already used Escape
 * for a narrower job — closing the `@` picker without sending or losing the draft — and that
 * handler did not stop the keydown from bubbling. Wiring the rail meant a member dismissing the
 * picker while replying in an open thread would ALSO throw the whole rail closed: two unrelated
 * things reacting to one keystroke.
 */
import * as React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent } from '../test-utils/index'
import { Composer } from './composer'
import type { Directory } from './types'

const DIRECTORY: Directory = { members: [], projects: [] }

// A stand-in for `platform/keyboard#onDismiss`'s own listener, which is exactly what a mounted
// `RailPane`/drawer would have registered on `document` at the moment this Escape fires.
const GLOBAL_PROBE = vi.fn()

afterEach(() => {
  // Belt-and-braces: a test that failed before reaching its own cleanup line must not leave a
  // listener registered on the shared `document` for the next test in this file.
  document.removeEventListener('keydown', GLOBAL_PROBE)
  GLOBAL_PROBE.mockClear()
})

describe('Composer — Escape does not leak past the @ picker', () => {
  it('closes the picker without letting the keydown reach a document-level dismiss listener', () => {
    document.addEventListener('keydown', GLOBAL_PROBE)
    const { getByPlaceholderText, queryByText } = render(
      <Composer placeholder="Reply in thread" directory={DIRECTORY} meId="me" onSend={vi.fn()} />,
    )
    const box = getByPlaceholderText('Reply in thread') as HTMLTextAreaElement

    fireEvent.change(box, { target: { value: '@' } })
    expect(queryByText('THING')).toBeTruthy() // the picker is open

    fireEvent.keyDown(box, { key: 'Escape' })

    // The picker's own job still happens...
    expect(queryByText('THING')).toBeNull()
    // ...but a listener sitting where `onDismiss` would put one never saw this keystroke.
    expect(GLOBAL_PROBE).not.toHaveBeenCalled()
  })

  it('an Escape with no picker open is free to reach a document-level dismiss listener', () => {
    // Confirms the fix is scoped to the picker's own Escape branch, not a blanket
    // `stopPropagation` on every keydown — Escape must still close a rail with nothing typed.
    document.addEventListener('keydown', GLOBAL_PROBE)
    const { getByPlaceholderText, queryByText } = render(
      <Composer placeholder="Reply in thread" directory={DIRECTORY} meId="me" onSend={vi.fn()} />,
    )
    const box = getByPlaceholderText('Reply in thread') as HTMLTextAreaElement
    expect(queryByText('THING')).toBeNull() // no picker up

    fireEvent.keyDown(box, { key: 'Escape' })

    expect(GLOBAL_PROBE).toHaveBeenCalledTimes(1)
  })
})
