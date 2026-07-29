/**
 * Binding resolution — the whole of the spec language's evaluator.
 *
 * The language is deliberately not Turing-complete: a binding is a PATH and nothing else,
 * so this module is a walker, not an interpreter. There is no `eval`, no expression
 * parser and no template interpolation anywhere in the renderer — which is what makes
 * "no app-authored code ever executes on the phone" true by construction rather than by
 * review.
 *
 * The eight roots (schema S3) and no others:
 *
 * | root | scope member | where it comes from |
 * |---|---|---|
 * | `$` / `$.field`  | `self`   | the current list item, detail record or section Output |
 * | `$props.x`       | `props`  | a component reference's props (only inside a component) |
 * | `$route.id`      | `route`  | the route's `[param]` values |
 * | `$data.<id>.…`   | `data`   | another SECTION's Output — this is a dependent query |
 * | `$result.field`  | `result` | the Output of the mutation that just succeeded |
 * | `$form.field`    | `form`   | the current form's values (under `create.prefill.input`) |
 * | `$client.timezone` | —      | the client's IANA zone |
 *
 * ## The two results that are not the same thing
 *
 * {@link resolveValue} answers "what does this slot hold?" and distinguishes THREE
 * outcomes, because the renderer's S1 rule depends on the distinction:
 *
 *  - a **literal** — always present, renders as written;
 *  - a **resolved binding** — renders its value;
 *  - an **unresolved binding** — `null`/`undefined`/`''`. Its element renders NOTHING,
 *    label and wrapper included. This is what replaces the ~15 hand-written
 *    `{x ? … : null}` guards T0 found across ten pages, and it is the only reason the
 *    no-conditionals rule stays honest.
 *
 * An unresolved binding in a QUERY INPUT means something stronger still: the dependent
 * query is DISABLED, not sent with `undefined` (see {@link resolveInputs}). That replaces
 * the hand-coded `enabled:` flag the corpus writes everywhere.
 */

import type { Binding, Value } from './types'

/** One path segment: an identifier plus an optional numeric index (`items[0]`). */
const SEGMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)((?:\[[0-9]+\])*)$/

/**
 * The roots that take a dotted path after them. Declared as a tuple so the union below is
 * derived from it — the switch in {@link resolveBinding} is then exhaustive by construction.
 */
export const PATH_ROOTS = ['props', 'route', 'data', 'result', 'form'] as const
type PathRoot = (typeof PATH_ROOTS)[number]

/**
 * Everything a binding can be evaluated against.
 *
 * `self` is the CURRENT scope: a page's sections see their own Output, a list row sees
 * that row, a component's node sees whatever the reference was rendered against. Nothing
 * in the language creates a scope except a repeater (`table.rows`, `timeline.items`, a
 * collection section's rows) — stated once, relied on everywhere.
 */
export interface Scope {
  /** `$` and `$.field`. */
  self?: unknown
  /** `$props.x` — only non-empty inside a component definition's node. */
  props?: Record<string, unknown>
  /** `$route.id` — the route's `[param]` values. */
  route?: Record<string, unknown>
  /** `$data.<sectionId>.…` — every section's Output on this page. */
  data?: Record<string, unknown>
  /** `$result.field` — valid only under an `onSuccess`. */
  result?: unknown
  /** `$form.field` — valid only under `create.prefill.input`. */
  form?: Record<string, unknown>
  /** `$client.timezone` — the only `$client` path. */
  timezone?: string
}

/** An empty scope. Handy for a literal-only render and as a test fixture. */
export const EMPTY_SCOPE: Scope = {}

/** Derive a child scope for a repeater entry, carrying every other root through. */
export function itemScope(scope: Scope, item: unknown): Scope {
  return { ...scope, self: item }
}

/** True when `s` is a binding path rather than a literal. */
export function isBinding(s: unknown): s is Binding {
  return typeof s === 'string' && s.startsWith('$')
}

/** Walk one segment of a path off `value`, honouring `name[0]` index suffixes. */
function step(value: unknown, segment: string): unknown {
  const m = SEGMENT_RE.exec(segment)
  if (!m) return undefined
  let out: unknown = read(value, m[1])
  const indices = m[2]
  if (indices) {
    for (const idx of indices.slice(1, -1).split('][')) {
      out = Array.isArray(out) ? out[Number(idx)] : undefined
    }
  }
  return out
}

function read(value: unknown, key: string): unknown {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[key]
}

/** Walk a dotted path (`a.b[0].c`) off a root value. */
function walk(root: unknown, path: string): unknown {
  if (path === '') return root
  let out = root
  for (const segment of path.split('.')) {
    if (out === null || out === undefined) return undefined
    out = step(out, segment)
  }
  return out
}

/**
 * Resolve a binding path against a scope. Returns `undefined` for anything unreachable —
 * a missing root, a missing field, a path off a null. The renderer treats that as S1's
 * "omit the element", so a wrong path is a blank, never a crash.
 */
