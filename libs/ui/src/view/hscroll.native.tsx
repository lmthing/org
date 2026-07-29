/**
 * HScroll — **native half**. A real `ScrollView horizontal`, because Yoga has no overflow
 * scrolling and `overflowX: 'auto'` means nothing to a native view.
 *
 * Same export, same props as the web sibling; Metro picks this one. See that file's header
 * for why the translation lives here rather than in `elements/primitives/scroll`.
 */

import * as React from 'react'
import { ScrollView } from 'react-native'
import * as Prim from '../elements/primitives/index'

export interface HScrollProps {
  children: React.ReactNode
  gap?: number | string
  padding?: number | string
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch'
}

export function HScroll({ children, gap, padding, alignItems }: HScrollProps): React.ReactElement {
  return (
    <ScrollView
      horizontal={true}
      showsHorizontalScrollIndicator={false}
      // Without this a tap that lands on a card inside the strip is swallowed by the
      // scroll gesture instead of reaching what was tapped — the same reason
      // `primitives/scroll` sets it.
      keyboardShouldPersistTaps="handled"
    >
      <Prim.Row
        gap={gap as never}
        padding={padding as never}
        alignItems={alignItems ?? 'stretch'}
        flexWrap="nowrap"
      >
        {children}
      </Prim.Row>
    </ScrollView>
  )
}
