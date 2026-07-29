/**
 * The renderer's data + page runtime — everything `useApi` used to be, plus the things a
 * spec page needs that a hand-written page used `useState` for.
 *
 * The generated pages this replaces hand-wrote all of the following, once per page:
 * fetch-on-mount, refetch-on-param-change, an `enabled:` flag for every dependent query,
 * a cache-invalidation call after every mutation, a `setInterval` for every
 * agent-in-progress surface, and a `useState` for every disclosure. All of it is here,
 * once.
 *
 * ## What lives where, and why it is not module-global
 *
 * `@app/runtime`'s invalidation registry is a module-level `Map`. That is fine for a page
 * bundle that mounts one app, and wrong here: the mobile host renders a spec, navigates,
 * and renders another, and a shell can hold two `ViewRenderer`s (the page and the
 * assistant dock). So the registry, the `$data` store and the reveal set all live in ONE
 * provider instance, created per `ViewRenderer`.
 *
 * ## The five behaviours worth naming
 *
 *  - **last-write-wins stale-drop.** Every fetch takes a request id; a response that is
 *    not the latest is dropped. Rapid facet changes cannot flip `data` back.
 *  - **an unresolved input disables the query.** Not "sends undefined" — does not fire.
 *    This is `resolveInputs().ready` and it replaces every hand-coded `enabled:`.
 *  - **invalidation is keyed by endpoint NAME**, which is the only identifier a spec has.
 *  - **`poll` is a named policy**, not a predicate: refetch every `everyMs` while
 *    `while.field` holds one of `while.in`, evaluated per row and true if ANY row matches.
 *  - **`$data.<sectionId>` is published, not lifted.** A section writes its Output into a
 *    shared store keyed by its id; a dependent section reads it as an ordinary binding.
 *    That is the whole of the query DAG — no topological sort, because React's render
 *    already is one.
 */

import * as React from 'react'
import type { Poll } from './types'
import type { ViewClient } from './client'
import { ViewHttpError } from './client'
import { pollWhileHolds } from './bind'
import type { ViewComponentSpec } from './types'

// ── the page runtime context ─────────────────────────────────────────────────

/** Everything a section or element may reach that is not its own props. */
export interface ViewRuntime {
  client: ViewClient
  /** Component definitions a `{ use: … }` reference resolves against. */
  components: Record<string, ViewComponentSpec>
  /** The current route's `[param]` values. */
  routeParams: Record<string, string>
  /** The current authoring route, for a subnav's prefix match. */
  routePath: string
  /** Every section's Output so far — the `$data.<sectionId>` namespace. */
  data: Record<string, unknown>
  /** Publish a section's Output under its id. */
  publish: (id: string, value: unknown) => void
  /** Section ids currently revealed. */
  revealed: ReadonlySet<string>
  /** Ids that are the TARGET of some `reveals`, and so start hidden. */
  revealTargets: ReadonlySet<string>
  toggleReveal: (ids: string[]) => void
  /** Register a refetcher under an endpoint name; returns an unregister. */
  register: (name: string, refetch: () => void) => () => void
  /** Refetch every live query for these endpoint names. */
  invalidate: (names: string[]) => void
}

const RuntimeContext = React.createContext<ViewRuntime | null>(null)

/** The page runtime. Throws when a view element is rendered outside a `ViewRenderer`. */
export function useViewRuntime(): ViewRuntime {
  const ctx = React.useContext(RuntimeContext)
  if (!ctx) throw new Error('view: rendered outside a <ViewRenderer>')
  return ctx
}

export interface ViewRuntimeProviderProps {
  client: ViewClient
  components?: Record<string, ViewComponentSpec>
  routeParams?: Record<string, string>
  routePath?: string
  /** Ids named by any `reveals` on the page — computed once by the renderer. */
  revealTargets?: ReadonlySet<string>
  children: React.ReactNode
}

const NO_TARGETS: ReadonlySet<string> = new Set<string>()

