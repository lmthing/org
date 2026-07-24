/** workflow-card.styled.tsx — P2 conversion of the `.workflow-card` and `.workflow-list-item` BEM
 *  blocks (docs §4). One styled() per BEM selector; modifiers → variants. Lands alongside the shipped
 *  className components.
 *
 *  `transition-all duration-200`/`duration-150`/`transition-transform` await the animation driver (§5/P4). */
import * as React from 'react'
import { styled, View } from '../../theme/tamagui-web.config'

/**
 * `.workflow-card` — relative, rounded-xl, border-2, bg-card, border-border + `.workflow-card:hover`
 * (brand-3/50 border + shadow-md) and the `selected` variant (brand-3 border, ring-2 brand-3/20,
 * shadow-lg tinted brand-3/10).
 */
export const WorkflowCardFrame = styled(View, {
  name: 'WorkflowCard',
  position: 'relative',
  borderRadius: '$radius-xl',
  borderWidth: 2,
  cursor: 'pointer',
  backgroundColor: '$card',
  borderColor: '$border',
  // transition-all duration-200 awaits the animation driver (§5/P4)
  hoverStyle: {
    borderColor: 'color-mix(in srgb, var(--brand-3) 50%, transparent)',
    // shadow-md
    shadowColor: 'rgba(0,0,0,0.1)',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
  },

  variants: {
    selected: {
      true: {
        borderColor: '$brand-3',
        // ring-2 with --tw-ring-color brand-3/20
        outlineWidth: 2,
        outlineStyle: 'solid',
        outlineColor: 'color-mix(in srgb, var(--brand-3) 20%, transparent)',
        // shadow-lg tinted by --tw-shadow-color brand-3/10
        shadowColor: 'color-mix(in srgb, var(--brand-3) 10%, transparent)',
        shadowOffset: { width: 0, height: 10 },
        shadowRadius: 15,
      },
    },
  } as const,
})

/** `.workflow-card__body` — p-5. */
export const WorkflowCardBodyFrame = styled(View, {
  name: 'WorkflowCardBody',
  padding: '$5',
})

/** `.workflow-card__header` — flex, items-start, justify-between, gap-4, mb-3. */
export const WorkflowCardHeaderFrame = styled(View, {
  name: 'WorkflowCardHeader',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '$4',
  marginBottom: '$3',
})

/** `.workflow-card__header-content` — flex-1, min-w-0. */
export const WorkflowCardHeaderContentFrame = styled(View, {
  name: 'WorkflowCardHeaderContent',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
})

/** `.workflow-card__title-row` — flex, items-center, gap-2, mb-1. */
export const WorkflowCardTitleRowFrame = styled(View, {
  name: 'WorkflowCardTitleRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  marginBottom: '$1',
})

/** `.workflow-card__tags` — flex, flex-wrap, gap-1.5, mb-4. */
export const WorkflowCardTagsFrame = styled(View, {
  name: 'WorkflowCardTags',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '$1.5',
  marginBottom: '$4',
})

/** `.workflow-card__footer` — flex, items-center, justify-between, pt-3, top border. */
export const WorkflowCardFooterFrame = styled(View, {
  name: 'WorkflowCardFooter',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingTop: '$3',
  borderTopWidth: 1,
  borderTopColor: '$border',
})

/** `.workflow-card__footer-stats` — flex, items-center, gap-4. */
export const WorkflowCardFooterStatsFrame = styled(View, {
  name: 'WorkflowCardFooterStats',
  display: 'flex',
  alignItems: 'center',
  gap: '$4',
})

/** `.workflow-card__stat` — flex, items-center, gap-1.5. */
export const WorkflowCardStatFrame = styled(View, {
  name: 'WorkflowCardStat',
  display: 'flex',
  alignItems: 'center',
  gap: '$1.5',
})

/** `.workflow-card__icon` — w-4, h-4. */
export const WorkflowCardIconFrame = styled(View, {
  name: 'WorkflowCardIcon',
  width: '$4',
  height: '$4',
})

/** `.workflow-card__dot` — w-2, h-2, rounded-full, bg-brand-2. */
export const WorkflowCardDotFrame = styled(View, {
  name: 'WorkflowCardDot',
  width: '$2',
  height: '$2',
  borderRadius: '$radius-full',
  backgroundColor: '$brand-2',
})

