/**
 * What every section needs before it can draw anything: where its data comes from, what a
 * row looks like when nobody said, and the section frame itself.
 *
 * ## The view-shaped-endpoint rule, implemented
 *
 * **One section, one endpoint, and the endpoint's Output must satisfy the section's
 * bindings.** So there is no join here, no client-side selection and no transform — the
 * only thing this module does with an Output is find the array inside it. Cross-query
 * joins and selection logic are computed Output fields, which `validate.ts` enforces at
 * save time and `renderSmokeViews` catches when a binding is contract-valid but always
 * null in practice.
 *
 * The one relaxation is `from`, and it STRENGTHENS the rule rather than loosening it: an
 * embedded array (`article.citations`, `trip.days`) is already in an Output the app
 * fetches, so sourcing a section from it removes a round trip instead of adding one. The
 * alternative was one extra endpoint per embedded array, inflating exactly the api layer
 * the plan wants left alone.
 */

import * as React from 'react'
import * as Prim from '../../elements/primitives/index'
import type { Binding, EmptyState, FlatItem, Slot, Value } from '../types'
import { resolveArray, resolveInputs, resolveOptional, resolveValue, type Scope } from '../bind'
import { humanize, stringify } from '../format'
import { useViewQuery, useViewRuntime, type QueryState } from '../runtime'
import { EmptySlot } from '../elements'
import { ErrorState, LoadingState, type SkeletonShape } from '../states'

/** Where a section's data comes from, once `query`/`from`/`input`/`param` are settled. */
export interface SectionSource<T = unknown> {
  query: QueryState<T>
  /** The rows a collection draws, after `from` / array-extraction / `limit`. */
  rows: unknown[]
  /** The single record a `detail` draws. */
  record: unknown
  /** False when a dependent binding is unresolved — the section is deliberately idle. */
  ready: boolean
}

export interface SourceArgs {
  query?: string
  from?: Binding
  input?: Record<string, Binding>
  param?: Binding
  limit?: number
  poll?: { everyMs: number; while?: { field: Binding; in: (string | number | boolean)[] } }
  scope: Scope
  /** The section's own id, so its Output can be published under `$data.<id>`. */
  id?: string
  /**
   * Already-resolved values the RENDERER contributes — a facet choice, a search term.
   * Kept apart from `input` so an unresolved dependent binding still disables the query
   * while a facet the user has not touched is simply not sent (schema S4).
   */
  extraInput?: Record<string, unknown>
}

/**
 * Find the array inside an Output.
 *
 * An endpoint may return the array itself, or wrap it. Preferring the conventional key
 * names before falling back to "the first array-valued property" is what lets a list
 * section work against `{ recipes: [...] , total: 12 }` without the spec naming the key —
 * and `from` exists for every case where the model wants to be explicit.
 */
export function extractRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  for (const key of ['items', 'rows', 'results', 'data', 'records', 'list']) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[]
  }
  for (const value of Object.values(obj)) if (Array.isArray(value)) return value
  return []
}

/**
 * Resolve a section's data source.
 *
 * Three shapes, in the order they are decided:
 *  1. `from` pointing at ANOTHER section's Output (`$data.trip.days`) — no request at all;
 *  2. `query` (+ optional `from` into its own Output) — one request;
 *  3. neither — an idle source, which only a `markdown` section with a literal `source` has.
 */
export function useSectionSource(args: SourceArgs): SectionSource {
  const { routeParams } = useViewRuntime()
  const { scope } = args

  // `param` defaults to the route's single `[param]`. A detail page under `recipes/[id]`
  // should not have to say `param: '$route.id'` — there is only one thing it could mean.
  const routeKeys = Object.keys(routeParams)
  const paramValue = args.param
    ? resolveOptional(args.param, scope)
    : routeKeys.length === 1
      ? routeParams[routeKeys[0]]
      : undefined
  const paramKey = args.param ? undefined : routeKeys.length === 1 ? routeKeys[0] : undefined

  const inputs = resolveInputs(args.input, scope)
  const extraKey = JSON.stringify(args.extraInput ?? {})
  const input = React.useMemo(() => {
    const out: Record<string, unknown> = { ...inputs.values, ...(args.extraInput ?? {}) }
    if (paramValue !== undefined && paramKey && out[paramKey] === undefined) out[paramKey] = paramValue
    else if (paramValue !== undefined && args.param && out.id === undefined) out.id = paramValue
    return out
    // Serialised, so a fresh object on every render does not re-fire the query.
  }, [JSON.stringify(inputs.values), extraKey, paramValue, paramKey, args.param])

  // `from` into another SECTION's Output means this section makes no request at all — the
  // array is already on the page.
  const fromOther = !args.query && !!args.from
  const query = useViewQuery({
    name: fromOther ? undefined : args.query,
    input,
    enabled: inputs.ready,
    poll: args.poll,
  })

  const rows = React.useMemo(() => {
    const base = fromOther
      ? resolveArray(args.from, scope)
      : args.from
        ? resolveArray(args.from, { ...scope, self: query.data })
        : extractRows(query.data)
    return args.limit ? base.slice(0, args.limit) : base
  }, [fromOther, args.from, args.limit, query.data, scope.data])

  const record = fromOther ? undefined : Array.isArray(query.data) ? query.data[0] : query.data

  return { query, rows, record, ready: inputs.ready && (fromOther || query.enabled) }
}

// ── the default item shape ───────────────────────────────────────────────────

