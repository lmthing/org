/**
 * The schema-derived form — what a `create` section actually is.
 *
 * **A `create` section declares no fields.** There is no `fields` property in the schema
 * and `additionalProperties: false` makes writing one an error naming its instance path.
 * The fields come from the mutation endpoint's **Input JSON Schema**, which the api author
 * already wrote and ajv already validates pod-side. That is the property being
 * structurally unable to go wrong: a form cannot drift from the endpoint it submits to,
 * because it IS the endpoint's contract.
 *
 * The precedent is `elements/forms/settings-schema-form`, which does the same trick for
 * integration settings — object-of-strings only. This handles what the corpus needs on
 * top of that, all three of which the desk check blocked on:
 *
 *  - **enums ⇒ selects** (through {@link SelectControl}, a disclosure — `Prim.Select`'s
 *    native fork is an inert placeholder, so a real `<select>` would leave every generated
 *    form unusable on the one target this project exists for);
 *  - **array-of-object ⇒ repeating row groups** — `homes/new`'s commute targets, and the
 *    named schema-form ceiling risk in the plan;
 *  - **`x-options` ⇒ endpoint-sourced options** — an annotation on the Input property, not
 *    a view-spec field, so where a foreign key's options come from belongs to the same
 *    contract the fields do. Without it a foreign-key field renders as a raw UUID text box
 *    and `trips`' settlement feature — that app's centrepiece — breaks outright.
 *
 * Validation is NOT duplicated here. Required-ness gates the submit button; everything
 * else is ajv's job on the pod, and its `{ error }` body is what the section shows. Two
 * validators would be two behaviours.
 */

import * as React from 'react'
import * as Prim from '../elements/primitives/index'
import type { XOptions } from './types'
import { resolveInputs, type Scope } from './bind'
import { humanize, stringify } from './format'
import { useViewQuery, useViewRuntime } from './runtime'
import { Labelled, SelectControl, TextControl, ToggleControl } from './controls'
import { ActionButton } from './actions'
import { ViewIcon } from './icons'

/** The slice of JSON Schema this reads. Deliberately loose — a spec never authors it. */
export interface JsonSchemaNode {
  type?: string | string[]
  title?: string
  description?: string
  format?: string
  enum?: unknown[]
  default?: unknown
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  items?: JsonSchemaNode
  maxLength?: number
  minimum?: number
  maximum?: number
  /** The `x-options` annotation, read straight off the property. */
  'x-options'?: XOptions
  [key: string]: unknown
}

/** One derived field. */
export interface DerivedField {
  key: string
  schema: JsonSchemaNode
  required: boolean
  label: string
  control: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'query-select' | 'object-list' | 'string-list'
}

const typeOf = (s: JsonSchemaNode): string => {
  const t = s.type
  if (Array.isArray(t)) return t.find((x) => x !== 'null') ?? 'string'
  return t ?? 'string'
}

/** Which control a property gets. The whole derivation, in one place. */
export function controlFor(schema: JsonSchemaNode): DerivedField['control'] {
  if (schema['x-options']) return 'query-select'
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return 'select'
  const type = typeOf(schema)
  if (type === 'boolean') return 'boolean'
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'array') {
    return typeOf(schema.items ?? {}) === 'object' ? 'object-list' : 'string-list'
  }
  if (type === 'object') return 'object-list'
  // A long free-text field gets room to be one. `maxLength` and a `textarea` format are
  // both signals the api author already wrote; neither is invented here.
  if (schema.format === 'textarea' || (schema.maxLength ?? 0) > 200) return 'textarea'
  return 'text'
}

/**
 * Derive the field list from an Input schema, minus the keys the PAGE supplies.
 *
 * `hidden` is `create.input`'s key set — a parent id bound from the route is a value the
 * page knows and the user must not be asked for.
 */
