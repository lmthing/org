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

/**
 * Bottom-anchoring, the way this target can express it: the content view takes the region's free
 * space and aligns its children to the end, so a conversation shorter than the screen sits against
 * the composer instead of floating at the top. Once the content overflows there is no free space
 * and this is inert — which is why it needs none of the web fork's spacer trick.
 */
const ANCHOR_END = { flexGrow: 1, justifyContent: 'flex-end' } as const

/**
 * Where the reader is, in the shape the web handler already reads.
 *
 * `onScroll` is a DOM event on web — callers ask `e.currentTarget.scrollTop/scrollHeight/
 * clientHeight` to decide "is the reader at the bottom?", which is what lets a transcript follow
 * new output WITHOUT yanking someone who has scrolled up to reread something. React Native reports
 * the same three numbers under completely different names on `e.nativeEvent`, and
 * `nativeSafeProps` drops any `on*` prop it does not know, so `onScroll` never arrived here at all:
 * every such caller's `atBottom` stayed frozen at its initial value on a phone, and follow-mode
 * degraded to "always pinned".
 *
 * Translating here rather than at each call site is the point of the fork — the caller writes the
 * web idiom once and both targets honour it, which is the same bargain `stickToEnd` makes.
 *
 * Exported for the native suite: `ScrollView` substitutes its own internal handler on the host
 * node, so driving the mapping through the rendered tree tests RN's plumbing rather than this
 * translation. The suite asserts the wiring reaches the ScrollView and checks the mapping here.
 */
export function toWebScrollEvent(e: {
  nativeEvent: {
    contentOffset: { y: number }
    layoutMeasurement: { height: number }
    contentSize: { height: number }
  }
}) {
  const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
  return {
    currentTarget: {
      scrollTop: contentOffset.y,
      clientHeight: layoutMeasurement.height,
      scrollHeight: contentSize.height,
    },
  }
}

const Scroll = React.forwardRef<any, ScrollProps>(({ stickToEnd, onScroll, children, ...props }, ref) => {
  const own = React.useRef<{ scrollToEnd?: (o?: object) => void } | null>(null)

  const region: Record<string, unknown> = {}
  const content: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    ;(REGION_PROPS.has(key) ? region : content)[key] = value
  }
  const contentProps = nativeSafeProps(content, { flexDirectionDefault: 'column' })

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
      {...(onScroll
        ? {
            onScroll: (e: Parameters<typeof toWebScrollEvent>[0]) =>
              (onScroll as (ev: ReturnType<typeof toWebScrollEvent>) => void)(toWebScrollEvent(e)),
            // Without this a `ScrollView` fires onScroll ONCE per gesture, so "am I at the bottom?"
            // would be answered from where the finger landed rather than where it stopped.
            scrollEventThrottle: 16,
          }
        : null)}
    >
      <NativeView
        {...contentProps}
        // MERGED into whatever style the content props already resolved to, never assigned over
        // it. A plain `style={...}` here replaced it — which on a transcript meant the padding and
        // the gap between messages silently disappeared the moment bottom-anchoring was asked for.
        style={[(contentProps as { style?: unknown }).style, stickToEnd ? ANCHOR_END : null]}
      >
        {children}
      </NativeView>
    </NativeScrollView>
  )
})
Scroll.displayName = 'Scroll'

export { Scroll }
