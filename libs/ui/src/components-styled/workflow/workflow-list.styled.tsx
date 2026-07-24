/** workflow-list.styled.tsx — P2 conversion of the `.workflow-list` BEM block (docs §4).
 *  One styled() per BEM selector; modifiers → variants. Lands alongside the shipped className list.
 *
 *  `transition-all` awaits the animation driver (§5/P4). */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.workflow-list__header-inner` — centered max-w-6xl, py-6, responsive horizontal padding. */
export const WorkflowListHeaderInnerFrame = styled(View, {
  name: 'WorkflowListHeaderInner',
  maxWidth: '72rem', // max-w-6xl, no token → literal
  marginHorizontal: 'auto',
  paddingVertical: '$6',
  paddingLeft: '$4',
  paddingRight: '$4',
  $gtXs: { paddingLeft: '$6', paddingRight: '$6' },
  $gtMd: { paddingLeft: '$8', paddingRight: '$8' },
})

/** `.workflow-list__title-row` — flex, justify-between, items-center, mb 1.5rem. */
export const WorkflowListTitleRowFrame = styled(View, {
  name: 'WorkflowListTitleRow',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '$6',
})

/** `.workflow-list__create-icon` — w-5 h-5. */
export const WorkflowListCreateIconFrame = styled(View, {
  name: 'WorkflowListCreateIcon',
  width: '$5',
  height: '$5',
})

/** `.workflow-list__stats` — flex, items-center, mb 1.5rem. */
export const WorkflowListStatsFrame = styled(View, {
  name: 'WorkflowListStats',
  display: 'flex',
  alignItems: 'center',
  marginBottom: '$6',
})

/** `.workflow-list__stat-row` — flex, items-center. */
export const WorkflowListStatRowFrame = styled(View, {
  name: 'WorkflowListStatRow',
  display: 'flex',
  alignItems: 'center',
})

/** `.workflow-list__stat-count` — text-2xl, font-bold, foreground. */
export const WorkflowListStatCountFrame = styled(Text, {
  name: 'WorkflowListStatCount',
  fontSize: '$2xl',
  fontWeight: '$bold',
  color: '$foreground',
})

/** `.workflow-list__stat-dot` — w-2 h-2, rounded-full, bg-brand-2. */
export const WorkflowListStatDotFrame = styled(View, {
  name: 'WorkflowListStatDot',
  width: '$2',
  height: '$2',
  borderRadius: '$radius-full',
  backgroundColor: '$brand-2',
})

/** `.workflow-list__filters` — flex, flex-wrap. */
export const WorkflowListFiltersFrame = styled(View, {
  name: 'WorkflowListFilters',
  display: 'flex',
  flexWrap: 'wrap',
})

/** `.workflow-list__search-wrapper` — relative, flex-1, max-width 28rem. */
export const WorkflowListSearchWrapperFrame = styled(View, {
  name: 'WorkflowListSearchWrapper',
  position: 'relative',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  maxWidth: '28rem',
})

/** `.workflow-list__search-icon` — absolute, w-5 h-5, vertically centered at left 0.75rem. */
export const WorkflowListSearchIconFrame = styled(View, {
  name: 'WorkflowListSearchIcon',
  position: 'absolute',
  width: '$5',
  height: '$5',
  left: '$3',
  top: '50%',
  transform: 'translateY(-50%)',
  color: '$muted-foreground',
})

/** `.workflow-list__search-input` — padding-left 2.5rem. */
export const WorkflowListSearchInputFrame = styled(View, {
  name: 'WorkflowListSearchInput',
  paddingLeft: '$10',
})

/** `.workflow-list__tag-filters` — horizontally scrollable flex row, pb collapses at sm/$gtXs. */
export const WorkflowListTagFiltersFrame = styled(View, {
  name: 'WorkflowListTagFilters',
  display: 'flex',
  alignItems: 'center',
  overflowX: 'auto',
  gap: '$2',
  paddingBottom: '$1',
  $gtXs: { paddingBottom: 0 },
})

/** `.workflow-list__tag-btn` — pill button + active (brand-3 tint + ring-1) / inactive variants. */
export const WorkflowListTagBtnFrame = styled(View, {
  name: 'WorkflowListTagBtn',
  fontSize: '$sm',
  fontWeight: '$medium',
  whiteSpace: 'nowrap',
  paddingVertical: '$1',
  paddingHorizontal: '$3',
  borderRadius: '0.5rem',
  // transition-all awaits the animation driver (§5/P4)

  variants: {
    state: {
      active: {
        backgroundColor: 'color-mix(in srgb, var(--brand-3) 15%, transparent)',
        color: '$brand-3',
        outlineWidth: 1,
        outlineStyle: 'solid',
        outlineColor: 'color-mix(in srgb, var(--brand-3) 30%, transparent)',
      },
      inactive: {
        backgroundColor: '$muted',
        color: '$muted-foreground',
        hoverStyle: { backgroundColor: '$muted' },
      },
    },
  } as const,
})

/** `.workflow-list__view-toggle` — segmented control shell, muted surface. */
export const WorkflowListViewToggleFrame = styled(View, {
  name: 'WorkflowListViewToggle',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  padding: '$1',
  backgroundColor: '$muted',
  borderRadius: '0.5rem',
})

/** `.workflow-list__view-btn` — icon button + active (card surface + shadow-sm) / inactive variants. */
export const WorkflowListViewBtnFrame = styled(View, {
  name: 'WorkflowListViewBtn',
  padding: '$2',
  borderRadius: '$radius-md',
  // transition-all awaits the animation driver (§5/P4)

  variants: {
    state: {
      active: {
        backgroundColor: '$card',
        color: '$brand-3',
        // shadow-sm (opaque-black-with-alpha)
        shadowColor: 'rgba(0,0,0,0.05)',
        shadowOffset: { width: 0, height: 1 },
        shadowRadius: 2,
      },
      inactive: {
        color: '$muted-foreground',
        hoverStyle: { color: '$foreground' },
      },
    },
  } as const,
})

/** `.workflow-list__view-icon` — w-4 h-4. */
export const WorkflowListViewIconFrame = styled(View, {
  name: 'WorkflowListViewIcon',
  width: '$4',
  height: '$4',
})

/** `.workflow-list__body-inner` — centered max-w-6xl, py-8, responsive horizontal padding. */
export const WorkflowListBodyInnerFrame = styled(View, {
  name: 'WorkflowListBodyInner',
  maxWidth: '72rem',
  marginHorizontal: 'auto',
  paddingVertical: '$8',
  paddingLeft: '$4',
  paddingRight: '$4',
  $gtXs: { paddingLeft: '$6', paddingRight: '$6' },
  $gtMd: { paddingLeft: '$8', paddingRight: '$8' },
})

/** `.workflow-list__grid` — 1-col → 2-col at md/$gtSm → 3-col at lg/$gtMd, gap-4. */
export const WorkflowListGridFrame = styled(View, {
  name: 'WorkflowListGrid',
  display: 'grid',
  gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
  gap: '$4',
  $gtSm: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  $gtMd: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
})

/** `.workflow-list__list` — flex column, gap 0.5rem. */
export const WorkflowListListFrame = styled(View, {
  name: 'WorkflowListList',
  display: 'flex',
  flexDirection: 'column',
  gap: '$2',
})

/** `.workflow-list__empty-first` — centered dashed card, padding 4rem. */
export const WorkflowListEmptyFirstFrame = styled(View, {
  name: 'WorkflowListEmptyFirst',
  textAlign: 'center',
  backgroundColor: '$card',
  borderRadius: '1rem',
  borderWidth: 2,
  borderStyle: 'dashed',
  borderColor: '$border',
  padding: '$16',
})

/**
 * `.workflow-list__empty-first-icon-wrapper` — 80px centered tile. Source single-hue
 * `linear-gradient(brand-3 → brand-3)` simplified to a solid brand-3 fill; tinted brand-3/25 shadow.
 */
export const WorkflowListEmptyFirstIconWrapperFrame = styled(View, {
  name: 'WorkflowListEmptyFirstIconWrapper',
  width: '$20',
  height: '$20',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginHorizontal: 'auto',
  borderRadius: '1rem',
  backgroundColor: '$brand-3',
  marginBottom: '$6',
  shadowColor: 'color-mix(in srgb, var(--brand-3) 25%, transparent)',
  shadowOffset: { width: 0, height: 20 },
  shadowRadius: 25,
})

/** `.workflow-list__empty-first-icon` — w-10 h-10, text-white. */
export const WorkflowListEmptyFirstIconFrame = styled(View, {
  name: 'WorkflowListEmptyFirstIcon',
  width: '$10',
  height: '$10',
  color: '#fff', // ds-lint-ok: literal text-white (theme-independent), not a dark-flipping token
})

/** `.workflow-list__empty-first-caption` — centered max-w-md, mb 2rem. */
export const WorkflowListEmptyFirstCaptionFrame = styled(View, {
  name: 'WorkflowListEmptyFirstCaption',
  marginBottom: '$8',
  maxWidth: '28rem',
  marginHorizontal: 'auto',
})

/** `.workflow-list__empty-first-tags` — flex, flex-wrap, justify-center, mb 2rem. */
export const WorkflowListEmptyFirstTagsFrame = styled(View, {
  name: 'WorkflowListEmptyFirstTags',
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: '$2',
  marginBottom: '$8',
})

/** `.workflow-list__empty-no-match` — centered card, padding 3rem. */
export const WorkflowListEmptyNoMatchFrame = styled(View, {
  name: 'WorkflowListEmptyNoMatch',
  textAlign: 'center',
  backgroundColor: '$card',
  borderRadius: '0.75rem',
  padding: '$12',
})

/** `.workflow-list__empty-no-match-icon-wrapper` — 64px centered muted circle, mb 1rem. */
export const WorkflowListEmptyNoMatchIconWrapperFrame = styled(View, {
  name: 'WorkflowListEmptyNoMatchIconWrapper',
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

/** `.workflow-list__empty-no-match-icon` — w-8 h-8, muted-foreground. */
export const WorkflowListEmptyNoMatchIconFrame = styled(View, {
  name: 'WorkflowListEmptyNoMatchIcon',
  width: '$8',
  height: '$8',
  color: '$muted-foreground',
})

export interface StyledWorkflowListProps extends React.ComponentProps<'div'> {}

const Frame = WorkflowListHeaderInnerFrame as unknown as React.ComponentType<any>
export function StyledWorkflowList({ ...props }: StyledWorkflowListProps) {
  return <Frame {...props} />
}
