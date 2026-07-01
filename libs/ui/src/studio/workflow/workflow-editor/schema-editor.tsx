/**
 * SchemaEditor — a repeatable field/type row list used for both task
 * input/output schemas and the tasklist manifest input schema.
 */
import { Input } from '@lmthing/ui/elements/forms/input'
import { Select, SelectOption } from '@lmthing/ui/elements/forms/select'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { FIELD_TYPES } from './schema-utils'
import type { SchemaRow, TaskFieldType } from './types'

export interface SchemaEditorProps {
  rows: SchemaRow[]
  onChange: (rows: SchemaRow[]) => void
  addLabel?: string
  emptyHint?: string
}

export function SchemaEditor({ rows, onChange, addLabel = '+ Add field', emptyHint }: SchemaEditorProps) {
  return (
    <div className="tasklist-editor__output-rows">
      {rows.map((row, i) => (
        <div key={i} className="tasklist-editor__output-row">
          <Input
            type="text"
            value={row.field}
            onChange={(e) => {
              const next = [...rows]
              next[i] = { ...row, field: e.target.value }
              onChange(next)
            }}
            placeholder="fieldName"
            className="tasklist-editor__output-field-input"
          />
          <Select
            value={row.type}
            onChange={(e) => {
              const next = [...rows]
              next[i] = { ...row, type: e.target.value as TaskFieldType }
              onChange(next)
            }}
          >
            {FIELD_TYPES.map((t) => (
              <SelectOption key={t} value={t}>{t}</SelectOption>
            ))}
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            title="Remove field"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Button>
        </div>
      ))}
      <button
        className="tasklist-editor__add-output-btn"
        onClick={() => onChange([...rows, { field: '', type: 'string' }])}
      >
        {addLabel}
      </button>
      {emptyHint && rows.length === 0 && (
        <Caption muted>{emptyHint}</Caption>
      )}
    </div>
  )
}
