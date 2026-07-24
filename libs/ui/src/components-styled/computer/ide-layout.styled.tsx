/** ide-layout.styled.tsx — P2 conversion of the `.ide-layout` BEM block (docs §4).
 *  One styled() per BEM selector; the `__split`/`__divider` `--horizontal/--vertical` and the
 *  `__pane` `--sidebar/--main/--editor/--terminal` modifiers become variants. Lands alongside the
 *  shipped className layout. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.ide-layout` — flex, flex-col, h-screen, overflow-hidden, bg-background, text-foreground. */
export const IdeLayoutFrame = styled(View, {
  name: 'IdeLayout',
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  overflow: 'hidden',
  backgroundColor: '$background',
  color: '$foreground',
})

/** `.ide-layout__header` — h-10, flex, items-center, gap-3, px-4, border-b, border-border, bg-card, shrink-0. */
export const IdeLayoutHeaderFrame = styled(View, {
  name: 'IdeLayoutHeader',
  height: '$10',
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
  paddingHorizontal: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  backgroundColor: '$card',
  flexShrink: 0,
})

/** `.ide-layout__title` — text-sm, font-semibold. */
export const IdeLayoutTitleFrame = styled(Text, {
  name: 'IdeLayoutTitle',
  fontSize: '$sm',
  fontWeight: '$semibold',
})

/** `.ide-layout__status` — flex, items-center, gap-2, ml-auto, text-sm, text-muted-foreground. */
export const IdeLayoutStatusFrame = styled(View, {
  name: 'IdeLayoutStatus',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  marginLeft: 'auto',
  fontSize: '$sm',
  color: '$muted-foreground',
})

/** `.ide-layout__body` — flex-1, overflow-hidden. */
export const IdeLayoutBodyFrame = styled(View, {
  name: 'IdeLayoutBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflow: 'hidden',
})

/** `.ide-layout__nav` — flex, items-center, gap-1, ml-4. */
export const IdeLayoutNavFrame = styled(View, {
  name: 'IdeLayoutNav',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  marginLeft: '$4',
})

/**
 * `.ide-layout__nav-btn` — text-xs, text-muted-foreground, hover:text-foreground, px-2, py-1, rounded,
 * cursor-pointer, bg-transparent, border-0.
 */
export const IdeLayoutNavBtnFrame = styled(View, {
  name: 'IdeLayoutNavBtn',
  tag: 'button',
  fontSize: '$xs',
  color: '$muted-foreground',
  paddingHorizontal: '$2',
  paddingVertical: '$1',
  borderRadius: '$radius',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  borderWidth: 0,
  hoverStyle: { color: '$foreground' },
})

/**
 * `.ide-layout__restart-btn` — text-xs, text-muted-foreground, hover:text-foreground,
 * disabled:opacity-40, cursor-pointer, bg-transparent, border-0, p-0.
 */
export const IdeLayoutRestartBtnFrame = styled(View, {
  name: 'IdeLayoutRestartBtn',
  tag: 'button',
  fontSize: '$xs',
  color: '$muted-foreground',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  borderWidth: 0,
  padding: '$0',
  hoverStyle: { color: '$foreground' },
  disabledStyle: { opacity: 0.4 },
})

/**
 * `.ide-layout__split` — flex, w-full, h-full, min-h-0, min-w-0 + the `--horizontal` (flex-row) /
 * `--vertical` (flex-col) modifiers as an `orientation` variant.
 */
export const IdeLayoutSplitFrame = styled(View, {
  name: 'IdeLayoutSplit',
  display: 'flex',
  width: '100%',
  height: '100%',
  minHeight: 0,
  minWidth: 0,

  variants: {
    orientation: {
      horizontal: { flexDirection: 'row' },
      vertical: { flexDirection: 'column' },
    },
  } as const,
})

/**
 * `.ide-layout__pane` — min-h-0, min-w-0, overflow-hidden + the `--sidebar/--main/--editor/--terminal`
 * modifiers as a `role` variant (sidebar/terminal are fixed-basis, main/editor grow).
 */
export const IdeLayoutPaneFrame = styled(View, {
  name: 'IdeLayoutPane',
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',

  variants: {
    role: {
      sidebar: { flexShrink: 0, flexBasis: '15%' },
      main: { flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
      editor: { flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
      terminal: { flexShrink: 0, flexBasis: '30%' },
    },
  } as const,
})

/**
 * `.ide-layout__divider` — the `--horizontal` (w-1, bg-border, shrink-0) / `--vertical` (h-1,
 * bg-border, shrink-0) modifiers as an `orientation` variant. (No base rule in the source.)
 */
export const IdeLayoutDividerFrame = styled(View, {
  name: 'IdeLayoutDivider',

  variants: {
    orientation: {
      horizontal: { width: '$1', backgroundColor: '$border', flexShrink: 0 },
      vertical: { height: '$1', backgroundColor: '$border', flexShrink: 0 },
    },
  } as const,
})

export type SplitOrientation = 'horizontal' | 'vertical'
export type PaneRole = 'sidebar' | 'main' | 'editor' | 'terminal'

export interface StyledIdeLayoutProps extends React.ComponentProps<'div'> {}

const Frame = IdeLayoutFrame as unknown as React.ComponentType<any>
export function StyledIdeLayout({ ...props }: StyledIdeLayoutProps) {
  return <Frame {...props} />
}
