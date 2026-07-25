/**
 * SettingsSchemaForm — renders a minimal form from a JSON Schema describing an
 * integration space's settings (object-of-string-properties only; see
 * INTEGRATIONS_PROGRESS.md §1). No external json-schema library: this reads
 * `schema.properties[key]` (each a string field with an optional `title` /
 * `format: 'password'`) and `schema.required` to mark required fields.
 *
 * The caller owns the value store — `values` is a flat `{ envVarName: value }`
 * map (the schema's property keys ARE pod env-var names, per contract), and
 * `onChange(key, value)` is called per keystroke so the caller can merge it
 * into whatever it eventually PUTs to `/api/compute/env`.
 */
import { Input } from '@lmthing/ui/elements/forms/input'
import { Label } from '@lmthing/ui/elements/typography/label'
import { Caption } from '@lmthing/ui/elements/typography/caption'
import { Stack } from '@lmthing/ui/elements/layouts/stack'

/** One property of a {@link JsonSchema} — string fields only. */
export interface JsonSchemaProperty {
  type?: string
  /** Field label. Falls back to the property key when omitted. */
  title?: string
  /** `'password'` renders a masked input; anything else renders plain text. */
  format?: string
  /** Rendered as the input's placeholder. */
  description?: string
}

/** Minimal JSON Schema shape this renderer understands (object-of-strings). */
export interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

export interface SettingsSchemaFormProps {
  schema: JsonSchema
  /** Flat `{ envVarName: value }` map — read for every property key. */
  values: Record<string, string>
  /** Called with `(key, value)` whenever a field changes. */
  onChange: (key: string, value: string) => void
  className?: string
}

/** Renders labeled `@lmthing/ui` inputs for every property in `schema`. */
export function SettingsSchemaForm({ schema, values, onChange, className }: SettingsSchemaFormProps) {
  const properties = schema?.properties ?? {}
  const requiredKeys = new Set(schema?.required ?? [])
  const keys = Object.keys(properties)

  if (keys.length === 0) {
    return <Caption muted>This integration has no configurable settings.</Caption>
  }

  return (
    <Stack gap="md" className={className}>
      {keys.map((key) => {
        const prop = properties[key] ?? {}
        const fieldId = `settings-schema-form-field-${key}`
        return (
          <Stack key={key} gap="sm">
            <Label htmlFor={fieldId} required={requiredKeys.has(key)} compact>
              {prop.title || key}
            </Label>
            <Input
              id={fieldId}
              name={key}
              type={prop.format === 'password' ? 'password' : 'text'}
              value={values[key] ?? ''}
              onChange={(event) => onChange(key, event.target.value)}
              placeholder={prop.description}
              fontFamily="monospace"
            />
          </Stack>
        )
      })}
    </Stack>
  )
}

export { SettingsSchemaForm as default }
