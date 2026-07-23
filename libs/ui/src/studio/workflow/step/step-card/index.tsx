/**
 * TaskCard — compact display card for a single tasklist task.
 * Used in read-only previews; actual editing is done inline in TasklistEditor.
 */
import * as Prim from '../../../../elements/primitives/index.js';
import type { TasklistTask } from '@lmthing/state'
import { Badge } from '@lmthing/ui/elements/content/badge'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import '@lmthing/css/components/workflow/step-card/index.css'

interface TaskCardProps {
  task: TasklistTask
  isExpanded: boolean
  isDraggable?: boolean
  onClick?: () => void
  onEdit?: () => void
  onDelete?: () => void
}

export function TaskCard({ task, isExpanded, isDraggable = false, onClick, onEdit, onDelete }: TaskCardProps) {
  const outputFields = Object.entries(task.output)

  return (
    <Prim.Box className={`step-card ${isExpanded ? 'step-card--expanded' : ''}`}>
      <Prim.Box className="step-card__connector-top" />

      <Prim.Box onClick={onClick} className="step-card__body">
        <Prim.Box className="step-card__inner">
          <Prim.Box className="step-card__content">
            {/* Drag handle */}
            {isDraggable && (
              <Prim.Box className="step-card__drag-handle">
                <Prim.Svg className="step-card__drag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <Prim.Circle cx="9" cy="6" r="1.5" />
                  <Prim.Circle cx="15" cy="6" r="1.5" />
                  <Prim.Circle cx="9" cy="12" r="1.5" />
                  <Prim.Circle cx="15" cy="12" r="1.5" />
                  <Prim.Circle cx="9" cy="18" r="1.5" />
                  <Prim.Circle cx="15" cy="18" r="1.5" />
                </Prim.Svg>
              </Prim.Box>
            )}

            {/* Task info */}
            <Prim.Box className="step-card__info">
              <Prim.Box className="step-card__title-row">
                <Label>{task.id}</Label>
                {task.goal && <Badge variant="success">goal</Badge>}
                {task.optional && <Badge variant="muted">optional</Badge>}
              </Prim.Box>
              <Caption muted>
                {task.instruction.slice(0, 120)}
                {task.instruction.length > 120 ? '…' : ''}
              </Caption>
            </Prim.Box>

            {/* Action buttons */}
            <Prim.Box className="step-card__actions">
              {onEdit && (
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onEdit() }}>
                  <Prim.Svg className="step-card__action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <Prim.Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <Prim.Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </Prim.Svg>
                </Button>
              )}
              {onDelete && (
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onDelete() }}>
                  <Prim.Svg className="step-card__action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <Prim.Path d="M3 6h18" />
                    <Prim.Path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <Prim.Path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </Prim.Svg>
                </Button>
              )}
            </Prim.Box>
          </Prim.Box>

          {/* Expanded: output fields + dependsOn */}
          {isExpanded && (
            <Prim.Box className="step-card__expanded-content">
              {outputFields.length > 0 && (
                <Prim.Box>
                  <Caption muted>Output:</Caption>
                  <Prim.Box style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                    {outputFields.map(([k, v]) => (
                      <Badge key={k} variant="muted">{k}: {v}</Badge>
                    ))}
                  </Prim.Box>
                </Prim.Box>
              )}
              {task.dependsOn && task.dependsOn.length > 0 && (
                <Prim.Box>
                  <Caption muted>Depends on:</Caption>
                  <Prim.Box style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                    {task.dependsOn.map((d) => (
                      <Badge key={d} variant="primary">{d}</Badge>
                    ))}
                  </Prim.Box>
                </Prim.Box>
              )}
              {task.condition && (
                <Caption muted>Condition: {task.condition}</Caption>
              )}
            </Prim.Box>
          )}
        </Prim.Box>

        {/* Order badge */}
        <Prim.Box className="step-card__order-badge">{task.order}</Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}

/** @deprecated Use TaskCard */
export { TaskCard as StepCard }
