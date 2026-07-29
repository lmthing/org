/**
 * `create` — the form. Replaces the catalogue's 139 mutations' forms.
 *
 * **It declares no fields.** They derive from the mutation endpoint's Input JSON Schema
 * (see `../form.tsx`), which is the property being structurally unable to go wrong: a form
 * cannot drift from the endpoint it submits to, because it IS the endpoint's contract. All
 * seven hand-built form components in the corpus are whole-page `create` sections and not
 * one of the five apps has a file picker, so this covers the measured surface.
 *
 * Four features on top of "render the schema", each one measured:
 *
 *  - **`input`** — values the PAGE supplies (a parent id bound from the route). Hidden from
 *    the form and merged into the submit, so a nested create needs no hidden-field trick.
 *  - **`prefill`** — S2: with no `from`, seed the form on mount from the endpoint's Output
 *    by matching field names (5/5 catalogue apps have a settings page shaped exactly like
 *    this). A prefill whose `input` binds `$form.*` CANNOT run on mount — the form is still
 *    empty — so the renderer offers it as an explicit action instead. That distinction is
 *    derived from the spec, never declared.
 *  - **`async`** — the mutation runs in the background (an import). Show the note, refetch
 *    after N ms. This is what `health/AIWorking`'s "this page updates automatically" copy
 *    was hand-writing.
 *  - **`onSuccess`** — where to go afterwards, with `$result.*` in scope, which is why a
 *    post-create redirect needs no route templating.
 */

import * as React from 'react'
import * as Prim from '../../elements/primitives/index'
import type { Arg, CreateSection } from '../types'
import { resolveInputs, resolveOptional, type Scope } from '../bind'
import { stringify } from '../format'
import { useViewMutation, useViewQuery, useViewRuntime } from '../runtime'
import { ActionButton, useDispatch } from '../actions'
import { deriveFields, initialValues, isComplete, mergeFillEmpty, SchemaForm, type JsonSchemaNode } from '../form'
import { ErrorState, PendingNote } from '../states'
import { SectionFrame, titleFromEndpoint } from './common'

export function CreateSectionView({ section, scope }: { section: CreateSection; scope: Scope }): React.ReactElement {
  const { client, invalidate } = useViewRuntime()
  const dispatch = useDispatch()

  const entry = client.endpoint(section.mutation)
  const hidden = React.useMemo(() => new Set(Object.keys(section.input ?? {})), [section.input])
  const fields = React.useMemo(
    () => deriveFields(entry?.inputSchema as JsonSchemaNode | undefined, hidden),
    [entry, hidden],
  )

  const [values, setValues] = React.useState<Record<string, unknown>>(() => initialValues(fields))
  const [submitted, setSubmitted] = React.useState(false)
  const mutation = useViewMutation(section.mutation, section.invalidates)

  // The form's own values are a binding root (`$form.*`), which is what lets an
  // extract-from-a-blob prefill see what the user has typed so far.
  const formScope: Scope = React.useMemo(() => ({ ...scope, form: values }), [scope, values])

  // ── prefill ──────────────────────────────────────────────────────────────
  const prefill = section.prefill
  // S2's derivation: a prefill whose input binds `$form.*` cannot run on mount.
  const onMount = !!prefill && !bindsForm(prefill.input)
  const prefillInputs = resolveInputs(prefill?.input, formScope)
  const prefillQuery = useViewQuery({
    name: onMount ? prefill?.endpoint : undefined,
    input: prefillInputs.values,
    enabled: onMount && prefillInputs.ready,
  })

  const seeded = React.useRef(false)
  React.useEffect(() => {
    if (seeded.current || !onMount || prefillQuery.data === undefined) return
    seeded.current = true
    const incoming = prefill?.from
      ? (resolveOptional(prefill.from, { ...scope, self: prefillQuery.data }) as Record<string, unknown>)
      : (prefillQuery.data as Record<string, unknown>)
    if (incoming && typeof incoming === 'object') {
      setValues((prev) => mergeFillEmpty(prev, incoming, fields))
    }
  }, [onMount, prefillQuery.data, prefill, scope, fields])

  const runExplicitPrefill = React.useCallback(async () => {
    if (!prefill) return
    const { values: input } = resolveInputs(prefill.input, formScope)
    const out = await client.call(prefill.endpoint, input)
    const incoming = prefill.from
      ? (resolveOptional(prefill.from, { ...scope, self: out }) as Record<string, unknown>)
      : (out as Record<string, unknown>)
    if (incoming && typeof incoming === 'object') setValues((prev) => mergeFillEmpty(prev, incoming, fields))
  }, [prefill, formScope, client, scope, fields])

  // ── submit ───────────────────────────────────────────────────────────────
  const submit = React.useCallback(async () => {
    const { ready, values: pageInput } = resolveInputs(section.input, scope)
    if (!ready) return
    const result = await mutation.run({ ...pageInput, ...values })
    setSubmitted(true)
    setValues(initialValues(fields))
    seeded.current = false
    if (section.async?.refetchAfter) {
      // A background import: the row will not exist yet, so re-ask a moment later. The
      // read side of the same idea is `poll`.
      setTimeout(() => invalidate(section.invalidates ?? []), section.async.refetchAfter)
    }
    if (section.onSuccess) await dispatch(section.onSuccess, { ...scope, result })
  }, [section, scope, mutation, values, fields, invalidate, dispatch])

  const title = resolveOptional(section.title, scope) ?? titleFromEndpoint(section.mutation)
  const complete = isComplete(fields, values)

  if (!entry) {
    return (
      <ErrorState
        title="Form unavailable"
        message={`"${section.mutation}" is not in the endpoint manifest, so its fields cannot be derived.`}
      />
    )
  }

  return (
    <SectionFrame title={title as string | undefined} scope={scope}>
      <Prim.Col gap="$4">
        {section.async?.note && submitted ? <PendingNote note={stringify(resolveOptional(section.async.note, scope))} /> : null}
        {mutation.error ? <ErrorState message={mutation.error.message} /> : null}

        <SchemaForm fields={fields} values={values} onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))} scope={formScope} />

        <Prim.Row gap="$2" alignItems="center" flexWrap="wrap">
          <ActionButton
            label={stringify(resolveOptional(section.submitLabel, scope) ?? 'Save')}
            variant="primary"
            onPress={submit}
            disabled={!complete || mutation.isPending}
          />
          {prefill && !onMount ? (
            <ActionButton label="Fill from what I typed" variant="secondary" onPress={runExplicitPrefill} />
          ) : null}
        </Prim.Row>
      </Prim.Col>
    </SectionFrame>
  )
}

/** True when any prefill input reads the form — the S2 test for "cannot run on mount". */
function bindsForm(input: Record<string, Arg> | undefined): boolean {
  return Object.values(input ?? {}).some((b) => typeof b === 'string' && b.startsWith('$form.'))
}
