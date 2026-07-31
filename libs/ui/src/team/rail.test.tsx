/**
 * Round 2, item 3: the thread rail and the app rail could only be closed by finding and clicking
 * their own close control — Escape did nothing, unlike `Drawer`/`Dialog`
 * (`chat/components/ui/Drawer.tsx`, `chat/components/ui/Dialog.tsx`), which already wire the
 * platform's dismiss seam (`platform/keyboard.ts#onDismiss`: Escape on web, the Android back
 * gesture on native). `RailPane` now follows the same precedent.
 */
import * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '../test-utils/index'
import { RailPane } from './rail'

describe('RailPane — Escape dismiss (round 2, item 3)', () => {
  it('calls onClose when Escape is pressed, the same seam Drawer/Dialog already use', () => {
    const onClose = vi.fn()
    render(
      <RailPane title="Thread" onClose={onClose} width={420} onWidthChange={() => {}}>
        <div>thread content</div>
      </RailPane>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose for any other key', () => {
    const onClose = vi.fn()
    render(
      <RailPane title="Thread" onClose={onClose} width={420} onWidthChange={() => {}}>
        <div>thread content</div>
      </RailPane>,
    )

    fireEvent.keyDown(document, { key: 'Enter' })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted, so a closed rail cannot fire a stale onClose', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <RailPane title="Thread" onClose={onClose} width={420} onWidthChange={() => {}}>
        <div>thread content</div>
      </RailPane>,
    )
    unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