export function ViewRuntimeProvider({
  client,
  components,
  routeParams,
  routePath,
  revealTargets,
  children,
}: ViewRuntimeProviderProps): React.ReactElement {
  const [data, setData] = React.useState<Record<string, unknown>>({})
  const [revealed, setRevealed] = React.useState<ReadonlySet<string>>(() => new Set<string>())
  // A ref, not state: registering a refetcher must never re-render the page.
  const registry = React.useRef(new Map<string, Set<() => void>>())

  const publish = React.useCallback((id: string, value: unknown) => {
    setData((prev) => (prev[id] === value ? prev : { ...prev, [id]: value }))
  }, [])

  const toggleReveal = React.useCallback((ids: string[]) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      // All-or-nothing per press: a toolbar entry naming three sections shows all three,
      // and pressing it again hides all three. Per-id toggling made a second press leave
      // a partially-open page in the desk-checked layouts.
      const anyHidden = ids.some((id) => !next.has(id))
      for (const id of ids) {
        if (anyHidden) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])

  const register = React.useCallback((name: string, refetch: () => void) => {
    let set = registry.current.get(name)
    if (!set) {
      set = new Set()
      registry.current.set(name, set)
    }
    set.add(refetch)
    return () => {
      const s = registry.current.get(name)
      s?.delete(refetch)
      if (s && s.size === 0) registry.current.delete(name)
    }
  }, [])

  const invalidate = React.useCallback((names: string[]) => {
    for (const name of names) {
      const set = registry.current.get(name)
      if (set) for (const refetch of [...set]) refetch()
    }
  }, [])

  const value = React.useMemo<ViewRuntime>(
    () => ({
      client,
      components: components ?? {},
      routeParams: routeParams ?? {},
      routePath: routePath ?? '',
      data,
      publish,
      revealed,
      revealTargets: revealTargets ?? NO_TARGETS,
      toggleReveal,
      register,
      invalidate,
    }),
    [client, components, routeParams, routePath, data, publish, revealed, revealTargets, toggleReveal, register, invalidate],
  )

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
}

// ── queries ──────────────────────────────────────────────────────────────────

/** The state one query exposes to its section. */
export interface QueryState<T = unknown> {
  data: T | undefined
  error: ViewHttpError | undefined
  /** True while the FIRST load is in flight. A poll refresh does not flip it. */
  isLoading: boolean
  /** True while any request is in flight, including a poll refresh. */
  isFetching: boolean
  /** False when an input binding is unresolved — the query is deliberately not firing. */
  enabled: boolean
  refetch: () => void
}

export interface UseViewQueryArgs {
  /** Endpoint name. `undefined` ⇒ no request (a `from`-sourced section). */
  name?: string
  input?: Record<string, unknown>
  /** `false` disables the query — an unresolved dependent binding, a hidden section. */
  enabled?: boolean
  poll?: Poll
  /** Rows to evaluate `poll.while` against. Defaults to the query's own Output. */
  pollRows?: unknown[]
}

const IDLE: QueryState = {
  data: undefined,
  error: undefined,
  isLoading: false,
  isFetching: false,
  enabled: false,
  refetch: () => {},
}

/**
 * Fetch an endpoint by name, with the whole lifecycle the spec replaces.
 *
 * Refetches when `[name, input]` changes (compared by serialised value, so a fresh object
 * literal on every render does not re-fire). Registers under `name` for invalidation.
 * Polls while the policy holds.
 */
