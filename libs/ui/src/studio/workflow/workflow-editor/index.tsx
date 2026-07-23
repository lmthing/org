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
import './tasklist-editor.css'

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
    <Prim.Box className="tasklist-editor">
      {/* Header */}
      <Prim.Box className="tasklist-editor__header">
        <Prim.Box className="tasklist-editor__header-inner">
          <Stack row gap="md" className="tasklist-editor__header-top">
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
            <Prim.Box className="tasklist-editor__header-actions">
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
      <Prim.Box className="tasklist-editor__body">
        {/* Manifest section (index.md) */}
        <ManifestSection
          draft={manifestDraft}
          onChange={updateManifest}
        />

        {/* Divider */}
        <Prim.Box className="tasklist-editor__section-divider" />

        {/* Tasks */}
        {drafts.length === 0 ? (
          <Prim.Box className="tasklist-editor__empty">
            <Heading level={3}>No tasks yet</Heading>
            <Caption muted>Add your first task to get started.</Caption>
            <Button variant="primary" onClick={addTask}>Add Task</Button>
          </Prim.Box>
        ) : (
          <Prim.Box className="tasklist-editor__task-list">
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

        <Prim.Pressable className="tasklist-editor__add-task-btn" onClick={addTask}>
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
