/**
 * app-sidebar.styled.tsx — P2 conversion of the `.app-sidebar` BEM block
 * (docs/tamagui-idiomatic-migration.md §4). Converts libs/css/src/elements/nav/app-sidebar/index.css —
 * the `.app-sidebar` rail (+ `--fixed`/`--collapsed`), its header/rail/top/content/footer regions, the
 * `.app-sidebar__item` (+ `--active`) rows and the embedded project `.app-sidebar__dropdown` — into
 * idiomatic Tamagui `styled()` frames using the SPIKE-A1 var-backed `$` colors and SPIKE-B scales.
 *
 * `transition-all duration-200`/`transition-colors`/`transition-opacity` await the animation driver
 * (§5/P4). `font-display` (the display font family) has no font-family token yet, so it is dropped and
 * only its weight/size survive. Lands alongside the shipped className AppSidebar (index.tsx);
 * app-sidebar-styled.test.tsx pins the frames.
 */
import * as React from 'react'
import { styled, View, Text } from '../../../theme/tamagui-web.config'

// shadow-lg ≈ opaque-black at low alpha, offset down, wide blur (single-layer approximation, §5).
const shadowLg = { shadowColor: 'rgba(0,0,0,0.1)', shadowOffset: { width: 0, height: 10 }, shadowRadius: 15 } as const

/**
 * `.app-sidebar` — flex! flex-col h-full bg-sidebar border-r border-sidebar-border overflow-hidden
 * (transition-all duration-200 → animation driver, §5/P4). `--fixed` (w-64) and `--collapsed` (w-12)
 * become boolean variants.
 */
export const AppSidebarFrame = styled(View, {
  name: 'AppSidebar',
  tag: 'nav',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: '$sidebar',
  borderRightWidth: 1,
  borderRightColor: '$sidebar-border',
  overflow: 'hidden',
  // transition-all duration-200 awaits the animation driver (§5/P4)

  variants: {
    fixed: {
      true: { width: '$64' },
    },
    collapsed: {
      true: { width: '$12' },
    },
  } as const,
})

/** `.app-sidebar__rail` — flex! flex-col items-center py-3 gap-2. */
export const AppSidebarRailFrame = styled(View, {
  name: 'AppSidebarRail',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingVertical: '$3',
  gap: '$2',
})

/** `.app-sidebar__rail-btn` — w-8 h-8 flex! items/justify-center rounded-lg muted-fg + hover. */
export const AppSidebarRailBtnFrame = styled(View, {
  name: 'AppSidebarRailBtn',
  width: '$8',
  height: '$8',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '$radius-lg',
  color: '$muted-foreground',
  cursor: 'pointer',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)', color: '$foreground' },
})

/** `.app-sidebar__header` — flex! items-center gap-2 px-4 py-3 border-b border-sidebar-border shrink-0. */
export const AppSidebarHeaderFrame = styled(View, {
  name: 'AppSidebarHeader',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  paddingHorizontal: '$4',
  paddingVertical: '$3',
  borderBottomWidth: 1,
  borderBottomColor: '$sidebar-border',
  flexShrink: 0,
})

/** `.app-sidebar__brand` — font-display (dropped, no family token) font-bold text-base. */
export const AppSidebarBrandFrame = styled(Text, {
  name: 'AppSidebarBrand',
  fontWeight: '$bold',
  fontSize: '$base',
})

/** `.app-sidebar__rail-brand` — font-display (dropped) font-bold text-base leading-none. */
export const AppSidebarRailBrandFrame = styled(Text, {
  name: 'AppSidebarRailBrand',
  fontWeight: '$bold',
  fontSize: '$base',
  lineHeight: '1' as unknown as number, // leading-none
})

/** `.app-sidebar__collapse-btn` — ml-auto w-6 h-6 flex! items/justify-center rounded-lg muted-fg + hover. */
export const AppSidebarCollapseBtnFrame = styled(View, {
  name: 'AppSidebarCollapseBtn',
  marginLeft: 'auto',
  width: '$6',
  height: '$6',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '$radius-lg',
  color: '$muted-foreground',
  cursor: 'pointer',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)', color: '$foreground' },
})

