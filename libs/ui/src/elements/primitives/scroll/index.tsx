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
}

const Scroll = React.forwardRef<any, ScrollProps>(({ stickToEnd, children, ...props }, ref) => {
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
      {...props}
    >
      {children}
    </Box>
  )
})
Scroll.displayName = 'Scroll'

export { Scroll }
