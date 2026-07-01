/**
 * Shared types for the tasklist (workflow) editor form.
 */

export type TaskFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array'

/** A field→type pair used in the input/output editors */
export interface SchemaRow {
  field: string
  type: TaskFieldType
}

/** Draft state for a single task being edited in the form */
export interface TaskDraft {
  id: string
  instruction: string
  input: SchemaRow[]
  output: SchemaRow[]
  dependsOn: string[]
  goal: boolean
  optional: boolean
  condition: string
}

/** Draft state for the tasklist manifest (index.md) */
export interface ManifestDraft {
  description: string
  input: SchemaRow[]
}

export interface TasklistEditorProps {
  /** The tasklist directory name under tasklists/ */
  name: string
  onBack?: () => void
}
