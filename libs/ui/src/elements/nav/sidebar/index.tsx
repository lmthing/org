import * as React from 'react'
import * as Prim from '../../primitives/index'
import { cn } from '../../../lib/utils'

/**
 * Sidebar — the idiomatic `.sidebar` shell: `Prim.Box as="nav"` (a real `<nav>` at runtime via
 * `createComponent`) with the styling as `$`-token PROPS from sidebar.styled.tsx
 * (docs/tamagui-idiomatic-migration.md §4). (`transition-all duration-200` awaits the animation
 * driver, §5/P4.)
 *
 * `SidebarItem` is the ONE residual in this block and deliberately still className-driven: most
 * `sidebar__item` call sites in `studio/shell/studio-sidebar` are TanStack Router `<Link>`s, which
 * render their own `<a>` and accept only `className` — no `asChild`, no style props. Defining the
 * item look as BOTH a prop bag and a stylesheet rule would mean two definitions to keep in sync, so
 * `sidebar/index.css` is TRIMMED to just `.sidebar__item`/`--active` and stays the single source
 * for it. It deletes when those links can take style props (P4 overlays/router follow-up).
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

function SidebarItem({ className, active, ...props }: SidebarItemProps) {
  return (
    <Prim.Box
      className={cn('sidebar__item', active && 'sidebar__item--active', className)}
      {...(props as Record<string, unknown>)}
    />
  )
}

export { Sidebar, SidebarItem }
