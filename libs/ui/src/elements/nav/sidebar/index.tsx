import * as React from 'react'
import * as Prim from '../../primitives/index'

/**
 * Sidebar — the idiomatic `.sidebar`. `Prim.Box as="nav"` / `Prim.Box` (real host tags at runtime
 * via `createComponent`) with the styling as `$`-token PROPS from sidebar.styled.tsx
 * (docs/tamagui-idiomatic-migration.md §4). `sidebar/index.css` is deleted.
 *
 * `SIDEBAR_ITEM` is exported because the item look is needed on things that are not this component:
 * a plain `Prim.Link` in the computer shell, and — the reason this block outlived the rest of the
 * element swap — router links in `studio/shell/studio-sidebar`. Those used to be TanStack `<Link>`s,
 * which render their own `<a>` and accept only `className`; they now go through
 * `studio/shell/nav-link`, a `Prim.Link` that navigates, so it takes style props like anything else.
 * (`transition-all`/`transition-colors` had no animation to preserve — hover is instant.)
 */
export interface SidebarProps extends React.ComponentProps<'nav'> {
  collapsed?: boolean
}

/** `.sidebar` — flex, flex-col, h-full, w-64, bg-sidebar, border-r. Exported for the shell caller. */
export const SIDEBAR_BASE = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '$64',
  backgroundColor: '$sidebar',
  borderRightWidth: 1,
  borderRightColor: '$sidebar-border',
} as const

/** `.sidebar--collapsed` — w-12. */
export const SIDEBAR_COLLAPSED = { width: '$12' } as const

/** `.sidebar__item` — the padded, rounded row that hovers onto the sidebar accent. */
export const SIDEBAR_ITEM = {
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  borderRadius: '$radius-md',
  fontSize: '$sm',
  color: '$sidebar-foreground',
  cursor: 'pointer',
  hoverStyle: { backgroundColor: '$sidebar-accent', color: '$sidebar-accent-foreground' },
} as const

/** `.sidebar__item--active` — pinned to the hover look, medium weight. */
export const SIDEBAR_ITEM_ACTIVE = {
  backgroundColor: '$sidebar-accent',
  color: '$sidebar-accent-foreground',
  fontWeight: '$medium',
} as const

function Sidebar({ collapsed, ...props }: SidebarProps) {
  return (
    <Prim.Box
      as="nav"
      {...SIDEBAR_BASE}
      {...(collapsed ? SIDEBAR_COLLAPSED : {})}
      {...(props as Record<string, unknown>)}
    />
  )
}

export interface SidebarItemProps extends React.ComponentProps<'div'> {
  active?: boolean
}

function SidebarItem({ active, ...props }: SidebarItemProps) {
  return (
    <Prim.Box
      {...SIDEBAR_ITEM}
      {...(active ? SIDEBAR_ITEM_ACTIVE : {})}
      {...(props as Record<string, unknown>)}
    />
  )
}

export { Sidebar, SidebarItem }
