/**
 * Scroll — a container whose overflow actually scrolls, on both targets.
 *
 * On web this is a `Box` and the browser does the work: `overflow: auto` is all a scrolling region
 * needs, which is exactly why every shared transcript was written that way and why nobody noticed
 * it does nothing on the other target. Yoga has no overflow scrolling — a React Native subtree that
 * exceeds its parent is simply CLIPPED, silently — so a phone showed the first screenful of a
 * conversation and offered no way to reach the rest of it. Not a degradation: unreachable content.
 *
 * The native fork is an RN `ScrollView`, which is a different host component rather than a styled
 * `View`, so this has to be a primitive fork rather than a prop.
 *
 * `overflow` is fixed here rather than accepted as a prop: the whole point is that "this scrolls" is
 * one decision spelled one way, instead of a CSS property that means something on one target and
 * nothing on the other.
 */
import * as React from 'react'

import { Box, type BoxProps } from '../box/index'

export interface ScrollProps extends Omit<BoxProps, 'overflow'> {
  /**
   * Keep the region pinned to its end as content arrives — what a transcript wants.
   *
   * A PROP rather than an effect at the call site because the two targets pin by different
   * mechanisms and at different moments: the DOM lays out synchronously, so setting `scrollTop`
   * after render is enough, while a `ScrollView` has not measured its content by then and has to
   * be told on `onContentSizeChange` instead. A caller that wrote the web mechanism got silence on
   * native — the conversation opened on its OLDEST message.
   */
  stickToEnd?: boolean
  /**
   * Pull down to reload. NATIVE ONLY, and deliberately ignored here.
   *
   * Pull-to-refresh is a touch idiom the browser does not have and does not want: desktop has a
   * reload button, and mobile browsers bind the gesture themselves. Accepting the props on both
   * targets means a surface states "this list can be refreshed" once, in one place, instead of
   * growing a native-only branch at the call site.
   */
  onRefresh?: () => void
  refreshing?: boolean
}

const Scroll = React.forwardRef<any, ScrollProps>(
  ({ stickToEnd, onRefresh: _onRefresh, refreshing: _refreshing, children, ...props }, ref) => {
  const own = React.useRef<HTMLDivElement | null>(null)

  React.useLayoutEffect(() => {
    if (!stickToEnd) return
    const el = own.current
    if (el) el.scrollTop = el.scrollHeight
  })

  return (
    <Box
      ref={(node: HTMLDivElement | null) => {
        own.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) (ref as React.MutableRefObject<unknown>).current = node
      }}
      overflow="auto"
      // A `stickToEnd` region is a column of content, and it has to SAY so. This box computes to
      // `display: block` otherwise — which silently made both the spacer below and any `gap` the
      // caller passed inert, since neither means anything outside a flex container. The team
      // transcript was already passing `flexDirection="column" gap="$4"` and getting neither.
      // Defaults, not overrides: they sit before the spread so a caller can still say otherwise.
      {...(stickToEnd ? { display: 'flex' as const, flexDirection: 'column' as const } : null)}
      {...props}
    >
      {/*
       * A transcript that does not fill its container belongs at the BOTTOM, against the
       * composer — not floating at the top with a void beneath it, which is how every one of
       * these read on a quiet channel. `stickToEnd` could only ever SCROLL, and there is nothing
       * to scroll when the content is shorter than the box.
       *
       * A growing spacer above the content, rather than `justify-content: flex-end` on the box:
       * end-alignment in a SCROLL container makes the overflow unreachable in the start direction
       * — the classic "cannot scroll back to the first message" bug. A flex spacer takes the free
       * space when there is any and collapses to zero the moment the content overflows, so the
       * long case behaves exactly as it did before.
       */}
      {stickToEnd ? <Box flexGrow={1} flexShrink={0} flexBasis={0} minHeight={0} /> : null}
      {children}
    </Box>
  )
  },
)
Scroll.displayName = 'Scroll'

export { Scroll }
