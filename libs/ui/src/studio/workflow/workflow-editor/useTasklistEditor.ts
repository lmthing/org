/**
 * useTasklistEditor — owns all draft/mutation/save state for the
 * TasklistEditor form: task drafts, the manifest draft, dirty/saving
 * flags, and the FS write-out on save.
 *
 * Reads/writes tasklists/<name>/NN-<id>.md and tasklists/<name>/index.md
 * via SpaceFS. Uses useTasklistTasks(name)/useTasklistIndex(name) from
 * @lmthing/state to read live, fully-parsed task/manifest data.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import {
  useTasklistTasks,
  useTasklistIndex,
  useSpaceFS,
  serializeTasklistTask,
  serializeTasklistIndex,
  tasklistTaskFilename,
  P,
  type TasklistTask,
  type TasklistIndex,
} from '@lmthing/state'
import { schemaRowsToRecord, recordToSchemaRows, taskToTaskDraft } from './schema-utils'
import type { ManifestDraft, TaskDraft, TaskFieldType } from './types'

export function useTasklistEditor(name: string) {
  // Wave-1 APIs: fully-parsed tasks + manifest
  const taskEntries = useTasklistTasks(name)
  const tasklistIndex = useTasklistIndex(name)
  const spaceFS = useSpaceFS()

  // Track whether the draft has been seeded from live FS data.
  // We seed once (or when the component re-mounts for a different tasklist)
  // and then leave edits untouched until the user saves.
  const seededRef = useRef<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // ── Task drafts ───────────────────────────────────────────────────────────

  const [drafts, setDrafts] = useState<TaskDraft[]>(() =>
    taskEntries
      .map((entry) => entry.task)
      .filter((t): t is TasklistTask => t !== null)
      .map(taskToTaskDraft)
  )

  // ── Manifest draft ────────────────────────────────────────────────────────

  const [manifestDraft, setManifestDraft] = useState<ManifestDraft>(() => ({
    description: tasklistIndex?.description ?? '',
    input: recordToSchemaRows(tasklistIndex?.input),
  }))

  // Re-seed from live FS when switching to a different tasklist or on first mount
  useEffect(() => {
    if (seededRef.current === name) return // already seeded for this name
    seededRef.current = name
    setIsDirty(false)

    const seeded = taskEntries
      .map((entry) => entry.task)
      .filter((t): t is TasklistTask => t !== null)
      .map(taskToTaskDraft)
    setDrafts(seeded)

    setManifestDraft({
      description: tasklistIndex?.description ?? '',
      input: recordToSchemaRows(tasklistIndex?.input),
    })
  // We intentionally only re-seed when the tasklist name changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  const allTaskIds = drafts.map((d) => d.id)

  // ── Task mutations ─────────────────────────────────────────────────────────

  const updateDraft = useCallback((index: number, updated: TaskDraft) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? updated : d)))
    setIsDirty(true)
  }, [])

  const addTask = useCallback(() => {
    const newId = `task_${Date.now()}`
    setDrafts((prev) => [
      ...prev,
      {
        id: newId,
        instruction: '',
        input: [],
        output: [{ field: 'result', type: 'string' as TaskFieldType }],
        dependsOn: [],
        goal: prev.length === 0, // first task gets goal by default
        optional: false,
        condition: '',
      },
    ])
    setIsDirty(true)
  }, [])

  const deleteTask = useCallback((index: number) => {
    setDrafts((prev) => {
      const next = prev.filter((_, i) => i !== index)
      // ensure exactly one goal
      const hasGoal = next.some((d) => d.goal)
      if (!hasGoal && next.length > 0) {
        next[next.length - 1] = { ...next[next.length - 1], goal: true }
      }
      return next
    })
    setIsDirty(true)
  }, [])

  const moveTask = useCallback((fromIndex: number, toIndex: number) => {
    setDrafts((prev) => {
      if (toIndex < 0 || toIndex >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
    setIsDirty(true)
  }, [])

  const setGoal = useCallback((index: number) => {
    setDrafts((prev) =>
      prev.map((d, i) => ({ ...d, goal: i === index }))
    )
    setIsDirty(true)
  }, [])

  const updateManifest = useCallback((updated: ManifestDraft) => {
    setManifestDraft(updated)
    setIsDirty(true)
  }, [])

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!spaceFS) return
    setIsSaving(true)

    try {
      // Ensure exactly one goal
      let normalizedDrafts = [...drafts]
      const goalCount = normalizedDrafts.filter((d) => d.goal).length
      if (goalCount === 0 && normalizedDrafts.length > 0) {
        normalizedDrafts[normalizedDrafts.length - 1] = {
          ...normalizedDrafts[normalizedDrafts.length - 1],
          goal: true,
        }
      } else if (goalCount > 1) {
        // Keep only the last goal
        let foundGoal = false
        normalizedDrafts = normalizedDrafts.map((d, i) => {
          if (d.goal) {
            if (i === normalizedDrafts.length - 1 || !foundGoal) {
              foundGoal = true
              return d
            }
            return { ...d, goal: false }
          }
          return d
        })
      }

      // Remove old task files for this tasklist
      const existingPaths = taskEntries.map((entry) => entry.path)
      for (const path of existingPaths) {
        spaceFS.deleteFile(path)
      }

      // Write new task files
      for (let i = 0; i < normalizedDrafts.length; i++) {
        const d = normalizedDrafts[i]
        const order = i + 1
        const filename = tasklistTaskFilename(order, d.id)
        const path = `tasklists/${name}/${filename}`

        const inputRecord = schemaRowsToRecord(d.input)
        const task: TasklistTask = {
          order,
          id: d.id,
          instruction: d.instruction,
          ...(Object.keys(inputRecord).length > 0 ? { input: inputRecord } : {}),
          output: schemaRowsToRecord(d.output),
          dependsOn: d.dependsOn.length > 0 ? d.dependsOn : undefined,
          optional: d.optional || undefined,
          goal: d.goal || undefined,
          condition: d.condition.trim() || undefined,
        }

        spaceFS.writeFile(path, serializeTasklistTask(task))
      }

      // Write (or overwrite) the manifest index.md
      const inputRecord = schemaRowsToRecord(manifestDraft.input)
      const indexData: TasklistIndex = {
        ...(Object.keys(inputRecord).length > 0 ? { input: inputRecord } : {}),
        description: manifestDraft.description,
      }
      spaceFS.writeFile(P.tasklistIndex(name), serializeTasklistIndex(indexData, manifestDraft.description))

      setDrafts(normalizedDrafts)
      setIsDirty(false)
    } finally {
      setIsSaving(false)
    }
  }, [drafts, manifestDraft, name, spaceFS, taskEntries])

  return {
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
  }
}
