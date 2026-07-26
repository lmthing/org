/**
 * TaskForm — the editor card for a single task within the tasklist:
 * id/instruction/input/output/dependsOn/goal/optional/condition.
 */
import * as Prim from '../../../elements/primitives/index';
import { Input } from '../../../elements/forms/input'
import { Textarea } from '../../../elements/forms/textarea'
import { Button } from '../../../elements/forms/button'
import { Label } from '../../../elements/typography/label'
import { Caption } from '../../../elements/typography/caption'
import { SchemaEditor } from './schema-editor'
import type { TaskDraft } from './types'
import { TASKLIST_EDITOR_DEPENDS_BTN, TASKLIST_EDITOR_DEPENDS_BTN_ACTIVE, TASKLIST_EDITOR_DEPENDS_BTN_INACTIVE, TASKLIST_EDITOR_DEPENDS_GRID, TASKLIST_EDITOR_FLAGS_ROW, TASKLIST_EDITOR_FLAG_CONDITION, TASKLIST_EDITOR_FLAG_ITEM, TASKLIST_EDITOR_GOAL_BADGE, TASKLIST_EDITOR_TASK_BODY, TASKLIST_EDITOR_TASK_CONTROLS, TASKLIST_EDITOR_TASK_FORM, TASKLIST_EDITOR_TASK_FORM_GOAL, TASKLIST_EDITOR_TASK_HEADER, TASKLIST_EDITOR_TASK_ORDER, TASKLIST_EDITOR_TOGGLE, TASKLIST_EDITOR_TOGGLE_KNOB, TASKLIST_EDITOR_TOGGLE_KNOB_OFF, TASKLIST_EDITOR_TOGGLE_KNOB_ON, TASKLIST_EDITOR_TOGGLE_OFF, TASKLIST_EDITOR_TOGGLE_ON } from './tasklist-editor.props'

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
    <Prim.Box
      transition="quick"
      {...TASKLIST_EDITOR_TASK_FORM}
      {...(draft.goal ? TASKLIST_EDITOR_TASK_FORM_GOAL : null)}
    >
      {/* Order + controls header */}
      <Prim.Box {...TASKLIST_EDITOR_TASK_HEADER}>
        <Prim.Text {...TASKLIST_EDITOR_TASK_ORDER}>{index + 1}</Prim.Text>
        {draft.goal && (
          <Prim.Text {...TASKLIST_EDITOR_GOAL_BADGE}>goal</Prim.Text>
        )}
        <Prim.Box {...TASKLIST_EDITOR_TASK_CONTROLS}>
          <Button variant="ghost" size="icon" onClick={onMoveUp} disabled={isFirst} title="Move up">
            <Prim.Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <Prim.Path d="M12 19V5M5 12l7-7 7 7" />
            </Prim.Svg>
          </Button>
          <Button variant="ghost" size="icon" onClick={onMoveDown} disabled={isLast} title="Move down">
            <Prim.Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <Prim.Path d="M12 5v14M5 12l7 7 7-7" />
            </Prim.Svg>
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} title="Delete task">
            <Prim.Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <Prim.Path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </Prim.Svg>
          </Button>
        </Prim.Box>
      </Prim.Box>

      <Prim.Box {...TASKLIST_EDITOR_TASK_BODY}>
        {/* id */}
        <Prim.Box>
          <Label compact required>ID</Label>
          <Input
            type="text"
            value={draft.id}
            onChange={(e) => onChange({ ...draft, id: e.target.value })}
            placeholder="task_id (snake_case)"
          />
          <Caption muted>Used as the filename suffix (NN-id.md) and in dependsOn references.</Caption>
        </Prim.Box>

        {/* instruction */}
        <Prim.Box>
          <Label compact required>Instruction</Label>
          <Textarea
            value={draft.instruction}
            onChange={(e) => onChange({ ...draft, instruction: e.target.value })}
            placeholder="Describe what this task should accomplish..."
            compact
          />
        </Prim.Box>

        {/* input */}
        <Prim.Box>
          <Label compact>Input fields</Label>
          <SchemaEditor
            rows={draft.input}
            onChange={(rows) => onChange({ ...draft, input: rows })}
            addLabel="+ Add input field"
            emptyHint="No input fields. Add fields if this task requires specific inputs."
          />
          <Caption muted>Declare the fields this task expects as input (field name → type).</Caption>
        </Prim.Box>

        {/* output */}
        <Prim.Box>
          <Label compact>Output fields</Label>
          <SchemaEditor
            rows={draft.output}
            onChange={(rows) => onChange({ ...draft, output: rows })}
            addLabel="+ Add output field"
          />
          <Caption muted>Declare the fields this task produces (field name → type).</Caption>
        </Prim.Box>

        {/* dependsOn */}
        {otherTaskIds.length > 0 && (
          <Prim.Box>
            <Label compact>Depends on</Label>
            <Prim.Box {...TASKLIST_EDITOR_DEPENDS_GRID}>
              {otherTaskIds.map((taskId) => (
                <Prim.Pressable
                  key={taskId}
                  onClick={() => toggleDepends(taskId)}
                  transition="quick" animateOnly={["color", "background-color", "border-color"]}
                  {...TASKLIST_EDITOR_DEPENDS_BTN}
                  {...(draft.dependsOn.includes(taskId)
                    ? TASKLIST_EDITOR_DEPENDS_BTN_ACTIVE
                    : TASKLIST_EDITOR_DEPENDS_BTN_INACTIVE)}
                >
                  {taskId}
                </Prim.Pressable>
              ))}
            </Prim.Box>
          </Prim.Box>
        )}

        {/* goal / optional / condition row */}
        <Prim.Box {...TASKLIST_EDITOR_FLAGS_ROW}>
          {/* goal radio */}
          <Prim.Box {...TASKLIST_EDITOR_FLAG_ITEM}>
            <Prim.Pressable
              onClick={onSetGoal}
              transition="quick" animateOnly={["color", "background-color", "border-color"]}
              {...TASKLIST_EDITOR_TOGGLE}
              {...(draft.goal ? TASKLIST_EDITOR_TOGGLE_ON : TASKLIST_EDITOR_TOGGLE_OFF)}
              title="Mark as goal task (exactly one per tasklist)"
            >
              <Prim.Text
                transition="quick" animateOnly={["transform"]}
                {...TASKLIST_EDITOR_TOGGLE_KNOB}
                {...(draft.goal ? TASKLIST_EDITOR_TOGGLE_KNOB_ON : TASKLIST_EDITOR_TOGGLE_KNOB_OFF)}
              />
            </Prim.Pressable>
            <Label compact>Goal</Label>
          </Prim.Box>

          {/* optional toggle */}
          <Prim.Box {...TASKLIST_EDITOR_FLAG_ITEM}>
            <Prim.Pressable
              onClick={() => onChange({ ...draft, optional: !draft.optional })}
              transition="quick" animateOnly={["color", "background-color", "border-color"]}
              {...TASKLIST_EDITOR_TOGGLE}
              {...(draft.optional ? TASKLIST_EDITOR_TOGGLE_ON : TASKLIST_EDITOR_TOGGLE_OFF)}
            >
              <Prim.Text
                transition="quick" animateOnly={["transform"]}
                {...TASKLIST_EDITOR_TOGGLE_KNOB}
                {...(draft.optional ? TASKLIST_EDITOR_TOGGLE_KNOB_ON : TASKLIST_EDITOR_TOGGLE_KNOB_OFF)}
              />
            </Prim.Pressable>
            <Label compact>Optional</Label>
          </Prim.Box>

          {/* condition */}
          <Prim.Box {...TASKLIST_EDITOR_FLAG_CONDITION}>
            <Label compact>Condition</Label>
            <Input
              type="text"
              value={draft.condition}
              onChange={(e) => onChange({ ...draft, condition: e.target.value })}
              placeholder="e.g. outputs.previous.success === true"
            />
          </Prim.Box>
        </Prim.Box>
      </Prim.Box>
    </Prim.Box>
  )
}
