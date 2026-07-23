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
      className={cn('workflow-card', isSelected && 'workflow-card--selected')}
    >
      <Prim.Box className="workflow-card__body">
        {/* Header row */}
        <Prim.Box className="workflow-card__header">
          <Prim.Box className="workflow-card__header-content">
            <Prim.Box className="workflow-card__title-row">
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
        <Prim.Box className="workflow-card__footer">
          <Caption muted>{tasklist.path}</Caption>
        </Prim.Box>
      </Prim.Box>

      {/* Selection indicator */}
      {isSelected && (
        <Prim.Box className="workflow-card__check">
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
      className={cn('workflow-list-item', isSelected && 'workflow-list-item--selected')}
    >
      {/* Workflow info */}
      <Prim.Box className="workflow-list-item__content">
        <Prim.Box className="workflow-list-item__title-row">
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
