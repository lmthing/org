/**
 * TasklistCard / TasklistListItem — card components for the tasklist list view.
 */
import * as Prim from '../../../elements/primitives/index.js';
import type { TasklistListItem } from '@lmthing/state'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { cn } from '../../../lib/utils'

import '@lmthing/css/components/workflow/workflow-card/index.css'

// ─── Card (grid view) ─────────────────────────────────────────────────────────

interface TasklistCardProps {
  tasklist: TasklistListItem
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
}

export function TasklistCard({ tasklist, isSelected, onSelect, onDelete }: TasklistCardProps) {
  return (
    <Prim.Box
      onClick={onSelect}
      position="relative"
      borderRadius="$radius-xl"
      borderWidth={2}
      cursor="pointer"
      backgroundColor="$card"
      borderColor="$border"
      // transition-all duration-200 awaits the animation driver (§5/P4)
      hoverStyle={{
        borderColor: 'color-mix(in srgb, var(--brand-3) 50%, transparent)',
        shadowColor: 'rgba(0,0,0,0.1)',
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 6,
      }}
      {...(isSelected
        ? {
            borderColor: '$brand-3',
            outlineWidth: 2,
            outlineStyle: 'solid',
            outlineColor: 'color-mix(in srgb, var(--brand-3) 20%, transparent)',
            shadowColor: 'color-mix(in srgb, var(--brand-3) 10%, transparent)',
            shadowOffset: { width: 0, height: 10 },
            shadowRadius: 15,
          }
        : {})}
    >
      <Prim.Box padding="$5">
        {/* Header row */}
        <Prim.Box display="flex" alignItems="flex-start" justifyContent="space-between" gap="$4" marginBottom="$3">
          <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0}>
            <Prim.Box display="flex" alignItems="center" gap="$2" marginBottom="$1">
              <Label>{tasklist.name}</Label>
            </Prim.Box>
          </Prim.Box>

          {/* Delete button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
          >
            <Prim.Svg className="workflow-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <Prim.Path d="M3 6h18" />
              <Prim.Path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <Prim.Path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </Prim.Svg>
          </Button>
        </Prim.Box>

        {/* Footer */}
        <Prim.Box display="flex" alignItems="center" justifyContent="space-between" paddingTop="$3" borderTopWidth={1} borderTopColor="$border">
          <Caption muted>{tasklist.path}</Caption>
        </Prim.Box>
      </Prim.Box>

      {/* Selection indicator */}
      {isSelected && (
        <Prim.Box
          position="absolute"
          top="$4"
          right="$4"
          width="$5"
          height="$5"
          borderRadius="$radius-full"
          display="flex"
          alignItems="center"
          justifyContent="center"
          backgroundColor="$brand-3"
        >
          <Prim.Svg className="workflow-card__check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <Prim.Path d="M5 13l4 4L19 7" />
          </Prim.Svg>
        </Prim.Box>
      )}
    </Prim.Box>
  )
}

// ─── List item (compact row view) ─────────────────────────────────────────────

interface TasklistListItemProps {
  tasklist: TasklistListItem
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
}

export function TasklistListItem({ tasklist, isSelected, onSelect, onDelete }: TasklistListItemProps) {
  return (
    <Prim.Box
      onClick={onSelect}
      display="flex"
      alignItems="center"
      gap="$4"
      padding="$4"
      borderRadius="$radius-lg"
      borderWidth={1}
      cursor="pointer"
      backgroundColor="$card"
      borderColor="$border"
      // transition-all duration-150 awaits the animation driver (§5/P4)
      hoverStyle={{
        borderColor: 'color-mix(in srgb, var(--brand-3) 50%, transparent)',
        backgroundColor: '$muted',
      }}
      {...(isSelected
        ? {
            backgroundColor: 'color-mix(in srgb, var(--brand-3) 10%, transparent)',
            borderColor: '$brand-3',
          }
        : {})}
    >
      {/* Workflow info */}
      <Prim.Box flexGrow={1} flexShrink={1} flexBasis="0%" minWidth={0}>
        <Prim.Box display="flex" alignItems="center" gap="$2">
          <Label>{tasklist.name}</Label>
        </Prim.Box>
        <Caption muted>{tasklist.path}</Caption>
      </Prim.Box>

      {/* Delete button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
      >
        <Prim.Svg className="workflow-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <Prim.Path d="M3 6h18" />
          <Prim.Path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <Prim.Path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        </Prim.Svg>
      </Button>

      {/* Chevron */}
      <Prim.Svg
        className={cn('workflow-list-item__chevron', isSelected && 'workflow-list-item__chevron--open')}
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      >
        <Prim.Path d="M9 18l6-6-6-6" />
      </Prim.Svg>
    </Prim.Box>
  )
}

// ─── Backward-compat aliases (old names) ──────────────────────────────────────
/** @deprecated Use TasklistCard */
const WorkflowCard = TasklistCard
export { WorkflowCard }
/** @deprecated Use TasklistListItem */
const WorkflowListItem = TasklistListItem
export { WorkflowListItem }
