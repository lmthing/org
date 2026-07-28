/**
 * Scroll — NATIVE fork. A real `ScrollView`, because Yoga has no scrolling overflow.
 *
 * The caller's style props describe the CONTENT, not the scroll container: padding, gap and the
 * flex that makes a region fill what is left over all belong inside. Spreading them onto the
 * `ScrollView` itself gives a region that scrolls but whose content will not lay out, which reads
 * as "the props were ignored". Hence the inner `NativeView`.
 *
 * `stickToEnd` is wired to `onContentSizeChange` rather than to an effect, and that is the whole
 * reason the prop exists — see the web sibling. An effect runs before the `ScrollView` has measured
 * its children, so `scrollToEnd()` there scrolls to the end of the content it knew about at the
 * time, which for a freshly-opened transcript is roughly half of it.
 */
import * as React from 'react'
import { ScrollView } from 'react-native'

import { NativeView, nativeSafeProps, styled } from '../_native'
import type { BoxProps } from '../box/index'

export interface ScrollProps extends Omit<BoxProps, 'overflow'> {
  /** Keep the region pinned to its end as content arrives — what a transcript wants. */
  stickToEnd?: boolean
}

/** Tamagui-styled so `$`-token style props resolve, same as every other native primitive. */
const NativeScrollView: React.ComponentType<any> = styled(ScrollView, {
  name: 'NativeScrollView',
}) as unknown as React.ComponentType<any>

/**
 * Which of the caller's props size the REGION and which describe its CONTENT.
 *
 * This split is the whole correctness of the fork. `flex: 1` on a transcript means "take the space
 * left over in the column" — a statement about the scrolling region. Applied to the content view
 * instead, it pins the content to exactly one viewport and the overflow is clipped, which is the
 * very bug this component exists to fix, silently reintroduced one level in.
 */
const REGION_PROPS = new Set([
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'height',
  'minHeight',
  'maxHeight',
  'width',
  'minWidth',
  'maxWidth',
  'alignSelf',
])

const Scroll = React.forwardRef<any, ScrollProps>(({ stickToEnd, children, ...props }, ref) => {
  const own = React.useRef<{ scrollToEnd?: (o?: object) => void } | null>(null)

  const region: Record<string, unknown> = {}
  const content: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    ;(REGION_PROPS.has(key) ? region : content)[key] = value
  }

  return (
    <NativeScrollView
      ref={(node: { scrollToEnd?: (o?: object) => void } | null) => {
        own.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) (ref as React.MutableRefObject<unknown>).current = node
      }}
      {...nativeSafeProps(region)}
      // Without this a tap that lands on a message while the keyboard is up is swallowed by the
      // dismiss gesture instead of reaching what was tapped.
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={stickToEnd ? () => own.current?.scrollToEnd?.({ animated: false }) : undefined}
    >
      <NativeView {...nativeSafeProps(content, { flexDirectionDefault: 'column' })}>
        {children}
      </NativeView>
    </NativeScrollView>
  )
})
Scroll.displayName = 'Scroll'

export { Scroll }