export function useViewQuery<T = unknown>(args: UseViewQueryArgs): QueryState<T> {
  const { client, register } = useViewRuntime()
  const { name, poll } = args
  const enabled = (args.enabled ?? true) && !!name
  const key = React.useMemo(() => JSON.stringify(args.input ?? {}), [args.input])

  const [state, setState] = React.useState<{
    data: T | undefined
    error: ViewHttpError | undefined
    loaded: boolean
    fetching: boolean
  }>({ data: undefined, error: undefined, loaded: false, fetching: false })

  const reqId = React.useRef(0)
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = React.useCallback(() => {
    if (!enabled || !name) return
    const id = ++reqId.current
    setState((s) => ({ ...s, fetching: true, error: undefined }))
    client.call(name, JSON.parse(key) as Record<string, unknown>).then(
      (result) => {
        // Last-write-wins: a response that is not the latest request is DROPPED, not
        // merged. Without this a slow first fetch lands after a fast second one and the
        // section flips back to stale rows.
        if (id !== reqId.current || !mounted.current) return
        setState({ data: result as T, error: undefined, loaded: true, fetching: false })
      },
      (err: unknown) => {
        if (id !== reqId.current || !mounted.current) return
        setState({
          data: undefined,
          error: err instanceof ViewHttpError ? err : new ViewHttpError(500, String(err)),
          loaded: true,
          fetching: false,
        })
      },
    )
  }, [client, name, key, enabled])

  React.useEffect(() => {
    if (!enabled) {
      // A query that becomes disabled (its dependency vanished) must stop claiming to be
      // loading, or its section shows a skeleton forever.
      setState((s) => (s.fetching ? { ...s, fetching: false } : s))
      return
    }
    run()
  }, [run, enabled])

  React.useEffect(() => {
    if (!enabled || !name) return
    return register(name, run)
  }, [register, name, run, enabled])

  // ── poll ───────────────────────────────────────────────────────────────────
  const rowsForPoll = args.pollRows ?? (Array.isArray(state.data) ? state.data : state.data ? [state.data] : [])
  const shouldPoll = !!poll && enabled && pollWhileHolds(poll.while, rowsForPoll)
  const everyMs = poll?.everyMs ?? 0
  React.useEffect(() => {
    if (!shouldPoll || everyMs <= 0) return
    const handle = setInterval(run, everyMs)
    return () => clearInterval(handle)
  }, [shouldPoll, everyMs, run])

  if (!name) return IDLE as QueryState<T>

  return {
    data: state.data,
    error: state.error,
    isLoading: enabled && !state.loaded,
    isFetching: state.fetching,
    enabled,
    refetch: run,
  }
}

// ── mutations ────────────────────────────────────────────────────────────────

/** The handle a mutating control holds. */
export interface MutationState {
  run: (input?: Record<string, unknown>) => Promise<unknown>
  isPending: boolean
  error: ViewHttpError | undefined
}

/**
 * Call a mutation endpoint and invalidate what it says it invalidates.
 *
 * `invalidates` is always widened with the mutation's OWN name, because a section reading
 * an endpoint that is also written to (a toggle, per schema S5) would otherwise never see
 * its own write.
 */
export function useViewMutation(name: string, invalidates?: string[]): MutationState {
  const { client, invalidate } = useViewRuntime()
  const [isPending, setPending] = React.useState(false)
  const [error, setError] = React.useState<ViewHttpError | undefined>(undefined)
  const listRef = React.useRef<string[]>([])
  listRef.current = invalidates ?? []

  const run = React.useCallback(
    async (input: Record<string, unknown> = {}) => {
      setPending(true)
      setError(undefined)
      try {
        const result = await client.call(name, input)
        invalidate([name, ...listRef.current])
        return result
      } catch (err) {
        const e = err instanceof ViewHttpError ? err : new ViewHttpError(500, String(err))
        setError(e)
        throw e
      } finally {
        setPending(false)
      }
    },
    [client, invalidate, name],
  )

  return { run, isPending, error }
}

// ── `$data` publication ──────────────────────────────────────────────────────

/**
 * Publish a section's Output under its id so `$data.<id>.…` resolves elsewhere.
 *
 * A no-op without an id: a section that nothing depends on need not declare one, and the
 * schema keeps `id` optional for exactly that reason.
 */
export function usePublish(id: string | undefined, value: unknown): void {
  const { publish } = useViewRuntime()
  React.useEffect(() => {
    if (id) publish(id, value)
  }, [publish, id, value])
}

// ── selection (a list's multi-select) ────────────────────────────────────────

/** The multi-selection a `selectable` list holds, and its bulk-action commit surface. */
export interface Selection {
  ids: string[]
  has: (id: string) => boolean
  toggle: (id: string) => void
  clear: () => void
  count: number
}

export function useSelection(): Selection {
  const [ids, setIds] = React.useState<string[]>([])
  const toggle = React.useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])
  const clear = React.useCallback(() => setIds([]), [])
  return React.useMemo(
    () => ({ ids, has: (id: string) => ids.includes(id), toggle, clear, count: ids.length }),
    [ids, toggle, clear],
  )
}
