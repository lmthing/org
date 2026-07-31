import * as React from 'react'

/**
 * Two panes side by side, with a divider you can drag.
 *
 * ## Why side by side is the right shape for the browser
 *
 * The browser pane started out replacing whatever surface was open, and that was wrong for the
 * thing it exists to do. An agent driving a browser is something you WATCH while you talk to it:
 * you ask for a page, you see the pointer move to the link, and you say "no, the other one". A
 * pane that replaces the conversation makes that a sequence of blind turns — ask, switch, look,
 * switch back — and the whole point of showing the browser at all was to remove that gap.
 *
 * ## Why it collapses below a threshold
 *
 * Two panes on a narrow window are two unusable panes. Below `minSplitWidth` this shows one at a
 * time, which is the honest answer rather than a split nobody can read. The threshold is a
 * property of the WINDOW, so it is measured here rather than assumed from a device class.
 */

export interface SplitPaneProps {
  left: React.ReactNode
  right: React.ReactNode
  /** False shows `left` alone, with `right` kept mounted and hidden. */
  splitOpen: boolean
  /** Below this total width the split collapses to whichever pane is in front. */
  minSplitWidth?: number
  /** Which pane is in front when there is not room for both. */
  frontWhenNarrow?: 'left' | 'right'
}

const DIVIDER_PX = 6
const MIN_PANE_FRACTION = 0.2

export function SplitPane({
  left,
  right,
  splitOpen,
  minSplitWidth = 900,
  frontWhenNarrow = 'right',
}: SplitPaneProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = React.useState(0)
  const [fraction, setFraction] = React.useState(0.5)
  const dragging = React.useRef(false)

  React.useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  /**
   * Drag on the WINDOW, not on the divider.
   *
   * A pointer moving faster than the divider follows leaves the element behind, and a handler
   * bound to the divider then stops receiving moves mid-drag — the split sticks and the person is
   * left holding a mouse button that does nothing.
   */
  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !hostRef.current) return
      const r = hostRef.current.getBoundingClientRect()
      if (r.width <= 0) return
      const next = (e.clientX - r.left) / r.width
      setFraction(Math.min(1 - MIN_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, next)))
      // Without this a drag across the panes selects text in both of them.
      e.preventDefault()
    }
    const onUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const roomForBoth = width >= minSplitWidth
  const split = splitOpen && roomForBoth

  const startDrag = React.useCallback(() => {
    dragging.current = true
    // Held on the BODY for the duration: once the pointer is over an iframe or the browser pane's
    // own image, a cursor set on the divider no longer applies.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const onKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    // A divider that can only be dragged is a divider some people cannot move at all.
    if (e.key === 'ArrowLeft') setFraction((f) => Math.max(MIN_PANE_FRACTION, f - 0.05))
    if (e.key === 'ArrowRight') setFraction((f) => Math.min(1 - MIN_PANE_FRACTION, f + 0.05))
    if (e.key === 'Home') setFraction(0.5)
  }, [])

  /**
   * Both children stay MOUNTED in every layout, which is the same rule the surfaces follow.
   * Unmounting the browser would throw away its tabs and the page an agent is midway through
   * reading; unmounting the conversation would drop a streaming turn.
   */
  const hideLeft = splitOpen && !roomForBoth && frontWhenNarrow === 'right'
  const hideRight = !splitOpen || (!roomForBoth && frontWhenNarrow === 'left')

  return (
    <div ref={hostRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
      <div
        style={{
          display: hideLeft ? 'none' : 'flex',
          flexDirection: 'column',
          minWidth: 0,
          minHeight: 0,
          ...(split ? { width: `${fraction * 100}%` } : { flex: 1 }),
        }}
      >
        {left}
      </div>

      {split && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the browser pane"
          tabIndex={0}
          onMouseDown={startDrag}
          onKeyDown={onKeyDown}
          onDoubleClick={() => setFraction(0.5)}
          style={{
            width: DIVIDER_PX,
            flexShrink: 0,
            cursor: 'col-resize',
            // A token, not a literal — this is a real piece of chrome, not an error surface.
            background: 'var(--border)',
          }}
        />
      )}

      <div
        style={{
          display: hideRight ? 'none' : 'flex',
          flexDirection: 'column',
          minWidth: 0,
          minHeight: 0,
          flex: 1,
        }}
      >
        {right}
      </div>
    </div>
  )
}