/** `.app-sidebar__top` — px-3 py-2 flex! flex-col gap-2 shrink-0. */
export const AppSidebarTopFrame = styled(View, {
  name: 'AppSidebarTop',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2',
  flexShrink: 0,
})

/** `.app-sidebar__project-row` — flex! items-center gap-1. */
export const AppSidebarProjectRowFrame = styled(View, {
  name: 'AppSidebarProjectRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
})

/** `.app-sidebar__project-settings` — shrink-0 w-8 h-8 flex! center rounded-lg muted-fg + hover. */
export const AppSidebarProjectSettingsFrame = styled(View, {
  name: 'AppSidebarProjectSettings',
  flexShrink: 0,
  width: '$8',
  height: '$8',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '$radius-lg',
  color: '$muted-foreground',
  cursor: 'pointer',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)', color: '$foreground' },
})

/** `.app-sidebar__new-chat` — w-full flex! center gap-2 px-3 py-2 rounded-xl primary + hover/disabled. */
export const AppSidebarNewChatFrame = styled(View, {
  name: 'AppSidebarNewChat',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$2',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  borderRadius: '$radius-xl',
  backgroundColor: '$primary',
  color: '$primary-foreground',
  fontSize: '$sm',
  fontWeight: '$medium',
  cursor: 'pointer',
  // transition-opacity awaits the animation driver (§5/P4)
  hoverStyle: { opacity: 0.9 },
  disabledStyle: { opacity: 0.5 },
})

/** `.app-sidebar__content` — flex-1 overflow-y-auto px-2 py-1. */
export const AppSidebarContentFrame = styled(View, {
  name: 'AppSidebarContent',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  paddingHorizontal: '$2',
  paddingVertical: '$1',
})

/** `.app-sidebar__section` — mb-3. */
export const AppSidebarSectionFrame = styled(View, {
  name: 'AppSidebarSection',
  marginBottom: '$3',
})

/** `.app-sidebar__section-body` — mt-0.5. */
export const AppSidebarSectionBodyFrame = styled(View, {
  name: 'AppSidebarSectionBody',
  marginTop: '$0.5',
})

/** `.app-sidebar__empty` — px-2 py-1 text-sm text-muted-foreground. */
export const AppSidebarEmptyFrame = styled(Text, {
  name: 'AppSidebarEmpty',
  paddingHorizontal: '$2',
  paddingVertical: '$1',
  fontSize: '$sm',
  color: '$muted-foreground',
})

/** `.app-sidebar__item` — w-full text-left px-2 py-1.5 rounded-lg text-sm truncate muted-fg + hover;
 * `--active` (bg-muted text-foreground font-medium) is a boolean variant. */
export const AppSidebarItemFrame = styled(View, {
  name: 'AppSidebarItem',
  width: '100%',
  textAlign: 'left',
  paddingHorizontal: '$2',
  paddingVertical: '$1.5',
  borderRadius: '$radius-lg',
  fontSize: '$sm',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '$muted-foreground',
  cursor: 'pointer',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)', color: '$foreground' },

  variants: {
    active: {
      true: { backgroundColor: '$muted', color: '$foreground', fontWeight: '$medium' },
    },
  } as const,
})

/** `.app-sidebar__footer` — shrink-0 border-t border-sidebar-border. */
export const AppSidebarFooterFrame = styled(View, {
  name: 'AppSidebarFooter',
  flexShrink: 0,
  borderTopWidth: 1,
  borderTopColor: '$sidebar-border',
})

/** `.app-sidebar__section-header` — w-full flex! items-center gap-1 px-2 py-1 text-xs font-semibold
 * muted-fg uppercase tracking-wider + hover:text-foreground. */
