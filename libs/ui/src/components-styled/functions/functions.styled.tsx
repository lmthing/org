/** functions.styled.tsx — P2 conversion of the `.functions-editor` BEM block
 *  (docs/tamagui-idiomatic-migration.md §4). One styled() per BEM selector; `--active` → variant,
 *  `:hover` → hoverStyle. Lands alongside the shipped className FunctionsEditor.
 *  Frame names are globally-unique `Functions*`. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.functions-editor` — flex! flex-col; height:100%; gap:1rem. */
export const FunctionsEditorFrame = styled(View, {
  name: 'FunctionsEditor',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  gap: '$4',
})

/** `.functions-editor__header` — flex! items-center justify-between; bottom border. */
export const FunctionsEditorHeaderFrame = styled(View, {
  name: 'FunctionsEditorHeader',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingTop: 0,
  paddingHorizontal: 0,
  paddingBottom: '$2', // 0.5rem
  borderBottomWidth: 1,
  borderBottomStyle: 'solid',
  borderBottomColor: '$border',
})

/** `.functions-editor__list` — flex! flex-col; gap:0.25rem; min-height:2rem. */
export const FunctionsEditorListFrame = styled(View, {
  name: 'FunctionsEditorList',
  display: 'flex',
  flexDirection: 'column',
  gap: '$1',
  minHeight: '$8', // 2rem
})

/** `.functions-editor__list-item` — flex! items-center justify-between; padded; rounded; hover tint +
 *  `--active` variant. Note: `:hover .functions-editor__list-item-actions { opacity:1 }` is a
 *  descendant-hover reveal the component applies to the actions child. `transition:background`
 *  awaits the animation driver (§5/P4). */
export const FunctionsEditorListItemFrame = styled(View, {
  name: 'FunctionsEditorListItem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingVertical: '$1.5', // 0.375rem
  paddingHorizontal: '$2', // 0.5rem
  borderRadius: '$radius-md', // 0.375rem
  cursor: 'pointer',
  hoverStyle: { backgroundColor: 'var(--color-surface-hover, rgba(0,0,0,0.04))' },
  variants: {
    active: {
      true: { backgroundColor: 'var(--color-surface-active, rgba(0,0,0,0.07))' },
    },
  } as const,
})

/** `.functions-editor__list-item-name` — mono; font-size:0.875rem. */
export const FunctionsEditorListItemNameFrame = styled(Text, {
  name: 'FunctionsEditorListItemName',
  fontFamily: 'monospace',
  fontSize: '$sm',
})

/** `.functions-editor__list-item-actions` — flex! items-center; gap:0.25rem; opacity:0 (revealed on
 *  parent hover). transition:opacity awaits the animation driver (§5/P4). */
export const FunctionsEditorListItemActionsFrame = styled(View, {
  name: 'FunctionsEditorListItemActions',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  opacity: 0,
  variants: {
    revealed: {
      true: { opacity: 1 },
    },
  } as const,
})

/** `.functions-editor__empty` — padding:1rem 0. */
export const FunctionsEditorEmptyFrame = styled(View, {
  name: 'FunctionsEditorEmpty',
  paddingVertical: '$4', // 1rem
  paddingHorizontal: 0,
})

/** `.functions-editor__pane` — flex! flex-col; flex:1; gap:0.5rem. */
export const FunctionsEditorPaneFrame = styled(View, {
  name: 'FunctionsEditorPane',
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  gap: '$2',
})

/** `.functions-editor__pane-header` — flex! items-center justify-between. */
export const FunctionsEditorPaneHeaderFrame = styled(View, {
  name: 'FunctionsEditorPaneHeader',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
})

/** `.functions-editor__textarea` — flex:1; min-height:20rem; mono; resize:vertical; width:100%. */
export const FunctionsEditorTextareaFrame = styled(View, {
  name: 'FunctionsEditorTextarea',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minHeight: '$80', // 20rem
  fontFamily: 'monospace',
  fontSize: 13, // 0.8125rem, no token
  resize: 'vertical',
  width: '100%',
})

/** `.functions-editor__new-form` — flex! items-center; padded; subtle tint; dashed border. */
export const FunctionsEditorNewFormFrame = styled(View, {
  name: 'FunctionsEditorNewForm',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  padding: '$2', // 0.5rem
  backgroundColor: 'var(--color-surface-subtle, rgba(0,0,0,0.02))',
  borderRadius: '$radius-md', // 0.375rem
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: '$border',
})

export interface StyledFunctionsEditorProps extends React.ComponentProps<'div'> {}

const Frame = FunctionsEditorFrame as unknown as React.ComponentType<any>

/** Idiomatic FunctionsEditor shell — renders the `.functions-editor` base frame. */
export function StyledFunctionsEditor({ ...props }: StyledFunctionsEditorProps) {
  return <Frame {...props} />
}