/**
 * Follow a `$ref` to the node it names — the difference between a form and an empty page.
 *
 * `ts-json-schema-generator` emits a NAMED `Input` type as a reference, not inline:
 * `{ "$ref": "#/definitions/Body", "definitions": { "Body": { properties: … } } }`. And a named type
 * is the shape the pipeline TEACHES (`export type Input = CreatePlantInput`), so this is the normal
 * case, not an exotic one. Reading `properties` off that root finds `undefined`, so every derived
 * field list came back EMPTY and every `create` page rendered **"Nothing to fill in."** above a Save
 * button — measured on two model-built apps, on web and on the Android emulator (0 `EditText` nodes).
 *
 * `libs/cli/src/app/build/schema.ts#resolveRootSchema` deliberately leaves the root ref in place
 * because **ajv resolves a local `$ref` natively** — which is true, and sufficient, for VALIDATION.
 * Form derivation is not validation: it walks the schema itself, so it has to do the resolution ajv
 * would have done. Hence this, rather than a change over there that would alter what the api layer
 * validates against.
 *
 * Only local pointers are followed (`#/definitions/X`, `#/$defs/X`) — there is no remote fetching in
 * a renderer — and a ref that resolves nowhere returns the node untouched, so an unresolvable schema
 * degrades to "no fields" exactly as before rather than throwing mid-render.
 */
function deref(node: JsonSchemaNode | undefined, root: JsonSchemaNode | undefined, seen = new Set<string>()): JsonSchemaNode | undefined {
  const ref = node?.['$ref']
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return node
  if (seen.has(ref)) return node // a cyclic definition must not spin the render
  seen.add(ref)
  let target: unknown = root
  for (const rawSeg of ref.slice(2).split('/')) {
    const seg = rawSeg.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!target || typeof target !== 'object') return node
    target = (target as Record<string, unknown>)[seg]
  }
  if (!target || typeof target !== 'object') return node
  // The resolved node may itself be a reference; `seen` bounds the chain.
  return deref(target as JsonSchemaNode, root, seen)
}

export function deriveFields(schema: JsonSchemaNode | undefined, hidden: Set<string> = new Set()): DerivedField[] {
  // `schema` is the document root, so it carries the `definitions` a `$ref` points into.
  const resolved = deref(schema, schema)
  const properties = resolved?.properties ?? {}
  const required = new Set(resolved?.required ?? [])
  return Object.entries(properties)
    .filter(([key]) => !hidden.has(key))
    .map(([key, raw]) => {
      // A PROPERTY can be a reference too (a named nested type), and `controlFor` needs the real
      // node to pick a control — an unresolved ref has no `type`, so everything became a text box.
      const prop = deref(raw, schema) ?? raw
      return {
        key,
        schema: prop,
        required: required.has(key),
        label: prop.title ?? humanize(key),
        control: controlFor(prop),
      }
    })
}

/** Seed a form's values from the schema's defaults. */
export function initialValues(fields: DerivedField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.schema.default !== undefined) out[field.key] = field.schema.default
    else if (field.control === 'boolean') out[field.key] = false
    else if (field.control === 'object-list' || field.control === 'string-list') out[field.key] = []
  }
  return out
}

/** True when every required field holds something. Gates the submit affordance only. */
export function isComplete(fields: DerivedField[], values: Record<string, unknown>): boolean {
  return fields.every((f) => {
    if (!f.required) return true
    const v = values[f.key]
    if (v === undefined || v === null) return false
    if (typeof v === 'string') return v.trim() !== ''
    if (Array.isArray(v)) return v.length > 0
    return true
  })
}

// ── field controls ───────────────────────────────────────────────────────────