export const AppSidebarSectionHeaderFrame = styled(View, {
  name: 'AppSidebarSectionHeader',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  paddingHorizontal: '$2',
  paddingVertical: '$1',
  fontSize: '$xs',
  fontWeight: '$semibold',
  color: '$muted-foreground',
  textTransform: 'uppercase',
  letterSpacing: '$wider',
  cursor: 'pointer',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { color: '$foreground' },
})

/** `.app-sidebar__section-icon` — w-3 h-3 shrink-0. */
export const AppSidebarSectionIconFrame = styled(View, {
  name: 'AppSidebarSectionIcon',
  width: '$3',
  height: '$3',
  flexShrink: 0,
})

/** `.app-sidebar__section-label` — flex-1 text-left. */
export const AppSidebarSectionLabelFrame = styled(View, {
  name: 'AppSidebarSectionLabel',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  textAlign: 'left',
})

/** `.app-sidebar__section-count` — text-muted-foreground/60 font-normal (alpha via color-mix). */
export const AppSidebarSectionCountFrame = styled(Text, {
  name: 'AppSidebarSectionCount',
  color: 'color-mix(in srgb, var(--muted-foreground) 60%, transparent)',
  fontWeight: '$normal',
})

/** `.app-sidebar__dropdown` — relative. The contextual `.app-sidebar__project-row &` override
 * (flex-1 min-w-0) becomes an `inRow` variant the row applies to its dropdown child. */
export const AppSidebarDropdownFrame = styled(View, {
  name: 'AppSidebarDropdown',
  position: 'relative',

  variants: {
    inRow: {
      true: { flexGrow: 1, flexShrink: 1, flexBasis: '0%', minWidth: 0 },
    },
  } as const,
})

/** `.app-sidebar__dropdown-trigger` — w-full flex! items-center gap-2 px-3 py-2 rounded-xl muted + hover. */
export const AppSidebarDropdownTriggerFrame = styled(View, {
  name: 'AppSidebarDropdownTrigger',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  borderRadius: '$radius-xl',
  backgroundColor: '$muted',
  color: '$foreground',
  fontSize: '$sm',
  fontWeight: '$medium',
  cursor: 'pointer',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--muted) 70%, transparent)' },
})

