/** component-editor.styled.tsx — P2 conversion of the `.component-editor` BEM block
 *  (docs/tamagui-idiomatic-migration.md §4). One styled() per BEM selector; `--active` /
 *  `--view`/`--form` → variants, `:hover` → hoverStyle. Lands alongside the shipped className
 *  ComponentEditor. Frame names are globally-unique `ComponentEditor*`. */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.component-editor` — flex! flex-col; height:100%; gap:1rem. */
export const ComponentEditorFrame = styled(View, {
  name: 'ComponentEditor',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  gap: '$4',
})

/** `.component-editor__header` — flex! items-center justify-between; bottom border. */
export const ComponentEditorHeaderFrame = styled(View, {
  name: 'ComponentEditorHeader',
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

/** `.component-editor__section-title` — flex! items-center; gap:0.5rem; margin-bottom:0.375rem. */
export const ComponentEditorSectionTitleFrame = styled(View, {
  name: 'ComponentEditorSectionTitle',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  marginBottom: '$1.5', // 0.375rem
})

/** `.component-editor__kind-badge` — pill badge + `--view`/`--form` tint modifiers → `kind` variant. */
export const ComponentEditorKindBadgeFrame = styled(Text, {
  name: 'ComponentEditorKindBadge',
  fontSize: 11, // 0.6875rem, no token
  paddingVertical: '$0.5', // 0.125rem
  paddingHorizontal: '$1.5', // 0.375rem
  borderRadius: '$radius-full', // 9999px
  fontWeight: '$semibold',
  textTransform: 'uppercase',
  letterSpacing: '0.04em' as unknown as number, // arbitrary em, no token
  variants: {
    kind: {
      // --view: knowledge 15% tint / knowledge text
      view: { backgroundColor: 'color-mix(in srgb, var(--knowledge) 15%, transparent)', color: '$knowledge' },
      // --form: success 15% tint / success text (var(--color-success) → $success)
      form: { backgroundColor: 'color-mix(in srgb, var(--success) 15%, transparent)', color: '$success' },
    },
  } as const,
})

/** `.component-editor__list` — flex! flex-col; gap:0.25rem; min-height:2rem. */
export const ComponentEditorListFrame = styled(View, {
  name: 'ComponentEditorList',
  display: 'flex',
  flexDirection: 'column',
  gap: '$1',
  minHeight: '$8', // 2rem
})

/** `.component-editor__list-item` — flex! items-center justify-between; padded; rounded; hover tint +
 *  `--active` variant. Note: `:hover .component-editor__list-item-actions { opacity:1 }` is a
 *  descendant-hover reveal the component applies to the actions child. `transition:background`
 *  awaits the animation driver (§5/P4). */
export const ComponentEditorListItemFrame = styled(View, {
  name: 'ComponentEditorListItem',
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

/** `.component-editor__list-item-name` — mono; font-size:0.875rem. */
export const ComponentEditorListItemNameFrame = styled(Text, {
  name: 'ComponentEditorListItemName',
  fontFamily: 'monospace',
  fontSize: '$sm',
})

/** `.component-editor__list-item-actions` — flex! items-center; gap:0.25rem; opacity:0 (revealed on
 *  parent hover). transition:opacity awaits the animation driver (§5/P4). */
export const ComponentEditorListItemActionsFrame = styled(View, {
  name: 'ComponentEditorListItemActions',
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

/** `.component-editor__empty` — padding:0.75rem 0. */
export const ComponentEditorEmptyFrame = styled(View, {
  name: 'ComponentEditorEmpty',
  paddingVertical: '$3', // 0.75rem
  paddingHorizontal: 0,
})

/** `.component-editor__pane` — flex! flex-col; flex:1; gap:0.5rem. */
export const ComponentEditorPaneFrame = styled(View, {
  name: 'ComponentEditorPane',
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  gap: '$2',
})

/** `.component-editor__pane-header` — flex! items-center justify-between. */
export const ComponentEditorPaneHeaderFrame = styled(View, {
  name: 'ComponentEditorPaneHeader',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
})

/** `.component-editor__textarea` — flex:1; min-height:20rem; mono; resize:vertical; width:100%. */
export const ComponentEditorTextareaFrame = styled(View, {
  name: 'ComponentEditorTextarea',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minHeight: '$80', // 20rem
  fontFamily: 'monospace',
  fontSize: 13, // 0.8125rem, no token
  resize: 'vertical',
  width: '100%',
})

/** `.component-editor__new-form` — flex! items-center; padded; subtle tint; dashed border. */
export const ComponentEditorNewFormFrame = styled(View, {
  name: 'ComponentEditorNewForm',
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

export interface StyledComponentEditorProps extends React.ComponentProps<'div'> {}

const Frame = ComponentEditorFrame as unknown as React.ComponentType<any>

/** Idiomatic ComponentEditor shell — renders the `.component-editor` base frame. */
export function StyledComponentEditor({ ...props }: StyledComponentEditorProps) {
  return <Frame {...props} />
}
