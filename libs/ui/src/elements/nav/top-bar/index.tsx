import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * TopBar — the idiomatic `.top-bar`. Renders `Prim.Box as="header"` / `Prim.Text` (real host tags at
 * runtime via `createComponent`) with the styling as `$`-token PROPS from top-bar.styled.tsx
 * (docs/tamagui-idiomatic-migration.md §4). `top-bar/index.css` is deleted.
 */
export interface TopBarProps extends Omit<React.ComponentProps<'header'>, 'title'> {
  title?: React.ReactNode
  actions?: React.ReactNode
}

/** `.top-bar` — flex, items-center, justify-between, h-12, px-4, border-b, bg-background. */
const TOP_BAR = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: '$12',
  paddingHorizontal: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  backgroundColor: '$background',
} as const

/** `.top-bar__title` — text-sm, font-semibold, text-foreground, truncate. */
const TOP_BAR_TITLE = {
  fontSize: '$sm',
  fontWeight: '$semibold',
  color: '$foreground',
  // truncate = overflow-hidden + text-ellipsis + whitespace-nowrap
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

/** `.top-bar__actions` — flex, items-center, gap-2. */
const TOP_BAR_ACTIONS = { display: 'flex', alignItems: 'center', gap: '$2' } as const

function TopBar({ title, actions, children, ...props }: TopBarProps) {
  return (
    <Prim.Box as="header" {...TOP_BAR} {...(props as Record<string, unknown>)}>
      {title != null && <Prim.Text {...TOP_BAR_TITLE}>{title}</Prim.Text>}
      {children}
      {actions != null && <Prim.Box {...TOP_BAR_ACTIONS}>{actions}</Prim.Box>}
    </Prim.Box>
  )
}

export { TopBar }