/** `.app-sidebar__dropdown-label` — flex-1 text-left truncate. */
export const AppSidebarDropdownLabelFrame = styled(View, {
  name: 'AppSidebarDropdownLabel',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  textAlign: 'left',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** `.app-sidebar__dropdown-chevron` — w-4 h-4 shrink-0 text-muted-foreground. */
export const AppSidebarDropdownChevronFrame = styled(View, {
  name: 'AppSidebarDropdownChevron',
  width: '$4',
  height: '$4',
  flexShrink: 0,
  color: '$muted-foreground',
})

/** `.app-sidebar__dropdown-menu` — absolute left-0 right-0 top-full mt-1 z-20 rounded-xl border
 * bg-popover shadow-lg overflow-hidden. */
export const AppSidebarDropdownMenuFrame = styled(View, {
  name: 'AppSidebarDropdownMenu',
  position: 'absolute',
  left: 0,
  right: 0,
  top: '100%',
  marginTop: '$1',
  zIndex: 20,
  borderRadius: '$radius-xl',
  borderWidth: 1,
  borderColor: '$border',
  backgroundColor: '$popover',
  overflow: 'hidden',
  ...shadowLg,
})

/** `.app-sidebar__dropdown-list` — max-h-64 overflow-y-auto py-1. */
export const AppSidebarDropdownListFrame = styled(View, {
  name: 'AppSidebarDropdownList',
  maxHeight: '$64',
  overflowY: 'auto',
  paddingVertical: '$1',
})

/** `.app-sidebar__dropdown-row` — flex! items-center gap-1 px-1. The `row:hover &__dropdown-delete`
 * reveal is a group-hover descendant selector (see AppSidebarDropdownDeleteFrame note). */
export const AppSidebarDropdownRowFrame = styled(View, {
  name: 'AppSidebarDropdownRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  paddingHorizontal: '$1',
})

/** `.app-sidebar__dropdown-item` — flex-1 text-left px-2 py-1.5 rounded-lg text-sm truncate muted-fg
 * + hover; `--active` boolean variant. */
export const AppSidebarDropdownItemFrame = styled(View, {
  name: 'AppSidebarDropdownItem',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  textAlign: 'left',
  paddingHorizontal: '$2',
  paddingVertical: '$1.5',
  borderRadius: '$radius-lg',
  fontSize: '$sm',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '$muted-foreground',
  cursor: 'pointer',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)', color: '$foreground' },

  variants: {
    active: {
      true: { backgroundColor: '$muted', color: '$foreground', fontWeight: '$medium' },
    },
  } as const,
})

/** `.app-sidebar__dropdown-delete` — hidden! w-5 h-5 items/justify-center muted-fg rounded text-xs
 * shrink-0 + hover:text-destructive. The BEM `row:hover &` group-hover reveal (→ flex!) cannot be a
 * single-frame prop; it becomes a `revealed` variant the row toggles on hover in the component. */
export const AppSidebarDropdownDeleteFrame = styled(View, {
  name: 'AppSidebarDropdownDelete',
  display: 'none',
  width: '$5',
  height: '$5',
  alignItems: 'center',
  justifyContent: 'center',
  color: '$muted-foreground',
  borderRadius: '$radius',
  fontSize: '$xs',
  flexShrink: 0,
  cursor: 'pointer',
  hoverStyle: { color: '$destructive' },

  variants: {
    revealed: {
      true: { display: 'flex' },
    },
  } as const,
})

/** `.app-sidebar__dropdown-create` — flex! gap-1 border-t border-border px-2 py-2. */
export const AppSidebarDropdownCreateFrame = styled(View, {
  name: 'AppSidebarDropdownCreate',
  display: 'flex',
  gap: '$1',
  borderTopWidth: 1,
  borderTopColor: '$border',
  paddingHorizontal: '$2',
  paddingVertical: '$2',
})

/** `.app-sidebar__dropdown-input` — flex-1 min-w-0 bg-muted rounded-lg px-2 py-1 text-xs text-foreground
 * placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring. */
export const AppSidebarDropdownInputFrame = styled(View, {
  name: 'AppSidebarDropdownInput',
  tag: 'input',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
  backgroundColor: '$muted',
  borderRadius: '$radius-lg',
  paddingHorizontal: '$2',
  paddingVertical: '$1',
  fontSize: '$xs',
  color: '$foreground',
  placeholderTextColor: '$muted-foreground',
  // focus:outline-none then focus:ring-1 ring-ring → a 1px solid ring outline (§5 ring→outline).
  focusStyle: { outlineWidth: 1, outlineStyle: 'solid', outlineColor: '$ring' },
})

/** `.app-sidebar__dropdown-add` — px-2 py-1 bg-muted text-foreground rounded-lg text-xs + hover/disabled. */
export const AppSidebarDropdownAddFrame = styled(View, {
  name: 'AppSidebarDropdownAdd',
  paddingHorizontal: '$2',
  paddingVertical: '$1',
  backgroundColor: '$muted',
  color: '$foreground',
  borderRadius: '$radius-lg',
  fontSize: '$xs',
  cursor: 'pointer',
  hoverStyle: { opacity: 0.9 },
  disabledStyle: { opacity: 0.4 },
})

/** `.app-sidebar__icon` — w-3 h-3. */
export const AppSidebarIconFrame = styled(View, {
  name: 'AppSidebarIcon',
  width: '$3',
  height: '$3',
})

export interface StyledAppSidebarProps extends React.ComponentProps<'nav'> {
  fixed?: boolean
  collapsed?: boolean
}

const Frame = AppSidebarFrame as unknown as React.ComponentType<any>

/** Idiomatic AppSidebar — same public API as the shipped className AppSidebar (`fixed`/`collapsed`). */
export function StyledAppSidebar({ fixed, collapsed, ...props }: StyledAppSidebarProps) {
  return <Frame fixed={fixed} collapsed={collapsed} {...props} />
}
