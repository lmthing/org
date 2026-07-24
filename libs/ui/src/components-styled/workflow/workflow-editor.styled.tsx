/** workflow-editor.styled.tsx — P2 conversion of the `.workflow-editor` BEM block (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className editor.
 *
 *  `transition-all`/`transition-colors` await the animation driver (§5/P4). */
import * as React from 'react'
import { styled, View } from '../../theme/tamagui-web.config'

/** `.workflow-editor` — min-h-screen, muted background. */
export const WorkflowEditorFrame = styled(View, {
  name: 'WorkflowEditor',
  minHeight: '100vh',
  backgroundColor: '$muted',
})

/** `.workflow-editor__header` — sticky card bar, bottom border, z-20. */
export const WorkflowEditorHeaderFrame = styled(View, {
  name: 'WorkflowEditorHeader',
  backgroundColor: '$card',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  position: 'sticky',
  top: 0,
  zIndex: 20,
})

/** `.workflow-editor__header-inner` — centered max-w-4xl, py-4, responsive horizontal padding. */
export const WorkflowEditorHeaderInnerFrame = styled(View, {
  name: 'WorkflowEditorHeaderInner',
  maxWidth: '56rem', // max-w-4xl, no token → literal
  marginHorizontal: 'auto',
  paddingVertical: '$4',
  paddingLeft: '$4',
  paddingRight: '$4',
  $gtXs: { paddingLeft: '$6', paddingRight: '$6' },
  $gtMd: { paddingLeft: '$8', paddingRight: '$8' },
})

/** `.workflow-editor__header-top` — flex, items-center, gap-4, mb 1rem. */
export const WorkflowEditorHeaderTopFrame = styled(View, {
  name: 'WorkflowEditorHeaderTop',
  display: 'flex',
  alignItems: 'center',
  gap: '$4',
  marginBottom: '$4',
})

/** `.workflow-editor__back-icon` — w-5 h-5. */
export const WorkflowEditorBackIconFrame = styled(View, {
  name: 'WorkflowEditorBackIcon',
  width: '$5',
  height: '$5',
})

