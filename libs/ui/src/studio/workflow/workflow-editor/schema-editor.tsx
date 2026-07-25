/**
 * SchemaEditor — a repeatable field/type row list used for both task
 * input/output schemas and the tasklist manifest input schema.
 */
import * as Prim from '../../../elements/primitives/index.js';
import { Input } from '@lmthing/ui/elements/forms/input'
import { Select, SelectOption } from '@lmthing/ui/elements/forms/select'
import { Button } from '@lmthing/ui/elements/forms/button'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { FIELD_TYPES } from './schema-utils'
import type { SchemaRow, TaskFieldType } from './types'
import { TASKLIST_EDITOR_ADD_OUTPUT_BTN, TASKLIST_EDITOR_OUTPUT_FIELD_INPUT, TASKLIST_EDITOR_OUTPUT_ROW, TASKLIST_EDITOR_OUTPUT_ROWS } from './tasklist-editor.props.js'

export interface SchemaEditorProps {
  rows: SchemaRow[]
  onChange: (rows: SchemaRow[]) => void
  addLabel?: string
  emptyHint?: string
}

export function SchemaEditor({ rows, onChange, addLabel = '+ Add field', emptyHint }: SchemaEditorProps) {
  return (
    <Prim.Box {...TASKLIST_EDITOR_OUTPUT_ROWS}>
      {rows.map((row, i) => (
        <Prim.Box key={i} {...TASKLIST_EDITOR_OUTPUT_ROW}>
          <Input
            type="text"
            value={row.field}
            onChange={(e) => {
              const next = [...rows]
              next[i] = { ...row, field: e.target.value }
              onChange(next)
            }}
            placeholder="fieldName"
            {...(TASKLIST_EDITOR_OUTPUT_FIELD_INPUT as Record<string, unknown>)}
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
            <Prim.Svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <Prim.Path d="M18 6L6 18M6 6l12 12" />
            </Prim.Svg>
          </Button>
        </Prim.Box>
      ))}
      <Prim.Pressable
        transition="quick" animateOnly={["color", "background-color", "border-color"]}
        {...TASKLIST_EDITOR_ADD_OUTPUT_BTN}
        onClick={() => onChange([...rows, { field: '', type: 'string' }])}
      >
        {addLabel}
      </Prim.Pressable>
      {emptyHint && rows.length === 0 && (
        <Caption muted>{emptyHint}</Caption>
      )}
    </Prim.Box>
  )
}