/** A select whose options come from an endpoint (`x-options`). */
function QuerySelectField({
  field,
  value,
  onChange,
  scope,
}: {
  field: DerivedField
  value: unknown
  onChange: (v: unknown) => void
  scope: Scope
}) {
  const xo = field.schema['x-options'] as XOptions
  const { ready, values } = resolveInputs(xo.input, scope)
  const query = useViewQuery<unknown>({ name: xo.query, input: values, enabled: ready })

  const rows = Array.isArray(query.data)
    ? query.data
    : Array.isArray((query.data as { items?: unknown[] } | undefined)?.items)
      ? ((query.data as { items: unknown[] }).items)
      : []

  const options = rows.map((row) => ({
    label: stringify(readPath(row, xo.label)),
    value: stringify(readPath(row, xo.value)),
  }))

  return (
    <SelectControl
      value={stringify(value)}
      options={options}
      onChange={onChange}
      placeholder={query.isLoading ? 'Loading…' : `Select ${field.label.toLowerCase()}…`}
    />
  )
}

/** `$.name` off a row. A tiny local walk — `x-options` paths are always row-scoped. */
function readPath(row: unknown, binding: string): unknown {
  const path = binding.startsWith('$.') ? binding.slice(2) : binding
  let out: unknown = row
  for (const seg of path.split('.')) {
    if (out === null || out === undefined || typeof out !== 'object') return undefined
    out = (out as Record<string, unknown>)[seg]
  }
  return out
}

/**
 * A repeating group of sub-forms — the array-of-object case.
 *
 * `homes/new`'s commute targets are the measured example and the plan's named
 * schema-form ceiling risk: three fields per entry, an arbitrary number of entries. Each
 * row is the item schema's own derived fields, so nesting is one recursion deep by
 * construction (the corpus has no deeper case, and the api layer would be the wrong place
 * for one).
 */
function ObjectListField({
  field,
  value,
  onChange,
  scope,
}: {
  field: DerivedField
  value: unknown
  onChange: (v: unknown) => void
  scope: Scope
}) {
  const itemSchema = (field.schema.items ?? field.schema) as JsonSchemaNode
  const subFields = React.useMemo(() => deriveFields(itemSchema), [itemSchema])
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : []

  const setRow = (index: number, key: string, v: unknown) => {
    const next = rows.map((row, i) => (i === index ? { ...row, [key]: v } : row))
    onChange(next)
  }

  return (
    <Prim.Col gap="$3">
      {rows.map((row, index) => (
        <Prim.Col
          key={index}
          gap="$2"
          padding="$3"
          borderWidth={1}
          borderColor="$border"
          borderRadius="$radius-md"
          backgroundColor="$card"
        >
          <Prim.Row justifyContent="space-between" alignItems="center">
            <Prim.Text fontSize="$xs" color="$muted-foreground">
              {`${field.label} ${index + 1}`}
            </Prim.Text>
            <Prim.Pressable onClick={() => onChange(rows.filter((_, i) => i !== index))} padding="$1">
              <ViewIcon name="trash" size="sm" tone="danger" />
            </Prim.Pressable>
          </Prim.Row>
          {subFields.map((sub) => (
            <FieldControl
              key={sub.key}
              field={sub}
              value={row[sub.key]}
              onChange={(v) => setRow(index, sub.key, v)}
              scope={scope}
            />
          ))}
        </Prim.Col>
      ))}
      <ActionButton
        label={`Add ${field.label.toLowerCase()}`}
        icon="plus"
        variant="secondary"
        size="sm"
        onPress={() => onChange([...rows, {}])}
      />
    </Prim.Col>
  )
}

/** A repeating list of plain strings (`tags: string[]`). */
function StringListField({ field, value, onChange }: { field: DerivedField; value: unknown; onChange: (v: unknown) => void }) {
  const rows = Array.isArray(value) ? (value as unknown[]).map(stringify) : []
  return (
    <Prim.Col gap="$2">
      {rows.map((row, index) => (
        <Prim.Row key={index} gap="$2" alignItems="center">
          <Prim.Box flexGrow={1}>
            <TextControl
              value={row}
              onChange={(v) => onChange(rows.map((r, i) => (i === index ? v : r)))}
            />
          </Prim.Box>
          <Prim.Pressable onClick={() => onChange(rows.filter((_, i) => i !== index))} padding="$1">
            <ViewIcon name="close" size="sm" />
          </Prim.Pressable>
        </Prim.Row>
      ))}
      <ActionButton
        label={`Add ${field.label.toLowerCase()}`}
        icon="plus"
        variant="ghost"
        size="sm"
        onPress={() => onChange([...rows, ''])}
      />
    </Prim.Col>
  )
}