/** `.workflow-editor__title-area` — flex: 1. */
export const WorkflowEditorTitleAreaFrame = styled(View, {
  name: 'WorkflowEditorTitleArea',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.workflow-editor__title-row` — flex, items-center, gap-4. */
export const WorkflowEditorTitleRowFrame = styled(View, {
  name: 'WorkflowEditorTitleRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$4',
})

/**
 * `.workflow-editor__icon-box` — 40px centered brand-5 tile. The source `linear-gradient(brand-5 →
 * brand-5)` is a single-hue gradient, simplified to a solid brand-5 fill; tinted brand-5/25 shadow.
 */
export const WorkflowEditorIconBoxFrame = styled(View, {
  name: 'WorkflowEditorIconBox',
  width: '$10',
  height: '$10',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '0.75rem',
  backgroundColor: '$brand-5',
  shadowColor: 'color-mix(in srgb, var(--brand-5) 25%, transparent)',
  shadowOffset: { width: 0, height: 10 },
  shadowRadius: 15,
})

/** `.workflow-editor__icon-box-svg` — w-5 h-5, text-white. */
export const WorkflowEditorIconBoxSvgFrame = styled(View, {
  name: 'WorkflowEditorIconBoxSvg',
  width: '$5',
  height: '$5',
  color: '#fff', // ds-lint-ok: literal text-white (theme-independent), not a dark-flipping token
})

/** `.workflow-editor__meta-form` — 1-col grid (2-col at sm/$gtXs), gap-4, p-4, muted surface. */
export const WorkflowEditorMetaFormFrame = styled(View, {
  name: 'WorkflowEditorMetaForm',
  display: 'grid',
  gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
  gap: '$4',
  padding: '$4',
  backgroundColor: '$muted',
  borderRadius: '0.75rem',
  $gtXs: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
})

/** `.workflow-editor__meta-full` — full-width grid cell (spans both columns at sm/$gtXs). */
export const WorkflowEditorMetaFullFrame = styled(View, {
  name: 'WorkflowEditorMetaFull',
  gridColumn: '1 / -1',
  $gtXs: { gridColumn: 'span 2 / span 2' },
})

/** `.workflow-editor__tag-list` — flex, flex-wrap, gap 0.5rem. */
export const WorkflowEditorTagListFrame = styled(View, {
  name: 'WorkflowEditorTagList',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '$2',
})

/** `.workflow-editor__tag-btn` — pill button + active (brand-5 tint + ring-1) / inactive variants. */
export const WorkflowEditorTagBtnFrame = styled(View, {
  name: 'WorkflowEditorTagBtn',
  fontSize: '$sm',
  fontWeight: '$medium',
  paddingVertical: '$1',
  paddingHorizontal: '$3',
  borderRadius: '$radius-full',
  // transition-all awaits the animation driver (§5/P4)

  variants: {
    state: {
      active: {
        backgroundColor: 'color-mix(in srgb, var(--brand-5) 15%, transparent)',
        color: '$brand-5',
        outlineWidth: 1,
        outlineStyle: 'solid',
        outlineColor: 'color-mix(in srgb, var(--brand-5) 30%, transparent)',
      },
      inactive: {
        backgroundColor: '$muted',
        color: '$muted-foreground',
        hoverStyle: { backgroundColor: '$muted' },
      },
    },
  } as const,
})

/** `.workflow-editor__main` — centered max-w-4xl, py-8, responsive horizontal padding. */
export const WorkflowEditorMainFrame = styled(View, {
  name: 'WorkflowEditorMain',
  maxWidth: '56rem',
  marginHorizontal: 'auto',
  paddingVertical: '$8',
  paddingLeft: '$4',
  paddingRight: '$4',
  $gtXs: { paddingLeft: '$6', paddingRight: '$6' },
  $gtMd: { paddingLeft: '$8', paddingRight: '$8' },
})

/** `.workflow-editor__stats` — 3-col grid, gap-4, mb 2rem. */
export const WorkflowEditorStatsFrame = styled(View, {
  name: 'WorkflowEditorStats',
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '$4',
  marginBottom: '$8',
})

/** `.workflow-editor__steps-section` — mb 1.5rem. */
export const WorkflowEditorStepsSectionFrame = styled(View, {
  name: 'WorkflowEditorStepsSection',
  marginBottom: '$6',
})

/** `.workflow-editor__steps-header` — flex, justify-between, items-center, mb 1rem. */
export const WorkflowEditorStepsHeaderFrame = styled(View, {
  name: 'WorkflowEditorStepsHeader',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '$4',
})

/** `.workflow-editor__add-icon` — w-4 h-4. */
export const WorkflowEditorAddIconFrame = styled(View, {
  name: 'WorkflowEditorAddIcon',
  width: '$4',
  height: '$4',
})

/** `.workflow-editor__empty` — centered dashed card, padding 3rem. */
export const WorkflowEditorEmptyFrame = styled(View, {
  name: 'WorkflowEditorEmpty',
  textAlign: 'center',
  backgroundColor: '$card',
  borderRadius: '0.75rem',
  borderWidth: 2,
  borderStyle: 'dashed',
  borderColor: '$border',
  padding: '$12',
})

/** `.workflow-editor__empty-icon-wrapper` — 64px centered muted circle, mb 1rem. */
export const WorkflowEditorEmptyIconWrapperFrame = styled(View, {
  name: 'WorkflowEditorEmptyIconWrapper',
  width: '$16',
  height: '$16',
  borderRadius: '$radius-full',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginHorizontal: 'auto',
  backgroundColor: '$muted',
  marginBottom: '$4',
})

/** `.workflow-editor__empty-icon` — w-8 h-8, muted-foreground. */
export const WorkflowEditorEmptyIconFrame = styled(View, {
  name: 'WorkflowEditorEmptyIcon',
  width: '$8',
  height: '$8',
  color: '$muted-foreground',
})

/** `.workflow-editor__empty-caption` — mb 1.5rem. */
export const WorkflowEditorEmptyCaptionFrame = styled(View, {
  name: 'WorkflowEditorEmptyCaption',
  marginBottom: '$6',
})

/** `.workflow-editor__steps-list` — flex column, gap 0.5rem. */
export const WorkflowEditorStepsListFrame = styled(View, {
  name: 'WorkflowEditorStepsList',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2',
})

/** `.workflow-editor__step-wrapper` — relative. */
export const WorkflowEditorStepWrapperFrame = styled(View, {
  name: 'WorkflowEditorStepWrapper',
  position: 'relative',
})

/** `.workflow-editor__insert-btn-wrapper` — absolute, z-10, horizontally centered above the step. */
export const WorkflowEditorInsertBtnWrapperFrame = styled(View, {
  name: 'WorkflowEditorInsertBtnWrapper',
  position: 'absolute',
  zIndex: 10,
  top: '-1.5rem',
  left: '50%',
  transform: 'translateX(-50%)',
})

/**
 * `.workflow-editor__insert-btn` — hidden brand-5 pill button; the `revealed` variant stands in for
 * `.group:hover .workflow-editor__insert-btn { opacity: 1 }`.
 */
export const WorkflowEditorInsertBtnFrame = styled(View, {
  name: 'WorkflowEditorInsertBtn',
  padding: '$1.5',
  borderRadius: '$radius-full',
  backgroundColor: 'color-mix(in srgb, var(--brand-5) 15%, transparent)',
  color: '$brand-5',
  opacity: 0,
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: 'color-mix(in srgb, var(--brand-5) 25%, transparent)' },

  variants: {
    revealed: {
      true: { opacity: 1 },
    },
  } as const,
})

/** `.workflow-editor__insert-btn-icon` — w-4 h-4. */
export const WorkflowEditorInsertBtnIconFrame = styled(View, {
  name: 'WorkflowEditorInsertBtnIcon',
  width: '$4',
  height: '$4',
})

/**
 * `.workflow-editor__output-panel` — p-6 panel with a two-tone brand-5/10 → brand-2/10 diagonal
 * gradient (preserved as a web backgroundImage passthrough) and a brand-5/30 border.
 */
export const WorkflowEditorOutputPanelFrame = styled(View, {
  name: 'WorkflowEditorOutputPanel',
  padding: '$6',
  backgroundImage:
    'linear-gradient(to bottom right, color-mix(in srgb, var(--brand-5) 10%, transparent), color-mix(in srgb, var(--brand-2) 10%, transparent))',
  borderRadius: '0.75rem',
  borderWidth: 1,
  borderColor: 'color-mix(in srgb, var(--brand-5) 30%, transparent)',
})

/** `.workflow-editor__output-caption` — mb 1rem. */
export const WorkflowEditorOutputCaptionFrame = styled(View, {
  name: 'WorkflowEditorOutputCaption',
  marginBottom: '$4',
})

/** `.workflow-editor__output-field` — ml 1rem. */
export const WorkflowEditorOutputFieldFrame = styled(View, {
  name: 'WorkflowEditorOutputField',
  marginLeft: '$4',
})

export interface StyledWorkflowEditorProps extends React.ComponentProps<'div'> {}

const Frame = WorkflowEditorFrame as unknown as React.ComponentType<any>
export function StyledWorkflowEditor({ ...props }: StyledWorkflowEditorProps) {
  return <Frame {...props} />
}
