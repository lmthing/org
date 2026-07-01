/**
 * Pure helpers for converting between the form's SchemaRow[] draft shape
 * and the record<field, type> shape used by the underlying TasklistTask /
 * TasklistIndex data model.
 */
import type { TasklistTask } from '@lmthing/state'
import type { SchemaRow, TaskDraft, TaskFieldType } from './types'

export const FIELD_TYPES: TaskFieldType[] = ['string', 'number', 'boolean', 'object', 'array']

export function schemaRowsToRecord(rows: SchemaRow[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const row of rows) {
    if (row.field.trim()) record[row.field.trim()] = row.type
  }
  return record
}

export function recordToSchemaRows(record: Record<string, string> | undefined): SchemaRow[] {
  if (!record || Object.keys(record).length === 0) return []
  return Object.entries(record).map(([field, type]) => ({
    field,
    type: type as TaskFieldType,
  }))
}

// Convert a parsed TasklistTask to a TaskDraft
export function taskToTaskDraft(task: TasklistTask): TaskDraft {
  return {
    id: task.id,
    instruction: task.instruction,
    input: recordToSchemaRows(task.input),
    output: recordToSchemaRows(task.output).length > 0
      ? recordToSchemaRows(task.output)
      : [{ field: 'result', type: 'string' }],
    dependsOn: task.dependsOn ?? [],
    goal: task.goal ?? false,
    optional: task.optional ?? false,
    condition: task.condition ?? '',
  }
}
