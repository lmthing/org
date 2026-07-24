/** step-config-panel.styled.tsx — P2 conversion of the `.step-config-panel` BEM block (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className panel.
 *
 *  `transition-all`/`transition-colors`/`transition-opacity`/`transition-transform` await the
 *  animation driver (§5/P4). */
import * as React from 'react'
import { styled, View } from '../../theme/tamagui-web.config'

/** `.step-config-panel__overlay` — fixed, inset-0, z-50, bottom-sheet flex that centers at sm/$gtXs. */
export const StepConfigPanelOverlayFrame = styled(View, {
  name: 'StepConfigPanelOverlay',
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 50,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  $gtXs: { alignItems: 'center' },
})

/** `.step-config-panel__backdrop` — absolute, inset-0, translucent black scrim, blurred. */
export const StepConfigPanelBackdropFrame = styled(View, {
  name: 'StepConfigPanelBackdrop',
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  backdropFilter: 'blur(4px)',
  // transition-opacity awaits the animation driver (§5/P4)
})

/**
 * `.step-config-panel__panel` — full-width card sheet (max-w 42rem, max-h 90vh) rounded only on top,
 * fully rounded at sm/$gtXs; deep opaque shadow.
 */
export const StepConfigPanelPanelFrame = styled(View, {
  name: 'StepConfigPanelPanel',
  position: 'relative',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  maxWidth: '42rem',
  maxHeight: '90vh',
  backgroundColor: '$card',
  borderTopLeftRadius: '1rem',
  borderTopRightRadius: '1rem',
  borderBottomLeftRadius: 0,
  borderBottomRightRadius: 0,
  // box-shadow 0 25px 50px -12px opaque-black-with-alpha
  shadowColor: 'rgba(0,0,0,0.25)',
  shadowOffset: { width: 0, height: 25 },
  shadowRadius: 50,
  $gtXs: { borderRadius: '1rem' },
})

/** `.step-config-panel__header` — flex, items-center, justify-between, bottom border. */
export const StepConfigPanelHeaderFrame = styled(View, {
  name: 'StepConfigPanelHeader',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingVertical: '$4',
  paddingHorizontal: '$6',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
})

/** `.step-config-panel__close-icon` — w-5 h-5. */
export const StepConfigPanelCloseIconFrame = styled(View, {
  name: 'StepConfigPanelCloseIcon',
  width: '$5',
  height: '$5',
})

/** `.step-config-panel__content` — flex-1, scrollable body. */
export const StepConfigPanelContentFrame = styled(View, {
  name: 'StepConfigPanelContent',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  paddingVertical: '$4',
  paddingHorizontal: '$6',
})

/** `.step-config-panel__content-sections` — flex column, gap 1.5rem. */
export const StepConfigPanelContentSectionsFrame = styled(View, {
  name: 'StepConfigPanelContentSections',
  display: 'flex',
  flexDirection: 'column',
  gap: '$6',
})

/** `.step-config-panel__type-grid` — 1-col grid, gap 0.75rem, mt 0.5rem. */
export const StepConfigPanelTypeGridFrame = styled(View, {
  name: 'StepConfigPanelTypeGrid',
  display: 'grid',
  gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
  gap: '$3',
  marginTop: '$2',
})

/** `.step-config-panel__type-btn` — bordered option card + hover tint and `selected` variant. */
export const StepConfigPanelTypeBtnFrame = styled(View, {
  name: 'StepConfigPanelTypeBtn',
  padding: '$4',
  textAlign: 'left',
  borderRadius: '0.75rem',
  borderWidth: 2,
  borderColor: '$border',
  // transition-all awaits the animation driver (§5/P4)
  hoverStyle: { borderColor: 'color-mix(in srgb, var(--brand-3) 50%, transparent)' },

  variants: {
    selected: {
      true: {
        borderColor: '$brand-3',
        backgroundColor: 'color-mix(in srgb, var(--brand-3) 10%, transparent)',
        outlineWidth: 2,
        outlineStyle: 'solid',
        outlineColor: 'color-mix(in srgb, var(--brand-3) 20%, transparent)',
      },
    },
  } as const,
})

