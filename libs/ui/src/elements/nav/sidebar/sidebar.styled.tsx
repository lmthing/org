/**
 * sidebar.styled.tsx — P2 composite conversion of the `.sidebar` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/nav/sidebar/index.css —
 * the `.sidebar` rail + `.sidebar--collapsed` and the `.sidebar__item` + its `--active` modifier —
 * into idiomatic Tamagui `styled()` frames using the sidebar-scoped `$` color tokens.
 *
 * `transition-all duration-200`/`transition-colors` await the animation driver (§5/P4). Lands
 * alongside the shipped className Sidebar (index.tsx); sidebar-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View } from '../../../theme/tamagui-web.config'

/**
 * `.sidebar` — flex, flex-col, h-full, w-64, bg-sidebar, border-r, border-sidebar-border + the
 * `collapsed` variant (`.sidebar--collapsed` = w-12).
 */
export const SidebarFrame = styled(View, {
  name: 'Sidebar',
  tag: 'nav',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '$64',
  backgroundColor: '$sidebar',
  borderRightWidth: 1,
  borderRightColor: '$sidebar-border',

  variants: {
    collapsed: {
      true: { width: '$12' },
    },
  } as const,
})

/**
 * `.sidebar__item` — flex, items-center, gap-2, px-3, py-2, rounded-md, text-sm, text-sidebar-foreground,
 * hover:bg-sidebar-accent/text + the `active` variant (bg-sidebar-accent, text, font-medium).
 */
export const SidebarItemFrame = styled(View, {
  name: 'SidebarItem',
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

  variants: {
    active: {
      true: { backgroundColor: '$sidebar-accent', color: '$sidebar-accent-foreground', fontWeight: '$medium' },
    },
  } as const,
})

export interface StyledSidebarProps extends React.ComponentProps<'nav'> {
  collapsed?: boolean
}
export interface StyledSidebarItemProps extends React.ComponentProps<'div'> {
  active?: boolean
}

const Frame = SidebarFrame as unknown as React.ComponentType<any>
const Item = SidebarItemFrame as unknown as React.ComponentType<any>

/** Idiomatic Sidebar — same public API as the shipped className Sidebar (`collapsed`). */
export function StyledSidebar({ collapsed, ...props }: StyledSidebarProps) {
  return <Frame collapsed={collapsed} {...props} />
}
/** Idiomatic SidebarItem — same public API as the shipped className SidebarItem (`active`). */
export function StyledSidebarItem({ active, ...props }: StyledSidebarItemProps) {
  return <Item active={active} {...props} />
}
