import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * SplitPane — the idiomatic `.split-pane`. Renders `Prim.Box` (real `<div>`s at runtime via
 * `createComponent`) with the styling as `$`-token PROPS from split-pane.styled.tsx
 * (docs/tamagui-idiomatic-migration.md §4). `split-pane/index.css` is deleted; the studio-shell
 * callers that carried the raw BEM classes on a `Prim.Box` now spread these prop bags instead.
 */

/** `.split-pane` — flex, flex-row, h-full, overflow-hidden. Exported for the shell callers. */
export const SPLIT_PANE_BASE = {
  display: 'flex',
  flexDirection: 'row',
  height: '100%',
  overflow: 'hidden',
} as const

/** `.split-pane__primary` — flex-1, overflow-auto. */
export const SPLIT_PANE_PRIMARY = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflow: 'auto',
} as const

/** `.split-pane__secondary` — shrink-0, overflow-auto, border-l, border-border. */
export const SPLIT_PANE_SECONDARY = {
  flexShrink: 0,
  overflow: 'auto',
  borderLeftWidth: 1,
  borderLeftColor: '$border',
} as const

function SplitPane(props: React.ComponentProps<'div'>) {
  return <Prim.Box {...SPLIT_PANE_BASE} {...(props as Record<string, unknown>)} />
}

function SplitPanePrimary(props: React.ComponentProps<'div'>) {
  return <Prim.Box {...SPLIT_PANE_PRIMARY} {...(props as Record<string, unknown>)} />
}

function SplitPaneSecondary(props: React.ComponentProps<'div'>) {
  return <Prim.Box {...SPLIT_PANE_SECONDARY} {...(props as Record<string, unknown>)} />
}

export { SplitPane, SplitPanePrimary, SplitPaneSecondary }