/** One derived field, labelled. */
export function FieldControl({
  field,
  value,
  onChange,
  scope,
}: {
  field: DerivedField
  value: unknown
  onChange: (v: unknown) => void
  scope: Scope
}): React.ReactElement {
  const hint = field.schema.description

  switch (field.control) {
    case 'boolean':
      return (
        <ToggleControl value={!!value} onChange={onChange} label={field.label} />
      )
    case 'select':
      return (
        <Labelled label={field.label} required={field.required} hint={hint}>
          <SelectControl
            value={stringify(value)}
            options={(field.schema.enum ?? []).map((o) => ({ label: humanize(o), value: stringify(o) }))}
            onChange={onChange}
          />
        </Labelled>
      )
    case 'query-select':
      return (
        <Labelled label={field.label} required={field.required} hint={hint}>
          <QuerySelectField field={field} value={value} onChange={onChange} scope={scope} />
        </Labelled>
      )
    case 'object-list':
      return (
        <Labelled label={field.label} required={field.required} hint={hint}>
          <ObjectListField field={field} value={value} onChange={onChange} scope={scope} />
        </Labelled>
      )
    case 'string-list':
      return (
        <Labelled label={field.label} required={field.required} hint={hint}>
          <StringListField field={field} value={value} onChange={onChange} />
        </Labelled>
      )
    case 'number':
      return (
        <Labelled label={field.label} required={field.required} hint={hint}>
          <TextControl
            value={value === undefined || value === null ? '' : String(value)}
            numeric
            onChange={(v) => onChange(v === '' ? undefined : Number(v))}
          />
        </Labelled>
      )
    case 'textarea':
    case 'text':
    default:
      return (
        <Labelled label={field.label} required={field.required} hint={hint}>
          <TextControl
            value={stringify(value)}
            onChange={(v) => onChange(v)}
            multiline={field.control === 'textarea'}
            secure={field.schema.format === 'password'}
          />
        </Labelled>
      )
  }
}

// ── the form ─────────────────────────────────────────────────────────────────

export interface SchemaFormProps {
  fields: DerivedField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  scope: Scope
}

/** Every derived field, in the Input schema's own property order. */
export function SchemaForm({ fields, values, onChange, scope }: SchemaFormProps): React.ReactElement {
  const { client } = useViewRuntime()
  void client
  if (fields.length === 0) {
    return (
      <Prim.Text fontSize="$sm" color="$muted-foreground">
        Nothing to fill in.
      </Prim.Text>
    )
  }
  return (
    <Prim.Col gap="$4">
      {fields.map((field) => (
        <FieldControl
          key={field.key}
          field={field}
          value={values[field.key]}
          onChange={(v) => onChange(field.key, v)}
          scope={scope}
        />
      ))}
    </Prim.Col>
  )
}

/**
 * `prefill` with `merge: 'fill-empty'` — fill only the keys the user has not touched.
 *
 * The only merge policy in v1, and a NAMED one rather than a predicate. S2: a prefill with
 * no `from` seeds the form from the endpoint's Output by matching FIELD NAMES, which is
 * the shape all five catalogue apps' settings pages have.
 */
export function mergeFillEmpty(
  values: Record<string, unknown>,
  incoming: Record<string, unknown>,
  fields: DerivedField[],
): Record<string, unknown> {
  const known = new Set(fields.map((f) => f.key))
  const out = { ...values }
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (!known.has(key)) continue
    const existing = out[key]
    const empty =
      existing === undefined ||
      existing === null ||
      existing === '' ||
      (Array.isArray(existing) && existing.length === 0) ||
      existing === false
    if (empty && value !== undefined && value !== null) out[key] = value
  }
  return out
}