/** `.step-config-panel__type-btn-content` — flex, justify-between, items-center. */
export const StepConfigPanelTypeBtnContentFrame = styled(View, {
  name: 'StepConfigPanelTypeBtnContent',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

/** `.step-config-panel__passes-data-icon` — w-3 h-3. */
export const StepConfigPanelPassesDataIconFrame = styled(View, {
  name: 'StepConfigPanelPassesDataIcon',
  width: '$3',
  height: '$3',
})

/** `.step-config-panel__config-section` — top-bordered flex column, pt 1.5rem. */
export const StepConfigPanelConfigSectionFrame = styled(View, {
  name: 'StepConfigPanelConfigSection',
  borderTopWidth: 1,
  borderTopColor: '$border',
  paddingTop: '$6',
  display: 'flex',
  flexDirection: 'column',
  gap: '$6',
})

/** `.step-config-panel__pushable-row` — flex, items-center, padding 1rem, muted surface. */
export const StepConfigPanelPushableRowFrame = styled(View, {
  name: 'StepConfigPanelPushableRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
  padding: '$4',
  backgroundColor: '$muted',
  borderRadius: '0.75rem',
})

/** `.step-config-panel__toggle` — 48×24 pill track + on (brand-3) / off (muted-foreground) variant. */
export const StepConfigPanelToggleFrame = styled(View, {
  name: 'StepConfigPanelToggle',
  position: 'relative',
  borderRadius: '$radius-full',
  width: '$12',
  height: '$6',
  // transition-colors awaits the animation driver (§5/P4)

  variants: {
    on: {
      true: { backgroundColor: '$brand-3' },
      false: { backgroundColor: '$muted-foreground' },
    },
  } as const,
})

/** `.step-config-panel__toggle-knob` — 16px white knob + on/off travel variant. */
export const StepConfigPanelToggleKnobFrame = styled(View, {
  name: 'StepConfigPanelToggleKnob',
  position: 'absolute',
  borderRadius: '$radius-full',
  backgroundColor: '#fff', // ds-lint-ok: literal bg-white knob (theme-independent)
  // shadow (default) — opaque-black-with-alpha
  shadowColor: 'rgba(0,0,0,0.1)',
  shadowOffset: { width: 0, height: 1 },
  shadowRadius: 3,
  top: '$1',
  width: '$4',
  height: '$4',
  // transition-transform awaits the animation driver (§5/P4)

  variants: {
    on: {
      true: { transform: 'translateX(1.75rem)' }, // translate-x-7
      false: { transform: 'translateX(0.25rem)' }, // translate-x-1
    },
  } as const,
})

/** `.step-config-panel__fragment-list` — flex column, gap 0.5rem. */
export const StepConfigPanelFragmentListFrame = styled(View, {
  name: 'StepConfigPanelFragmentList',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2',
})

/** `.step-config-panel__fragment-item` — flex row, muted surface. */
export const StepConfigPanelFragmentItemFrame = styled(View, {
  name: 'StepConfigPanelFragmentItem',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  padding: '$3',
  backgroundColor: '$muted',
  borderRadius: '0.5rem',
})

/** `.step-config-panel__fragment-remove-icon` — w-4 h-4, destructive. */
export const StepConfigPanelFragmentRemoveIconFrame = styled(View, {
  name: 'StepConfigPanelFragmentRemoveIcon',
  width: '$4',
  height: '$4',
  color: '$destructive',
})

/** `.step-config-panel__add-fragment-btn` — full-width dashed button, brand-3 on hover. */
export const StepConfigPanelAddFragmentBtnFrame = styled(View, {
  name: 'StepConfigPanelAddFragmentBtn',
  width: '100%',
  fontSize: '$sm',
  padding: '$2',
  borderRadius: '0.5rem',
  borderWidth: 2,
  borderStyle: 'dashed',
  borderColor: '$border',
  color: '$muted-foreground',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { borderColor: '$brand-3', color: '$brand-3' },
})

/** `.step-config-panel__tools-grid` — 2-col grid, gap 0.5rem, mt 0.5rem. */
export const StepConfigPanelToolsGridFrame = styled(View, {
  name: 'StepConfigPanelToolsGrid',
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '$2',
  marginTop: '$2',
})

/** `.step-config-panel__tool-btn` — muted bordered button + `selected` (brand-2 tint) variant. */
export const StepConfigPanelToolBtnFrame = styled(View, {
  name: 'StepConfigPanelToolBtn',
  textAlign: 'left',
  fontSize: '$sm',
  padding: '$3',
  borderRadius: '0.5rem',
  borderWidth: 2,
  borderColor: '$border',
  backgroundColor: '$muted',
  // transition-all awaits the animation driver (§5/P4)
  hoverStyle: { borderColor: '$border' },

  variants: {
    selected: {
      true: {
        backgroundColor: 'color-mix(in srgb, var(--brand-2) 15%, transparent)',
        borderColor: '$brand-2',
      },
    },
  } as const,
})

/** `.step-config-panel__instructions-wrapper` — muted surface, padding 1rem. */
export const StepConfigPanelInstructionsWrapperFrame = styled(View, {
  name: 'StepConfigPanelInstructionsWrapper',
  backgroundColor: '$muted',
  borderRadius: '0.75rem',
  padding: '$4',
})

/** `.step-config-panel__template-vars` — brand-3/10 tinted block, mt 0.5rem. */
export const StepConfigPanelTemplateVarsFrame = styled(View, {
  name: 'StepConfigPanelTemplateVars',
  marginTop: '$2',
  padding: '$2',
  backgroundColor: 'color-mix(in srgb, var(--brand-3) 10%, transparent)',
  borderRadius: '0.5rem',
})

/** `.step-config-panel__template-vars-list` — flex-wrap with distinct column/row gaps. */
export const StepConfigPanelTemplateVarsListFrame = styled(View, {
  name: 'StepConfigPanelTemplateVarsList',
  display: 'flex',
  flexWrap: 'wrap',
  columnGap: '$3',
  rowGap: '$1',
  marginTop: '$1',
})

/** `.step-config-panel__model-grid` — 2-col grid, gap 1rem. */
export const StepConfigPanelModelGridFrame = styled(View, {
  name: 'StepConfigPanelModelGrid',
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '$4',
})

/** `.step-config-panel__range-input` — full-width slider, brand-3 accent. */
export const StepConfigPanelRangeInputFrame = styled(View, {
  name: 'StepConfigPanelRangeInput',
  width: '100%',
  marginTop: '$3',
  accentColor: 'var(--brand-3)', // raw CSS accent-color, not token-resolved
})

/** `.step-config-panel__range-labels` — flex, justify-between. */
export const StepConfigPanelRangeLabelsFrame = styled(View, {
  name: 'StepConfigPanelRangeLabels',
  display: 'flex',
  justifyContent: 'space-between',
})

/** `.step-config-panel__footer` — flex, items-center, justify-end, muted bar rounded at the bottom. */
export const StepConfigPanelFooterFrame = styled(View, {
  name: 'StepConfigPanelFooter',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '$3',
  paddingVertical: '$4',
  paddingHorizontal: '$6',
  borderTopWidth: 1,
  borderTopColor: '$border',
  backgroundColor: '$muted',
  borderBottomLeftRadius: '1rem',
  borderBottomRightRadius: '1rem',
})

export interface StyledStepConfigPanelProps extends React.ComponentProps<'div'> {}

const Frame = StepConfigPanelOverlayFrame as unknown as React.ComponentType<any>
export function StyledStepConfigPanel({ ...props }: StyledStepConfigPanelProps) {
  return <Frame {...props} />
}