/** `.workflow-card__check` — absolute top-4/right-4, w-5 h-5, rounded-full, centered, bg-brand-3. */
export const WorkflowCardCheckFrame = styled(View, {
  name: 'WorkflowCardCheck',
  position: 'absolute',
  top: '$4',
  right: '$4',
  width: '$5',
  height: '$5',
  borderRadius: '$radius-full',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '$brand-3',
})

/** `.workflow-card__check-icon` — w-3, h-3, text-white. */
export const WorkflowCardCheckIconFrame = styled(View, {
  name: 'WorkflowCardCheckIcon',
  width: '$3',
  height: '$3',
  color: '#fff', // ds-lint-ok: literal text-white (theme-independent), not a dark-flipping token
})

/**
 * `.workflow-list-item` — flex, items-center, gap-4, p-4, rounded-lg, border, bg-card, border-border +
 * `:hover` (brand-3/50 border, muted bg) and the `selected` variant (brand-3/10 bg, brand-3 border).
 */
export const WorkflowListItemFrame = styled(View, {
  name: 'WorkflowListItem',
  display: 'flex',
  alignItems: 'center',
  gap: '$4',
  padding: '$4',
  borderRadius: '$radius-lg',
  borderWidth: 1,
  cursor: 'pointer',
  backgroundColor: '$card',
  borderColor: '$border',
  // transition-all duration-150 awaits the animation driver (§5/P4)
  hoverStyle: {
    borderColor: 'color-mix(in srgb, var(--brand-3) 50%, transparent)',
    backgroundColor: '$muted',
  },

  variants: {
    selected: {
      true: {
        backgroundColor: 'color-mix(in srgb, var(--brand-3) 10%, transparent)',
        borderColor: '$brand-3',
      },
    },
  } as const,
})

/** `.workflow-list-item__status-dot` — flex-shrink-0, w-2 h-2, rounded-full + status color variant. */
export const WorkflowListItemStatusDotFrame = styled(View, {
  name: 'WorkflowListItemStatusDot',
  flexShrink: 0,
  width: '$2',
  height: '$2',
  borderRadius: '$radius-full',

  variants: {
    status: {
      active: { backgroundColor: '$brand-2' },
      draft: { backgroundColor: '$brand-2' },
      // --archived: currentColor fill tinted by muted-foreground
      archived: { color: '$muted-foreground', backgroundColor: 'currentColor' },
    },
  } as const,
})

/** `.workflow-list-item__content` — flex-1, min-w-0. */
export const WorkflowListItemContentFrame = styled(View, {
  name: 'WorkflowListItemContent',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  minWidth: 0,
})

/** `.workflow-list-item__title-row` — flex, items-center, gap-2. */
export const WorkflowListItemTitleRowFrame = styled(View, {
  name: 'WorkflowListItemTitleRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.workflow-list-item__tags` — flex, flex-wrap, gap-1 + `responsive` (hidden until sm/$gtXs). */
export const WorkflowListItemTagsFrame = styled(View, {
  name: 'WorkflowListItemTags',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '$1',

  variants: {
    responsive: {
      // .workflow-list-item__tags--responsive → hidden! sm:flex!
      true: { display: 'none', $gtXs: { display: 'flex' } },
    },
  } as const,
})

/** `.workflow-list-item__chevron` — w-5 h-5, muted-foreground + `open` variant (rotate-90). */
export const WorkflowListItemChevronFrame = styled(View, {
  name: 'WorkflowListItemChevron',
  width: '$5',
  height: '$5',
  color: '$muted-foreground',
  // transition-transform awaits the animation driver (§5/P4)

  variants: {
    open: {
      true: { transform: 'rotate(90deg)' },
    },
  } as const,
})

export interface StyledWorkflowCardProps extends React.ComponentProps<'div'> {
  selected?: boolean
}
export interface StyledWorkflowListItemProps extends React.ComponentProps<'div'> {
  selected?: boolean
}

const Card = WorkflowCardFrame as unknown as React.ComponentType<any>
const ListItem = WorkflowListItemFrame as unknown as React.ComponentType<any>

/** Idiomatic WorkflowCard — mirrors the shipped className card (`selected`). */
export function StyledWorkflowCard({ selected, ...props }: StyledWorkflowCardProps) {
  return <Card selected={selected} {...props} />
}
/** Idiomatic WorkflowListItem — mirrors the shipped className list item (`selected`). */
export function StyledWorkflowListItem({ selected, ...props }: StyledWorkflowListItemProps) {
  return <ListItem selected={selected} {...props} />
}
