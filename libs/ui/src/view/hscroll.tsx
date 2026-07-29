/**
 * HScroll — a horizontally scrolling strip. **Web half** of a host-element translation.
 *
 * `Prim.Scroll` is vertical: its native fork splits the caller's props into "region" and
 * "content" and forwards nothing that would make an RN `ScrollView` horizontal, so a
 * `scroll: 'x'` row built on it scrolls the wrong axis. Since `elements/primitives` is not
 * this module's to change, the translation lives here instead — one file per host, the
 * same shape on both.
 *
 * This matters more than it sounds. `scroll: 'x'` is in the schema for **native
 * correctness, not cosmetics**: Yoga has no overflow scrolling, so a wide table or a week
 * grid without a real scrolling host is silently CLIPPED on a phone with no gesture to
 * reach the rest (audit A4 — 6 components plus 13 files with `overflow-x-auto`). A `Box`
 * with `overflowY: auto` is a web-only illusion.
 */

import * as React from 'react'
import * as Prim from '../elements/primitives/index'

export interface HScrollProps {
  children: React.ReactNode
  gap?: number | string
  /** Applied to the scrolling content row, so padding scrolls with it. */
  padding?: number | string
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch'
}

export function HScroll({ children, gap, padding, alignItems }: HScrollProps): React.ReactElement {
  return (
    <Prim.Box overflowX="auto" width="100%" maxWidth="100%">
      <Prim.Row
        gap={gap as never}
        padding={padding as never}
        alignItems={alignItems ?? 'stretch'}
        flexWrap="nowrap"
        minWidth="min-content"
      >
        {children}
      </Prim.Row>
    </Prim.Box>
  )
}
