/** ide-editor.styled.tsx — P2 conversion of the `.ide-editor` BEM block (docs §4).
 *  One styled() per BEM selector; the `__tab` `--active` modifier becomes an `active` variant.
 *  Lands alongside the shipped className editor. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.ide-editor` — h-full, flex, flex-col, bg-background. */
export const IdeEditorFrame = styled(View, {
  name: 'IdeEditor',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: '$background',
})

/** `.ide-editor__tabs` — flex, items-center, bg-card, border-b, border-border, overflow-x-auto, shrink-0. */
export const IdeEditorTabsFrame = styled(View, {
  name: 'IdeEditorTabs',
  display: 'flex',
  alignItems: 'center',
  backgroundColor: '$card',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  overflowX: 'auto',
  flexShrink: 0,
})

/**
 * `.ide-editor__tab` — flex, items-center, gap-2, px-3, py-1.5, border-r, border-border, cursor-pointer,
 * text-sm, text-muted-foreground, hover:text-foreground + the `--active` modifier as an `active`
 * variant (bg-background, text-foreground). (transition-colors awaits the animation driver.)
 */
export const IdeEditorTabFrame = styled(View, {
  name: 'IdeEditorTab',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  paddingHorizontal: '$3',
  paddingVertical: '$1.5',
  borderRightWidth: 1,
  borderRightColor: '$border',
  cursor: 'pointer',
  fontSize: '$sm',
  color: '$muted-foreground',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { color: '$foreground' },

  variants: {
    active: {
      true: { backgroundColor: '$background', color: '$foreground' },
    },
  } as const,
})

/**
 * `.ide-editor__tab-close` — p-0.5, rounded, hover:bg-accent. (transition-colors awaits the driver.)
 */
export const IdeEditorTabCloseFrame = styled(View, {
  name: 'IdeEditorTabClose',
  padding: '$0.5',
  borderRadius: '$radius',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: '$accent' },
})

/** `.ide-editor__empty` — flex-1, flex, items-center, justify-center, text-muted-foreground, text-sm. */
export const IdeEditorEmptyFrame = styled(Text, {
  name: 'IdeEditorEmpty',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '$muted-foreground',
  fontSize: '$sm',
})

/** `.ide-editor__content` — flex-1, min-h-0. */
export const IdeEditorContentFrame = styled(View, {
  name: 'IdeEditorContent',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minHeight: 0,
})

export interface StyledIdeEditorProps extends React.ComponentProps<'div'> {}

const Frame = IdeEditorFrame as unknown as React.ComponentType<any>
export function StyledIdeEditor({ ...props }: StyledIdeEditorProps) {
  return <Frame {...props} />
}
