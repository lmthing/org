/**
 * TaskForm — the editor card for a single task within the tasklist:
 * id/instruction/input/output/dependsOn/goal/optional/condition.
 */
import { Input } from '@lmthing/ui/elements/forms/input'
import { Textarea } from '@lmthing/ui/elements/forms/textarea'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { cn } from '@lmthing/ui/lib/utils'
import { SchemaEditor } from './schema-editor'
import type { TaskDraft } from './types'

export interface TaskFormProps {
  draft: TaskDraft
  allTaskIds: string[]
  onChange: (draft: TaskDraft) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean
  isLast: boolean
  index: number
  onSetGoal: () => void
}

export function TaskForm({
  draft,
  allTaskIds,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  index,
  onSetGoal,
}: TaskFormProps) {
  const otherTaskIds = allTaskIds.filter((id) => id !== draft.id)

  const toggleDepends = (taskId: string) => {
    const next = draft.dependsOn.includes(taskId)
      ? draft.dependsOn.filter((d) => d !== taskId)
      : [...draft.dependsOn, taskId]
    onChange({ ...draft, dependsOn: next })
  }

  return (
    <div className={cn('tasklist-editor__task-form', draft.goal && 'tasklist-editor__task-form--goal')}>
      {/* Order + controls header */}
      <div className="tasklist-editor__task-header">
        <span className="tasklist-editor__task-order">{index + 1}</span>
        {draft.goal && (
          <span className="tasklist-editor__goal-badge">goal</span>
        )}
        <div className="tasklist-editor__task-controls">
          <Button variant="ghost" size="icon" onClick={onMoveUp} disabled={isFirst} title="Move up">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </Button>
          <Button variant="ghost" size="icon" onClick={onMoveDown} disabled={isLast} title="Move down">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} title="Delete task">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </Button>
        </div>
      </div>

      <div className="tasklist-editor__task-body">
        {/* id */}
        <div>
          <Label compact required>ID</Label>
          <Input
            type="text"
            value={draft.id}
            onChange={(e) => onChange({ ...draft, id: e.target.value })}
            placeholder="task_id (snake_case)"
          />
          <Caption muted>Used as the filename suffix (NN-id.md) and in dependsOn references.</Caption>
        </div>

        {/* instruction */}
        <div>
          <Label compact required>Instruction</Label>
          <Textarea
            value={draft.instruction}
            onChange={(e) => onChange({ ...draft, instruction: e.target.value })}
            placeholder="Describe what this task should accomplish..."
            compact
          />
        </div>

        {/* input */}
        <div>
          <Label compact>Input fields</Label>
          <SchemaEditor
            rows={draft.input}
            onChange={(rows) => onChange({ ...draft, input: rows })}
            addLabel="+ Add input field"
            emptyHint="No input fields. Add fields if this task requires specific inputs."
          />
          <Caption muted>Declare the fields this task expects as input (field name → type).</Caption>
        </div>

        {/* output */}
        <div>
          <Label compact>Output fields</Label>
          <SchemaEditor
            rows={draft.output}
            onChange={(rows) => onChange({ ...draft, output: rows })}
            addLabel="+ Add output field"
          />
          <Caption muted>Declare the fields this task produces (field name → type).</Caption>
        </div>

        {/* dependsOn */}
        {otherTaskIds.length > 0 && (
          <div>
            <Label compact>Depends on</Label>
            <div className="tasklist-editor__depends-grid">
              {otherTaskIds.map((taskId) => (
                <button
                  key={taskId}
                  onClick={() => toggleDepends(taskId)}
                  className={cn(
                    'tasklist-editor__depends-btn',
                    draft.dependsOn.includes(taskId)
                      ? 'tasklist-editor__depends-btn--active'
                      : 'tasklist-editor__depends-btn--inactive'
                  )}
                >
                  {taskId}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* goal / optional / condition row */}
        <div className="tasklist-editor__flags-row">
          {/* goal radio */}
          <div className="tasklist-editor__flag-item">
            <button
              onClick={onSetGoal}
              className={cn(
                'tasklist-editor__toggle',
                draft.goal ? 'tasklist-editor__toggle--on' : 'tasklist-editor__toggle--off'
              )}
              title="Mark as goal task (exactly one per tasklist)"
            >
              <span className={cn(
                'tasklist-editor__toggle-knob',
                draft.goal ? 'tasklist-editor__toggle-knob--on' : 'tasklist-editor__toggle-knob--off'
              )} />
            </button>
            <Label compact>Goal</Label>
          </div>

          {/* optional toggle */}
          <div className="tasklist-editor__flag-item">
            <button
              onClick={() => onChange({ ...draft, optional: !draft.optional })}
              className={cn(
                'tasklist-editor__toggle',
                draft.optional ? 'tasklist-editor__toggle--on' : 'tasklist-editor__toggle--off'
              )}
            >
              <span className={cn(
                'tasklist-editor__toggle-knob',
                draft.optional ? 'tasklist-editor__toggle-knob--on' : 'tasklist-editor__toggle-knob--off'
              )} />
            </button>
            <Label compact>Optional</Label>
          </div>

          {/* condition */}
          <div className="tasklist-editor__flag-condition">
            <Label compact>Condition</Label>
            <Input
              type="text"
              value={draft.condition}
              onChange={(e) => onChange({ ...draft, condition: e.target.value })}
              placeholder="e.g. outputs.previous.success === true"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