const TITLE_KEYS = ['title', 'name', 'label', 'subject', 'headline', 'summary', 'description']
const SUB_KEYS = ['subtitle', 'summary', 'description', 'note', 'detail', 'body', 'excerpt']
const STATUS_KEYS = ['status', 'state', 'severity', 'priority', 'urgency', 'kind', 'category', 'type']
const VALUE_KEYS = ['amount', 'total', 'price', 'cost', 'score', 'count', 'value', 'quantity']
const TIME_KEYS = ['createdAt', 'updatedAt', 'date', 'when', 'at', 'due', 'dueAt', 'startsAt', 'scheduledAt']

function pick(keys: string[], available: Set<string>): string | undefined {
  return keys.find((k) => available.has(k))
}

/**
 * Derive a row shape from the DATA when the spec did not author one.
 *
 * The schema keeps `item` optional and says "absent ⇒ the renderer derives it from the
 * Output schema"; deriving from the first ROW is strictly better, because it sees which
 * optional fields are actually populated. A section that binds nothing still renders
 * something recognisable, which is what keeps `{ kind: 'list', query: 'X' }` a legal
 * minimum rather than a blank page.
 */
export function deriveItem(sample: unknown): FlatItem {
  if (!sample || typeof sample !== 'object') return { title: '$' }
  const keys = new Set(Object.keys(sample as Record<string, unknown>))
  const item: FlatItem = {}
  const title = pick(TITLE_KEYS, keys)
  if (title) item.title = `$.${title}`
  const sub = pick(
    SUB_KEYS.filter((k) => k !== title),
    keys,
  )
  if (sub) item.caption = { value: `$.${sub}`, maxLines: 2 }
  const status = pick(STATUS_KEYS, keys)
  if (status) item.status = { value: `$.${status}`, tone: 'auto' }
  const value = pick(VALUE_KEYS, keys)
  if (value) item.value = `$.${value}`
  const time = pick(TIME_KEYS, keys)
  if (time) item.meta = { value: `$.${time}`, format: 'relative-time' }
  // Nothing recognisable: show the record rather than an empty row. A blank row is the
  // "structurally-valid zeros" failure the render smoke exists to catch.
  if (Object.keys(item).length === 0) {
    const first = [...keys][0]
    item.title = first ? `$.${first}` : '$'
  }
  return item
}

/** A stable key for a row — for React, and for a `selectable` list's selection set. */
export function rowKey(row: unknown, index: number): string {
  if (row && typeof row === 'object') {
    const obj = row as Record<string, unknown>
    for (const key of ['id', '_id', 'uuid', 'key', 'slug']) {
      const v = obj[key]
      if (typeof v === 'string' || typeof v === 'number') return String(v)
    }
  }
  return String(index)
}

// ── the section frame ────────────────────────────────────────────────────────

/**
 * A section's title + body, and the three states that are never authored.
 *
 * `state` collapses the whole lifecycle into one decision so no section kind can forget a
 * case — which is exactly how 26 hand-built loading/empty/error components came to exist
 * across five apps.
 */
export function SectionFrame({
  title,
  scope,
  source,
  skeleton = 'rows',
  empty,
  emptyDefault,
  isEmpty,
  actions,
  children,
}: {
  title?: Value
  scope: Scope
  source?: SectionSource
  skeleton?: SkeletonShape
  empty?: Value | EmptyState
  /** The default title when neither `empty` nor a section-specific default applies. */
  emptyDefault?: string
  isEmpty?: boolean
  actions?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  const heading = resolveValue(title, scope)

  let body: React.ReactNode
  if (source && !source.ready) {
    // A dependent query whose input has not arrived. Showing a skeleton is honest — the
    // section IS waiting — and showing an empty state would be a lie.
    body = <LoadingState shape={skeleton} />
  } else if (source?.query.error) {
    body = <ErrorState message={source.query.error.message} onRetry={source.query.refetch} />
  } else if (source?.query.isLoading) {
    body = <LoadingState shape={skeleton} />
  } else if (isEmpty) {
    body = <EmptyBody empty={empty} scope={scope} fallbackTitle={emptyDefault} />
  } else {
    body = children
  }

  return (
    <Prim.Col gap="$3" width="100%">
      {heading.present || actions ? (
        <Prim.Row justifyContent="space-between" alignItems="center" gap="$3" flexWrap="wrap">
          {heading.present ? (
            <Prim.Text fontSize="$xl" fontWeight="$semibold" letterSpacing="$tight" color="$foreground">
              {stringify(heading.value)}
            </Prim.Text>
          ) : (
            <Prim.Box />
          )}
          {actions}
        </Prim.Row>
      ) : null}
      {body}
    </Prim.Col>
  )
}

/** A section's `empty:` — a sentence, an object, or the default that always exists. */
function EmptyBody({
  empty,
  scope,
  fallbackTitle,
}: {
  empty?: Value | EmptyState
  scope: Scope
  fallbackTitle?: string
}) {
  if (typeof empty === 'string') {
    return <EmptySlot state={{ title: empty }} scope={scope} />
  }
  if (empty && typeof empty === 'object') {
    return <EmptySlot state={empty as never} scope={scope} />
  }
  return <EmptySlot state={{ title: fallbackTitle ?? 'Nothing here yet' }} scope={scope} />
}

/** A section heading derived from an endpoint name, for a section that authored none. */
export function titleFromEndpoint(name: string | undefined): string | undefined {
  if (!name) return undefined
  return humanize(name.replace(/^(list|get|fetch|all|find|search)/, '')) || undefined
}

/** Everything a slot needs when a section renders one row. */
export function slotOrDerived(item: Slot | undefined, sample: unknown): Slot {
  return item ?? deriveItem(sample)
}
