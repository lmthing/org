/** ide-file-tree.styled.tsx — P2 conversion of the `.ide-file-tree` BEM block (docs §4).
 *  One styled() per BEM selector; the `__item --active`, `__icon --folder`, `__context-item --danger`
 *  modifiers become variants. Lands alongside the shipped className file tree. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.ide-file-tree` — h-full, bg-card, overflow-auto. */
export const IdeFileTreeFrame = styled(View, {
  name: 'IdeFileTree',
  height: '100%',
  backgroundColor: '$card',
  overflow: 'auto',
})

/** `.ide-file-tree__header` — flex, items-center, justify-between, px-3, py-2, border-b, border-border. */
export const IdeFileTreeHeaderFrame = styled(View, {
  name: 'IdeFileTreeHeader',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

/** `.ide-file-tree__header-title` — text-xs, font-semibold, text-muted-foreground, uppercase, tracking-wider. */
export const IdeFileTreeHeaderTitleFrame = styled(Text, {
  name: 'IdeFileTreeHeaderTitle',
  fontSize: '$xs',
  fontWeight: '$semibold',
  color: '$muted-foreground',
  textTransform: 'uppercase',
  letterSpacing: '$wider',
})

/** `.ide-file-tree__header-actions` — flex, gap-1. */
export const IdeFileTreeHeaderActionsFrame = styled(View, {
  name: 'IdeFileTreeHeaderActions',
  display: 'flex',
  gap: '$1',
})

/**
 * `.ide-file-tree__action-btn` — p-1, rounded, hover:bg-accent, text-muted-foreground,
 * hover:text-foreground. (transition-colors awaits the animation driver.)
 */
export const IdeFileTreeActionBtnFrame = styled(View, {
  name: 'IdeFileTreeActionBtn',
  padding: '$1',
  borderRadius: '$radius',
  color: '$muted-foreground',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: '$accent', color: '$foreground' },
})

/**
 * `.ide-file-tree__item` — flex, items-center, gap-1, px-2, py-1, cursor-pointer, hover:bg-accent,
 * text-sm + the `--active` modifier (bg-primary/20 via color-mix, text-primary) as an `active` variant.
 */
export const IdeFileTreeItemFrame = styled(View, {
  name: 'IdeFileTreeItem',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  paddingHorizontal: '$2',
  paddingVertical: '$1',
  cursor: 'pointer',
  fontSize: '$sm',
  hoverStyle: { backgroundColor: '$accent' },

  variants: {
    active: {
      true: { backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)', color: '$primary' },
    },
  } as const,
})

/**
 * `.ide-file-tree__icon` — shrink-0, text-muted-foreground + the `--folder` modifier (text-primary)
 * as a `folder` variant.
 */
export const IdeFileTreeIconFrame = styled(Text, {
  name: 'IdeFileTreeIcon',
  flexShrink: 0,
  color: '$muted-foreground',

  variants: {
    folder: {
      true: { color: '$primary' },
    },
  } as const,
})

/** `.ide-file-tree__name` — truncate. */
export const IdeFileTreeNameFrame = styled(Text, {
  name: 'IdeFileTreeName',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/**
 * `.ide-file-tree__context-menu` — min-w-[160px], bg-popover, rounded-md, overflow-hidden, p-1,
 * shadow-lg, border, border-border. (shadow-lg single-layer approximation.)
 */
export const IdeFileTreeContextMenuFrame = styled(View, {
  name: 'IdeFileTreeContextMenu',
  minWidth: 160,
  backgroundColor: '$popover',
  borderRadius: '$radius-md',
  overflow: 'hidden',
  padding: '$1',
  borderWidth: 1,
  borderColor: '$border',
  shadowColor: 'rgba(0,0,0,0.1)',
  shadowOffset: { width: 0, height: 10 },
  shadowRadius: 15,
})

/**
 * `.ide-file-tree__context-item` — flex, items-center, gap-2, px-2, py-1.5, text-sm, cursor-pointer,
 * hover:bg-accent, rounded, outline-none + the `--danger` modifier (text-destructive) as a `danger`
 * variant.
 */
export const IdeFileTreeContextItemFrame = styled(View, {
  name: 'IdeFileTreeContextItem',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  paddingHorizontal: '$2',
  paddingVertical: '$1.5',
  fontSize: '$sm',
  cursor: 'pointer',
  borderRadius: '$radius',
  outlineStyle: 'none',
  hoverStyle: { backgroundColor: '$accent' },

  variants: {
    danger: {
      true: { color: '$destructive' },
    },
  } as const,
})

/** `.ide-file-tree__dialog-overlay` — fixed, inset-0, bg-black/50 (achromatic scrim). */
export const IdeFileTreeDialogOverlayFrame = styled(View, {
  name: 'IdeFileTreeDialogOverlay',
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
})

/**
 * `.ide-file-tree__dialog-content` — fixed, top-1/2, left-1/2, centered via translate, bg-card,
 * rounded-lg, p-6, w-96, shadow-xl, border, border-border. (shadow-xl single-layer approximation.)
 */
export const IdeFileTreeDialogContentFrame = styled(View, {
  name: 'IdeFileTreeDialogContent',
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translateX(-50%) translateY(-50%)',
  backgroundColor: '$card',
  borderRadius: '$radius-lg',
  padding: '$6',
  width: '$96',
  borderWidth: 1,
  borderColor: '$border',
  shadowColor: 'rgba(0,0,0,0.1)',
  shadowOffset: { width: 0, height: 20 },
  shadowRadius: 25,
})

/** `.ide-file-tree__dialog-title` — text-lg, font-semibold, mb-4. */
export const IdeFileTreeDialogTitleFrame = styled(Text, {
  name: 'IdeFileTreeDialogTitle',
  fontSize: '$lg',
  fontWeight: '$semibold',
  marginBottom: '$4',
})

/**
 * `.ide-file-tree__dialog-input` — w-full, px-3, py-2, bg-background, rounded, border, border-border,
 * focus:border-primary, outline-none, text-sm.
 */
export const IdeFileTreeDialogInputFrame = styled(View, {
  name: 'IdeFileTreeDialogInput',
  tag: 'input',
  width: '100%',
  paddingHorizontal: '$3',
  paddingVertical: '$2',
  backgroundColor: '$background',
  borderRadius: '$radius',
  borderWidth: 1,
  borderColor: '$border',
  outlineStyle: 'none',
  fontSize: '$sm',
  focusStyle: { borderColor: '$primary' },
})

/** `.ide-file-tree__dialog-actions` — flex, justify-end, gap-2, mt-4. */
export const IdeFileTreeDialogActionsFrame = styled(View, {
  name: 'IdeFileTreeDialogActions',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '$2',
  marginTop: '$4',
})

export interface StyledIdeFileTreeProps extends React.ComponentProps<'div'> {}

const Frame = IdeFileTreeFrame as unknown as React.ComponentType<any>
export function StyledIdeFileTree({ ...props }: StyledIdeFileTreeProps) {
  return <Frame {...props} />
}
