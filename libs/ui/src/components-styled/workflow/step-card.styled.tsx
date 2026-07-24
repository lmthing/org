/** step-card.styled.tsx — P2 conversion of the `.step-card` and `.step-preview` BEM blocks (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className cards.
 *
 *  `transition-all duration-200`/`transition-colors`/`transition-opacity` await the animation driver (§5/P4). */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.step-card` — relative wrapper + `expanded` variant (ring-2 ring-brand-3 ring-offset-2). */
export const StepCardFrame = styled(View, {
  name: 'StepCard',
  position: 'relative',
  // transition-all duration-200 awaits the animation driver (§5/P4)

  variants: {
    expanded: {
      true: { outlineWidth: 2, outlineStyle: 'solid', outlineColor: '$brand-3', outlineOffset: 2 },
    },
  } as const,
})

/**
 * `.step-card__connector-top` — absolute 1px rail above the card. The two-tone vertical
 * `linear-gradient(transparent → border)` is preserved as a web backgroundImage passthrough.
 */
export const StepCardConnectorTopFrame = styled(View, {
  name: 'StepCardConnectorTop',
  position: 'absolute',
  width: 1,
  top: '-1rem',
  left: '$6',
  height: '$4',
  backgroundImage: 'linear-gradient(to bottom, transparent, var(--border), var(--border))',
})

/**
 * `.step-card__body` — relative, bg-card, radius 0.75rem, 2px border + `:hover` (brand-3/50 border,
 * brand-3/5 tinted shadow) and the `invalid` variant (destructive/50 border).
 */
export const StepCardBodyFrame = styled(View, {
  name: 'StepCardBody',
  position: 'relative',
  cursor: 'pointer',
  backgroundColor: '$card',
  borderRadius: '0.75rem',
  borderWidth: 2,
  borderColor: '$border',
  // transition-all duration-200 awaits the animation driver (§5/P4)
  hoverStyle: {
    borderColor: 'color-mix(in srgb, var(--brand-3) 50%, transparent)',
    shadowColor: 'color-mix(in srgb, var(--brand-3) 5%, transparent)',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 15,
  },

  variants: {
    invalid: {
      true: { borderColor: 'color-mix(in srgb, var(--destructive) 50%, transparent)' },
    },
  } as const,
})

/** `.step-card__inner` — p-4, bumped to p-5 at sm/$gtXs. */
export const StepCardInnerFrame = styled(View, {
  name: 'StepCardInner',
  padding: '$4',
  $gtXs: { padding: '$5' },
})

/** `.step-card__content` — flex, items-start, gap 1rem. */
export const StepCardContentFrame = styled(View, {
  name: 'StepCardContent',
  display: 'flex',
  alignItems: 'flex-start',
  gap: '$4',
})

/** `.step-card__drag-handle` — 32px grab target, muted surface + grabbing press state. */
export const StepCardDragHandleFrame = styled(View, {
  name: 'StepCardDragHandle',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '$8',
  height: '$8',
  borderRadius: '$radius-lg',
  cursor: 'grab',
  marginTop: '$1',
  backgroundColor: '$muted',
  color: '$muted-foreground',
  // transition-colors awaits the animation driver (§5/P4)
  hoverStyle: { backgroundColor: '$muted' },
  pressStyle: { cursor: 'grabbing' }, // :active → cursor: grabbing
})

/** `.step-card__drag-icon` — w-4 h-4. */
export const StepCardDragIconFrame = styled(View, {
  name: 'StepCardDragIcon',
  width: '$4',
  height: '$4',
})

/** `.step-card__type-indicator` — 40px monospace badge, semibold. */
export const StepCardTypeIndicatorFrame = styled(View, {
  name: 'StepCardTypeIndicator',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '$10',
  height: '$10',
  borderRadius: '$radius-lg',
  fontFamily: 'monospace',
  fontSize: '$sm',
  fontWeight: '$semibold',
})

/** `.step-card__info` — flex-1, min-w-0. */
export const StepCardInfoFrame = styled(View, {
  name: 'StepCardInfo',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
})

/** `.step-card__title-row` — flex, items-center, flex-wrap, gap 0.5rem, mb 0.25rem. */
export const StepCardTitleRowFrame = styled(View, {
  name: 'StepCardTitleRow',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '$2',
  marginBottom: '$1',
})

/** `.step-card__passes-data-icon` — w-3 h-3. */
export const StepCardPassesDataIconFrame = styled(View, {
  name: 'StepCardPassesDataIcon',
  width: '$3',
  height: '$3',
})

/**
 * `.step-card__actions` — flex, items-center, opacity-0, gap 0.25rem + a `revealed` variant standing
 * in for the `.group:hover .step-card__actions { opacity: 1 }` group-hover rule.
 */
export const StepCardActionsFrame = styled(View, {
  name: 'StepCardActions',
  display: 'flex',
  alignItems: 'center',
  opacity: 0,
  gap: '$1',
  // transition-opacity awaits the animation driver (§5/P4)

  variants: {
    revealed: {
      true: { opacity: 1 },
    },
  } as const,
})

/** `.step-card__action-icon` — w-4 h-4. */
export const StepCardActionIconFrame = styled(View, {
  name: 'StepCardActionIcon',
  width: '$4',
  height: '$4',
})

/** `.step-card__expanded-content` — mt-4, pt-4, top border. */
export const StepCardExpandedContentFrame = styled(View, {
  name: 'StepCardExpandedContent',
  marginTop: '$4',
  paddingTop: '$4',
  borderTopWidth: 1,
  borderTopColor: '$border',
})

/** `.step-card__order-badge` — absolute 24px brand-3 pill, white bold text, opaque shadow. */
export const StepCardOrderBadgeFrame = styled(View, {
  name: 'StepCardOrderBadge',
  position: 'absolute',
  width: '$6',
  height: '$6',
  borderRadius: '$radius-full',
  color: '#fff', // ds-lint-ok: literal text-white (theme-independent), not a dark-flipping token
  fontSize: '$xs',
  fontWeight: '$bold',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  top: '-0.75rem',
  left: '-0.75rem',
  backgroundColor: '$brand-3',
  // shadow-lg (opaque-black-with-alpha)
  shadowColor: 'rgba(0,0,0,0.1)',
  shadowOffset: { width: 0, height: 10 },
  shadowRadius: 15,
})

/** `.step-card__connector-bottom` — absolute 1px rail below the card (brand-3 → transparent gradient). */
export const StepCardConnectorBottomFrame = styled(View, {
  name: 'StepCardConnectorBottom',
  position: 'absolute',
  width: 1,
  bottom: '-1rem',
  left: '$6',
  height: '$4',
  backgroundImage: 'linear-gradient(to bottom, var(--brand-3), var(--brand-3), transparent)',
})

/* ── StepConfigPreview (`.step-preview`) ────────────────────────────── */

/** `.step-preview` — flex column, gap 1rem. */
export const StepPreviewFrame = styled(View, {
  name: 'StepPreview',
  display: 'flex',
  flexDirection: 'column',
  gap: '$4',
})

/** `.step-preview__section` — flex column, gap 0.5rem. */
export const StepPreviewSectionFrame = styled(View, {
  name: 'StepPreviewSection',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2',
})

/** `.step-preview__field-header` — flex, items-center, gap 0.5rem. */
export const StepPreviewFieldHeaderFrame = styled(View, {
  name: 'StepPreviewFieldHeader',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.step-preview__field-icon` — inline w-4 h-4 brand-3 icon, mr 0.25rem. */