export function resolveBinding(binding: Binding, scope: Scope): unknown {
  if (binding === '$') return scope.self
  if (binding === '$client.timezone') return scope.timezone ?? clientTimezone()
  if (!binding.startsWith('$')) return undefined

  const body = binding.slice(1)
  // `$.field` — the current scope. The dot is the discriminator: `$.a` is self, `$props.a`
  // is a named root, and there is nothing in between.
  if (body.startsWith('.')) return walk(scope.self, body.slice(1))

  const dot = body.indexOf('.')
  if (dot < 0) return undefined
  const root = body.slice(0, dot) as PathRoot
  const rest = body.slice(dot + 1)
  switch (root) {
    case 'props':
      return walk(scope.props, rest)
    case 'route':
      return walk(scope.route, rest)
    case 'data':
      return walk(scope.data, rest)
    case 'result':
      return walk(scope.result, rest)
    case 'form':
      return walk(scope.form, rest)
    default:
      return undefined
  }
}

/**
 * The client's IANA timezone, or `'UTC'` where the platform has no Intl.
 *
 * `$client.timezone` exists so a date-dependent selection ("tonight's meal") is computed
 * SERVER-side from a param, rather than in a client expression the language does not have.
 */
export function clientTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** The three outcomes a slot value can have. See the module header. */
export interface Resolved {
  /** `false` when a BINDING resolved to nothing — the element must be omitted (S1). */
  present: boolean
  /** The value, when present. A literal resolves to itself. */
  value: unknown
}

const ABSENT: Resolved = { present: false, value: undefined }

/** True when a resolved value counts as "nothing" for S1's purposes. */
function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

/**
 * Resolve a {@link Value} — a literal or a binding — against a scope.
 *
 * A literal is always `present` (even `''`, which an author wrote on purpose). A binding
 * is present only when it resolves to something. That asymmetry IS rule S1.
 */
export function resolveValue(value: Value | undefined, scope: Scope): Resolved {
  if (value === undefined) return ABSENT
  if (!isBinding(value)) return { present: true, value }
  const out = resolveBinding(value, scope)
  return isEmpty(out) ? ABSENT : { present: true, value: out }
}

/** {@link resolveValue}, flattened to `undefined` when absent. */
export function resolveOptional(value: Value | undefined, scope: Scope): unknown {
  const r = resolveValue(value, scope)
  return r.present ? r.value : undefined
}

/** An array-valued binding, resolved to an array (`[]` when unreachable). */
export function resolveArray(binding: Binding | undefined, scope: Scope): unknown[] {
  if (binding === undefined) return []
  const out = isBinding(binding) ? resolveBinding(binding, scope) : undefined
  return Array.isArray(out) ? out : []
}

/**
 * Resolve a query's `input` map.
 *
 * **An unresolved binding disables the query.** That is the point: a section whose input
 * is `{ id: '$data.currentPlan.plan.id' }` must not fire a request with `id: undefined`
 * the moment before the plan arrives — it must not fire at all. The renderer reads
 * `ready` and skips the fetch, which is the declarative replacement for every hand-coded
 * `enabled:` flag in the corpus.
 */
export function resolveInputs(
  input: Record<string, Binding> | undefined,
  scope: Scope,
): { ready: boolean; values: Record<string, unknown> } {
  const values: Record<string, unknown> = {}
  if (!input) return { ready: true, values }
  for (const [key, binding] of Object.entries(input)) {
    const r = resolveValue(binding, scope)
    // A literal in an input map is legal and always ready; only a BINDING can be pending.
    if (!r.present) return { ready: false, values }
    values[key] = r.value
  }
  return { ready: true, values }
}

/**
 * The last segment of a binding path — the default `arg` name for a `field` element.
 *
 * `'$.completed'` ⇒ `'completed'`. Stated here rather than at the call site because the
 * same rule governs `FieldEl.arg`'s default and the schema-form's key derivation.
 */
export function lastSegment(binding: Binding): string {
  const parts = binding.replace(/\[[0-9]+\]/g, '').split('.')
  return parts[parts.length - 1] ?? binding
}

/**
 * Fill a route's `[param]` placeholders from a params map, for a `navigate`/`link`.
 *
 * `'searches/[searchId]/inbox'` + `{ searchId: 'abc' }` ⇒ `'searches/abc/inbox'`. A
 * placeholder with no value is left standing rather than replaced with `undefined`, so a
 * broken link is visible instead of silently pointing at `/searches/undefined/inbox`.
 */
export function fillRoute(route: string, params: Record<string, unknown>): string {
  return route.replace(/\[([A-Za-z][A-Za-z0-9]*)\]/g, (whole, name: string) => {
    const v = params[name]
    return v === undefined || v === null ? whole : encodeURIComponent(String(v))
  })
}

/** Every `[param]` name in a route, in order. */
export function routeParams(route: string): string[] {
  return [...route.matchAll(/\[([A-Za-z][A-Za-z0-9]*)\]/g)].map((m) => m[1])
}

/**
 * Does any row (or the record itself) satisfy a `poll.while` policy?
 *
 * Membership in a finite value set, evaluated per row and true if ANY row matches — the
 * measured shape (`homes/inbox` polls while any capture is `pending`). A predicate would
 * have been an expression; this is a lookup.
 */
export function pollWhileHolds(
  policy: { field: Binding; in: (string | number | boolean)[] } | undefined,
  rows: unknown[],
): boolean {
  if (!policy) return true
  const wanted = new Set<unknown>(policy.in)
  return rows.some((row) => wanted.has(resolveBinding(policy.field, { self: row }) as never))
}
