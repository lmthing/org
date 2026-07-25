import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Panel — the idiomatic `.panel`. Renders `Prim.Box` (real `<div>`s at runtime via
 * `createComponent`) with the styling as `$`-token PROPS transcribed from its retired `styled()` proof
 * (docs/tamagui-idiomatic-migration.md §4). `panel/index.css` is deleted; the prop bags are
 * exported because nine studio surfaces carried `panel`/`panel__header`/`panel__body` directly on a
 * `Prim.Box` instead of going through this element — they now spread the same bag.
 */
// `Prim.*StyleProps` too: the body spreads props straight onto a Tamagui primitive, so style props
// have always WORKED here — they just could not be typed, which is what forced callers into `style`.
export interface PanelProps extends React.ComponentProps<'div'>, Prim.LayoutStyleProps, Prim.BoxStyleProps, Prim.MarginStyleProps, Prim.TextStyleProps {
  split?: boolean
}

/** `.panel` base — flex, flex-col, bg-background, border-border, rounded-md, overflow-hidden. */
export const PANEL_BASE = {
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: '$background',
  borderWidth: 1,
  borderColor: '$border',
  borderRadius: '$radius-md',
  overflow: 'hidden',
} as const

/** `.panel--split` — flex-row. */
export const PANEL_SPLIT = { flexDirection: 'row' } as const

/** `.panel__header` — flex, items-center, justify-between, px-4, py-2, border-b, text-sm, font-medium. */
export const PANEL_HEADER = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: '$4',
  paddingVertical: '$2',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  fontSize: '$sm',
  fontWeight: '$medium',
  color: '$foreground',
} as const

/** `.panel__body` — flex-1, overflow-auto, p-4. */
export const PANEL_BODY = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflow: 'auto',
  padding: '$4',
} as const

function Panel({ split, ...props }: PanelProps) {
  return (
    <Prim.Box {...PANEL_BASE} {...(split ? PANEL_SPLIT : {})} {...(props as Record<string, unknown>)} />
  )
}

function PanelHeader(props: React.ComponentProps<'div'>) {
  return <Prim.Box {...PANEL_HEADER} {...(props as Record<string, unknown>)} />
}

function PanelBody(props: React.ComponentProps<'div'>) {
  return <Prim.Box {...PANEL_BODY} {...(props as Record<string, unknown>)} />
}

export { Panel, PanelHeader, PanelBody }