export const StepPreviewFieldIconFrame = styled(View, {
  name: 'StepPreviewFieldIcon',
  width: '$4',
  height: '$4',
  display: 'inline',
  color: '$brand-3',
  marginRight: '$1',
})

/** `.step-preview__field-value` — muted surface, radius 0.5rem, padding 0.5rem. */
export const StepPreviewFieldValueFrame = styled(View, {
  name: 'StepPreviewFieldValue',
  backgroundColor: '$muted',
  borderRadius: '0.5rem',
  padding: '$2',
})

/** `.step-preview__tag-list` — flex, flex-wrap, gap 0.5rem. */
export const StepPreviewTagListFrame = styled(View, {
  name: 'StepPreviewTagList',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '$2',
})

/** `.step-preview__instructions` — scrollable muted block, max-height 8rem. */
export const StepPreviewInstructionsFrame = styled(View, {
  name: 'StepPreviewInstructions',
  backgroundColor: '$muted',
  borderRadius: '0.5rem',
  padding: '$3',
  maxHeight: '8rem',
  overflowY: 'auto',
})

/** `.step-preview__model-info` — flex, items-center, gap 1rem. */
export const StepPreviewModelInfoFrame = styled(View, {
  name: 'StepPreviewModelInfo',
  display: 'flex',
  alignItems: 'center',
  gap: '$4',
})

/** `.step-preview__model-icon` — inline w-4 h-4 icon, mr 0.25rem. */
export const StepPreviewModelIconFrame = styled(View, {
  name: 'StepPreviewModelIcon',
  width: '$4',
  height: '$4',
  display: 'inline',
  marginRight: '$1',
})

/** `.step-preview__schema-brace` — brand-3 text. */
export const StepPreviewSchemaBraceFrame = styled(Text, {
  name: 'StepPreviewSchemaBrace',
  color: '$brand-3',
})

/** `.step-preview__schema-row` — ml 1rem, foreground text. */
export const StepPreviewSchemaRowFrame = styled(Text, {
  name: 'StepPreviewSchemaRow',
  marginLeft: '$4',
  color: '$foreground',
})

/** `.step-preview__schema-key` — brand-1 text. */
export const StepPreviewSchemaKeyFrame = styled(Text, {
  name: 'StepPreviewSchemaKey',
  color: '$brand-1',
})

/** `.step-preview__schema-required` — brand-2 text. */
export const StepPreviewSchemaRequiredFrame = styled(Text, {
  name: 'StepPreviewSchemaRequired',
  color: '$brand-2',
})

/** `.step-preview__schema-separator` — muted-foreground text. */
export const StepPreviewSchemaSeparatorFrame = styled(Text, {
  name: 'StepPreviewSchemaSeparator',
  color: '$muted-foreground',
})

/** `.step-preview__schema-type` — brand-2 text. */
export const StepPreviewSchemaTypeFrame = styled(Text, {
  name: 'StepPreviewSchemaType',
  color: '$brand-2',
})

/** `.step-preview__schema-enum` — muted-foreground text, ml 0.5rem. */
export const StepPreviewSchemaEnumFrame = styled(Text, {
  name: 'StepPreviewSchemaEnum',
  color: '$muted-foreground',
  marginLeft: '$2',
})

export interface StyledStepCardProps extends React.ComponentProps<'div'> {
  expanded?: boolean
}

const Card = StepCardFrame as unknown as React.ComponentType<any>

/** Idiomatic StepCard — mirrors the shipped className card (`expanded`). */
export function StyledStepCard({ expanded, ...props }: StyledStepCardProps) {
  return <Card expanded={expanded} {...props} />
}
