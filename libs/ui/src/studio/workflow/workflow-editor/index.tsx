/**
 * TasklistEditor — form-based editor for a single tasklist.
 *
 * Composition root: graph/draft state lives in useTasklistEditor(name);
 * the manifest, per-task form, and field-schema rows are rendered by
 * ManifestSection / TaskForm / SchemaEditor.
 */
import * as Prim from '../../../elements/primitives/index.js';
import { Button } from '@lmthing/ui/elements/forms/button'
import { Stack } from '@lmthing/ui/elements/layouts/stack'
import { Heading } from '@lmthing/ui/elements/typography/heading'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { ManifestSection } from './manifest-section'
import { TaskForm } from './task-form'
import { useTasklistEditor } from './useTasklistEditor'
import type { TasklistEditorProps } from './types'
import { TASKLIST_EDITOR, TASKLIST_EDITOR_ADD_TASK_BTN, TASKLIST_EDITOR_BODY, TASKLIST_EDITOR_EMPTY, TASKLIST_EDITOR_HEADER, TASKLIST_EDITOR_HEADER_ACTIONS, TASKLIST_EDITOR_HEADER_INNER, TASKLIST_EDITOR_HEADER_TOP, TASKLIST_EDITOR_SECTION_DIVIDER, TASKLIST_EDITOR_TASK_LIST } from './tasklist-editor.props.js'

export function TasklistEditor({ name, onBack }: TasklistEditorProps) {
  const {
    drafts,
    manifestDraft,
    isDirty,
    isSaving,
    allTaskIds,
    updateDraft,
    addTask,
    deleteTask,
    moveTask,
    setGoal,
    updateManifest,
    handleSave,
  } = useTasklistEditor(name)

  return (
    <Prim.Box {...TASKLIST_EDITOR}>
      {/* Header */}
      <Prim.Box {...TASKLIST_EDITOR_HEADER}>
        <Prim.Box {...TASKLIST_EDITOR_HEADER_INNER}>
          <Stack row gap="md" {...TASKLIST_EDITOR_HEADER_TOP}>
            {onBack && (
              <Button variant="ghost" size="icon" onClick={onBack} title="Back">
                <Prim.Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                  <Prim.Path d="M19 12H5M12 19l-7-7 7-7" />
                </Prim.Svg>
              </Button>
            )}
            <Prim.Box>
              <Heading level={2}>{name}</Heading>
              <Caption muted>
                {drafts.length} task{drafts.length !== 1 ? 's' : ''}
                {isDirty && ' • unsaved changes'}
              </Caption>
            </Prim.Box>
            <Prim.Box {...TASKLIST_EDITOR_HEADER_ACTIONS}>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={!isDirty || isSaving}
              >
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
            </Prim.Box>
          </Stack>
        </Prim.Box>
      </Prim.Box>

      {/* Body */}
      <Prim.Box {...TASKLIST_EDITOR_BODY}>
        {/* Manifest section (index.md) */}
        <ManifestSection
          draft={manifestDraft}
          onChange={updateManifest}
        />

        {/* Divider */}
        <Prim.Box {...TASKLIST_EDITOR_SECTION_DIVIDER} />

        {/* Tasks */}
        {drafts.length === 0 ? (
          <Prim.Box {...TASKLIST_EDITOR_EMPTY}>
            <Heading level={3}>No tasks yet</Heading>
            <Caption muted>Add your first task to get started.</Caption>
            <Button variant="primary" onClick={addTask}>Add Task</Button>
          </Prim.Box>
        ) : (
          <Prim.Box {...TASKLIST_EDITOR_TASK_LIST}>
            {drafts.map((draft, index) => (
              <TaskForm
                key={`${index}-${draft.id}`}
                draft={draft}
                allTaskIds={allTaskIds}
                index={index}
                isFirst={index === 0}
                isLast={index === drafts.length - 1}
                onChange={(updated) => updateDraft(index, updated)}
                onDelete={() => deleteTask(index)}
                onMoveUp={() => moveTask(index, index - 1)}
                onMoveDown={() => moveTask(index, index + 1)}
                onSetGoal={() => setGoal(index)}
              />
            ))}
          </Prim.Box>
        )}

        <Prim.Pressable transition="quick" animateOnly={["color", "background-color", "border-color"]} {...TASKLIST_EDITOR_ADD_TASK_BTN} onClick={addTask}>
          <Prim.Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
            <Prim.Path d="M12 5v14M5 12h14" />
          </Prim.Svg>
          Add Task
        </Prim.Pressable>
      </Prim.Box>
    </Prim.Box>
  )
}

// Keep the old name as an alias so any existing import of WorkflowEditor still compiles.
export { TasklistEditor as WorkflowEditor }
