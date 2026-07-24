/** step-schema-editor.styled.tsx — P2 conversion of the `.schema-editor`, `.property-row` and
 *  `.nested-properties` BEM blocks (docs §4). One styled() per BEM selector; modifiers → variants.
 *  Lands alongside the shipped className editor.
 *
 *  `transition-all`/`transition-colors`/`transition-transform` await the animation driver (§5/P4). */
import * as React from 'react'
import { styled, View } from '../../theme/tamagui-web.config'

/** `.schema-editor` — muted rounded shell, clipped. */
export const SchemaEditorFrame = styled(View, {
  name: 'SchemaEditor',
  backgroundColor: '$muted',
  borderRadius: '0.75rem',
  overflow: 'hidden',
})

/** `.schema-editor__header` — flex, items-center, justify-between, bottom border. */
export const SchemaEditorHeaderFrame = styled(View, {
  name: 'SchemaEditorHeader',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingVertical: '$2',
  paddingHorizontal: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

/** `.schema-editor__mode-toggle` — segmented control shell. */
export const SchemaEditorModeToggleFrame = styled(View, {
  name: 'SchemaEditorModeToggle',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  backgroundColor: '$muted',
  borderRadius: '0.5rem',
  padding: '$1',
})

/** `.schema-editor__mode-btn` — text button + `active` (card surface + shadow-sm) variant. */
export const SchemaEditorModeBtnFrame = styled(View, {
  name: 'SchemaEditorModeBtn',
  fontSize: '$sm',
  fontWeight: '$medium',
  paddingVertical: '$1',
  paddingHorizontal: '$3',
  borderRadius: '0.375rem',
  color: '$muted-foreground',
  // transition-all awaits the animation driver (§5/P4)
  hoverStyle: { color: '$foreground' },

  variants: {
    active: {
      true: {
        backgroundColor: '$card',
        color: '$foreground',
        // shadow-sm (opaque-black-with-alpha)
        shadowColor: 'rgba(0,0,0,0.05)',
        shadowOffset: { width: 0, height: 1 },
        shadowRadius: 2,
      },
    },
  } as const,
})

/** `.schema-editor__body` — padding 0.75rem. */
export const SchemaEditorBodyFrame = styled(View, {
  name: 'SchemaEditorBody',
  padding: '$3',
})

/** `.schema-editor__empty` — centered, py 2rem. */
export const SchemaEditorEmptyFrame = styled(View, {
  name: 'SchemaEditorEmpty',
  textAlign: 'center',
  paddingVertical: '$8',
  paddingHorizontal: 0,
})

/** `.schema-editor__empty-icon-wrapper` — 48px centered muted circle, mb 0.75rem. */
export const SchemaEditorEmptyIconWrapperFrame = styled(View, {
  name: 'SchemaEditorEmptyIconWrapper',
  width: '$12',
  height: '$12',
  borderRadius: '$radius-full',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginHorizontal: 'auto',
  backgroundColor: '$muted',
  marginBottom: '$3',
})

/** `.schema-editor__empty-icon` — w-6 h-6, muted-foreground. */
export const SchemaEditorEmptyIconFrame = styled(View, {
  name: 'SchemaEditorEmptyIcon',
  width: '$6',
  height: '$6',
  color: '$muted-foreground',
})

/** `.schema-editor__empty-caption` — mb 1rem. */
export const SchemaEditorEmptyCaptionFrame = styled(View, {
  name: 'SchemaEditorEmptyCaption',
  marginBottom: '$4',
})

/** `.schema-editor__property-list` — flex column, gap 0.5rem. */
export const SchemaEditorPropertyListFrame = styled(View, {
  name: 'SchemaEditorPropertyList',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2',
})

/** `.schema-editor__add-btn` — full-width dashed button, centered, brand-3 on hover. */
export const SchemaEditorAddBtnFrame = styled(View, {
  name: 'SchemaEditorAddBtn',
  width: '100%',
  fontSize: '$sm',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$2',
  padding: '$3',
  borderRadius: '0.75rem',
  borderWidth: 2,
  borderStyle: 'dashed',
  borderColor: '$border',
  color: '$muted-foreground',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { borderColor: '$brand-3', color: '$brand-3' },
})

/** `.schema-editor__add-icon` — w-4 h-4. */
export const SchemaEditorAddIconFrame = styled(View, {
  name: 'SchemaEditorAddIcon',
  width: '$4',
  height: '$4',
})

/** `.schema-editor__code-textarea` — monospace, min-height 15rem. */
export const SchemaEditorCodeTextareaFrame = styled(View, {
  name: 'SchemaEditorCodeTextarea',
  fontFamily: 'monospace',
  minHeight: '15rem',
})

/** `.schema-editor__code-error` — Tailwind red-500 var (no token), mt 0.5rem. */
export const SchemaEditorCodeErrorFrame = styled(View, {
  name: 'SchemaEditorCodeError',
  color: 'var(--color-red-500)', // raw Tailwind var, no design-system token exists
  marginTop: '$2',
})

/* ── PropertyRow (`.property-row`) ──────────────────────────────────── */

/** `.property-row` — bordered card, clipped. */
export const PropertyRowFrame = styled(View, {
  name: 'PropertyRow',
  borderWidth: 1,
  borderColor: '$border',
  borderRadius: '0.75rem',
  overflow: 'hidden',
  backgroundColor: '$card',
})

/** `.property-row__main` — flex row + `clickable` variant (pointer + muted hover). */
export const PropertyRowMainFrame = styled(View, {
  name: 'PropertyRowMain',
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
  padding: '$3',

  variants: {
    clickable: {
      true: { cursor: 'pointer', hoverStyle: { backgroundColor: '$muted' } },
    },
  } as const,
})

/** `.property-row__move-buttons` — tight flex column. */
export const PropertyRowMoveButtonsFrame = styled(View, {
  name: 'PropertyRowMoveButtons',
  display: 'flex',
  flexDirection: 'column',
  gap: '$0.5',
})

/** `.property-row__move-icon` — w-3.5 h-3.5. */
export const PropertyRowMoveIconFrame = styled(View, {
  name: 'PropertyRowMoveIcon',
  width: '$3.5',
  height: '$3.5',
})

/** `.property-row__expand-btn` — p-1 rounded button, muted-foreground, muted hover. */
export const PropertyRowExpandBtnFrame = styled(View, {
  name: 'PropertyRowExpandBtn',
  padding: '$1',
  borderRadius: '$radius',
  color: '$muted-foreground',
  hoverStyle: { backgroundColor: '$muted' },
})

/** `.property-row__expand-icon` — w-4 h-4 + `open` variant (rotate-90). */
export const PropertyRowExpandIconFrame = styled(View, {
  name: 'PropertyRowExpandIcon',
  width: '$4',
  height: '$4',
  // transition-transform awaits the animation driver (§5/P4)

  variants: {
    open: {
      true: { transform: 'rotate(90deg)' },
    },
  } as const,
})

/** `.property-row__name-input` — grows from a 120px basis, monospace. */
export const PropertyRowNameInputFrame = styled(View, {
  name: 'PropertyRowNameInput',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 120, // flex: 1 1 120px
  fontFamily: 'monospace',
})

/** `.property-row__type-icon` — p-1.5 rounded tile + per-type color variant. */
export const PropertyRowTypeIconFrame = styled(View, {
  name: 'PropertyRowTypeIcon',
  padding: '$1.5',
  borderRadius: '$radius-lg',

  variants: {
    type: {
      string: { backgroundColor: 'color-mix(in srgb, var(--brand-1) 15%, transparent)', color: '$brand-1' },
      number: { backgroundColor: 'color-mix(in srgb, var(--brand-2) 15%, transparent)', color: '$brand-2' },
      boolean: { backgroundColor: 'color-mix(in srgb, var(--brand-2) 15%, transparent)', color: '$brand-2' },
      object: { backgroundColor: 'color-mix(in srgb, var(--brand-3) 15%, transparent)', color: '$brand-3' },
      array: { backgroundColor: 'color-mix(in srgb, var(--destructive) 15%, transparent)', color: '$destructive' },
    },
  } as const,
})

/** `.property-row__icon` — w-4 h-4. */
export const PropertyRowIconFrame = styled(View, {
  name: 'PropertyRowIcon',
  width: '$4',
  height: '$4',
})

/** `.property-row__required-btn` — small pill + required (destructive tint + ring) / optional variant. */
export const PropertyRowRequiredBtnFrame = styled(View, {
  name: 'PropertyRowRequiredBtn',
  fontSize: '$xs',
  fontWeight: '$medium',
  paddingVertical: '$1.5',
  paddingHorizontal: '$2.5',
  borderRadius: '0.5rem',
  // transition-all awaits the animation driver (§5/P4)

  variants: {
    state: {
      required: {
        backgroundColor: 'color-mix(in srgb, var(--destructive) 15%, transparent)',
        color: '$destructive',
        outlineWidth: 1,
        outlineStyle: 'solid',
        outlineColor: 'color-mix(in srgb, var(--destructive) 30%, transparent)',
      },
      optional: {
        backgroundColor: '$muted',
        color: '$muted-foreground',
        hoverStyle: { backgroundColor: '$muted' },
      },
    },
  } as const,
})

/** `.property-row__description-hint` — truncated 100px hint. */
export const PropertyRowDescriptionHintFrame = styled(View, {
  name: 'PropertyRowDescriptionHint',
  maxWidth: 100,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** `.property-row__actions` — flex, items-center, gap 0.25rem. */
export const PropertyRowActionsFrame = styled(View, {
  name: 'PropertyRowActions',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
})

/** `.property-row__delete-icon` — w-4 h-4, destructive. */
export const PropertyRowDeleteIconFrame = styled(View, {
  name: 'PropertyRowDeleteIcon',
  width: '$4',
  height: '$4',
  color: '$destructive',
})

/** `.property-row__type-options` — top-bordered, ph 0.75rem, pb 0.75rem. */
export const PropertyRowTypeOptionsFrame = styled(View, {
  name: 'PropertyRowTypeOptions',
  paddingTop: 0,
  paddingHorizontal: '$3',
  paddingBottom: '$3',
  borderTopWidth: 1,
  borderTopColor: '$border',
})

/** `.property-row__type-options-inner` — flex, items-center, gap 1rem, pt 0.75rem. */
export const PropertyRowTypeOptionsInnerFrame = styled(View, {
  name: 'PropertyRowTypeOptionsInner',
  display: 'flex',
  alignItems: 'center',
  gap: '$4',
  paddingTop: '$3',
})

/** `.property-row__enum-input` — flex: 1. */
export const PropertyRowEnumInputFrame = styled(View, {
  name: 'PropertyRowEnumInput',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.property-row__range-inputs` — flex, items-center, gap 0.5rem. */
export const PropertyRowRangeInputsFrame = styled(View, {
  name: 'PropertyRowRangeInputs',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.property-row__range-input` — width 5rem. */
export const PropertyRowRangeInputFrame = styled(View, {
  name: 'PropertyRowRangeInput',
  width: '$20',
})

/** `.property-row__range-arrow` — muted-foreground. */
export const PropertyRowRangeArrowFrame = styled(View, {
  name: 'PropertyRowRangeArrow',
  color: '$muted-foreground',
})

/** `.property-row__description-input` — flex: 1. */
export const PropertyRowDescriptionInputFrame = styled(View, {
  name: 'PropertyRowDescriptionInput',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.property-row__nested` — top-bordered, padding 0.75rem, muted/50 tint. */
export const PropertyRowNestedFrame = styled(View, {
  name: 'PropertyRowNested',
  borderTopWidth: 1,
  borderTopColor: '$border',
  padding: '$3',
  backgroundColor: 'color-mix(in srgb, var(--muted) 50%, transparent)',
})

/** `.property-row__array-item` — bordered card row, mt 0.5rem. */
export const PropertyRowArrayItemFrame = styled(View, {
  name: 'PropertyRowArrayItem',
  backgroundColor: '$card',
  borderRadius: '0.5rem',
  borderWidth: 1,
  borderColor: '$border',
  padding: '$3',
  marginTop: '$2',
})

/** `.property-row__array-item-inner` — flex, items-center, gap 0.75rem. */
export const PropertyRowArrayItemInnerFrame = styled(View, {
  name: 'PropertyRowArrayItemInner',
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
})

/** `.property-row__array-spacer` — flex: 1. */
export const PropertyRowArraySpacerFrame = styled(View, {
  name: 'PropertyRowArraySpacer',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.property-row__add-item-btn` — full-width dashed button, mt 0.5rem, brand-3 on hover. */
export const PropertyRowAddItemBtnFrame = styled(View, {
  name: 'PropertyRowAddItemBtn',
  width: '100%',
  fontSize: '$sm',
  padding: '$2',
  marginTop: '$2',
  borderRadius: '0.5rem',
  borderWidth: 2,
  borderStyle: 'dashed',
  borderColor: '$border',
  color: '$muted-foreground',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { borderColor: '$brand-3', color: '$brand-3' },
})

/* ── NestedPropertiesEditor (`.nested-properties`) ──────────────────── */

/** `.nested-properties` — flex column, gap 0.5rem. */
export const NestedPropertiesFrame = styled(View, {
  name: 'NestedProperties',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2',
})

/** `.nested-properties__add-btn` — width 100%. */
export const NestedPropertiesAddBtnFrame = styled(View, {
  name: 'NestedPropertiesAddBtn',
  width: '100%',
})

/** `.nested-properties__add-icon` — w-4 h-4. */
export const NestedPropertiesAddIconFrame = styled(View, {
  name: 'NestedPropertiesAddIcon',
  width: '$4',
  height: '$4',
})

export interface StyledStepSchemaEditorProps extends React.ComponentProps<'div'> {}

const Frame = SchemaEditorFrame as unknown as React.ComponentType<any>
export function StyledStepSchemaEditor({ ...props }: StyledStepSchemaEditorProps) {
  return <Frame {...props} />
}
