/**
 * `ViewRenderer` — the whole of a spec page, on both targets.
 *
 * ```tsx
 * import { ViewRenderer, createViewClient } from '@lmthing/ui/view'
 *
 * <ViewRenderer spec={spec} components={components} shell={shell} client={client} />
 * ```
 *
 * That call is identical in the generated web wrapper page and in the mobile app's native
 * screen, which is the point: a spec is DATA, so the phone fetches it and renders it with
 * the same renderer the web bundles — **no WebView anywhere**. This is the one thing no
 * amount of improvement to a TSX-authoring builder can produce, because its output is an
 * esbuild browser bundle.
 *
 * ## What the renderer decides, so the model does not have to
 *
 * | decision | rule |
 * |---|---|
 * | page archetype | predicted from the section composition (`archetype.ts`), never reordering |
 * | shell navigation | derived from the route list up to 5 top-level static routes (`shell.tsx`) |
 * | responsive collapse | inside the archetype, via media breakpoints the model never writes |
 * | loading / empty / error | renderer defaults, not authorable (`states.tsx`) |
 * | a row's shape when `item` is absent | derived from the data (`sections/common.tsx`) |
 * | which sections start hidden | every id named by a `reveals` anywhere on the page |
 *
 * ## Route parameters
 *
 * `$route.id` comes from `route.params`. Pass the prop when the host router owns them (a
 * web wrapper page calling `useParams()`, a native screen holding its own nav state); the
 * client's own `routePath` is used for the shell's active-destination match. Both are
 * optional — a page with no `[param]` needs neither.
 */

import * as React from 'react'
import * as Prim from '../elements/primitives/index'
import type { SectionSpec, ShellSpec, ViewComponentSpec, ViewSpec, Route } from './types'
import type { ViewClient } from './client'
import type { Scope } from './bind'
import { ARCHETYPE_WIDTH, isGridCell, predictArchetype, revealTargetsOf } from './archetype'
import { ViewRuntimeProvider, useViewRuntime } from './runtime'
import { SectionView } from './sections'
import { ViewShell } from './shell'
import { ViewIcon } from './icons'
import { ErrorState } from './states'

/** Where the current page sits, when the host router owns that fact. */
export interface ViewRoute {
  /** The authoring route being displayed (`trips/[tripId]/expenses` filled in). */
  path?: string
  /** The `[param]` values — what `$route.*` resolves against. */
  params?: Record<string, string>
}

export interface ViewRendererProps {
  /** The page spec. */
  spec: ViewSpec
  /** Component definitions a `{ use: … }` reference resolves against. */
  components?: ViewComponentSpec[] | Record<string, ViewComponentSpec>
  /** The app shell. Omitted ⇒ the page renders bare (a nested or embedded render). */
  shell?: ShellSpec
  /** The data client — `createViewClient({ baseUrl, getToken, endpoints })`. */
  client: ViewClient
  /** Every route the app has, for shell derivation. Defaults to the page's own route. */
  routes?: Route[]
  /** The current route, when the host router owns it. */
  route?: ViewRoute
}

function toComponentMap(
  components: ViewComponentSpec[] | Record<string, ViewComponentSpec> | undefined,
): Record<string, ViewComponentSpec> {
  if (!components) return {}
  if (Array.isArray(components)) {
    const out: Record<string, ViewComponentSpec> = {}
    for (const def of components) out[def.name] = def
    return out
  }
  return components
}

export function ViewRenderer({
  spec,
  components,
  shell,
  client,
  routes,
  route,
}: ViewRendererProps): React.ReactElement {
  const componentMap = React.useMemo(() => toComponentMap(components), [components])
  const revealTargets = React.useMemo(() => revealTargetsOf(spec), [spec])
  const params = route?.params ?? {}
  const routePath = route?.path ?? spec.route

  return (
    <ViewRuntimeProvider
      client={client}
      components={componentMap}
      routeParams={params}
      routePath={routePath}
      revealTargets={revealTargets}
    >
      {shell ? (
        <ViewShell shell={shell} routes={routes ?? [spec.route]}>
          <ViewPage spec={spec} />
        </ViewShell>
      ) : (
        <ViewPage spec={spec} />
      )}
    </ViewRuntimeProvider>
  )
}

/**
 * One page's sections, laid out by its archetype.
 *
 * The section ARRAY ORDER is preserved unconditionally. That is the schema's first hard
 * layout rule and it exists because the obvious alternative — hoisting the stats strip on
 * a dashboard — buries `kitchen/index`'s hero card, the single thing that page exists to
 * show. What the archetype governs is width, grid columns and responsive collapse.
 */
export function ViewPage({ spec }: { spec: ViewSpec }): React.ReactElement {
  const { revealTargets, revealed, data, routeParams, client } = useViewRuntime()
  const decision = React.useMemo(() => predictArchetype(spec), [spec])
  const maxWidth = ARCHETYPE_WIDTH[decision.archetype]

  /**
   * The PAGE scope — the roots every section starts from.
   *
   * `data` is the whole of the query DAG: each section publishes its Output under its id,
   * and a dependent section reads it as an ordinary `$data.<id>.…` binding. Rebuilding the
   * scope when `data` changes is what makes a dependent query fire the moment its input
   * arrives, and not before (its `resolveInputs` is `ready: false` until then). There is no
   * `self` here — a page has no record; only a section opens one.
   */
  const scope: Scope = React.useMemo(
    () => ({ data, route: routeParams, timezone: client.timezone }),
    [data, routeParams, client.timezone],
  )

  const visible = spec.sections.map((section, index) => ({ section, index }))
  const gridded = visible.filter(({ section }) => isGridCell(decision.archetype, section))
  const usesGrid = decision.archetype === 'dashboard' && gridded.length >= 2

  return (
    <Prim.Col
      gap="$6"
      padding="$4"
      $sm={{ padding: '$6' }}
      width="100%"
      maxWidth={maxWidth}
      alignSelf="center"
    >
      {spec.title ? (
        <Prim.Text fontSize="$2xl" fontWeight="$semibold" letterSpacing="$tight" color="$foreground">
          {spec.title}
        </Prim.Text>
      ) : null}

      {/*
        One pass over the sections in the model's order. The dashboard's grid is applied
        per section (a half-width cell from `$sm` up) rather than by regrouping, because
        regrouping would reorder — which is the one thing an archetype may never do.
      */}
      {visible.map(({ section, index }) => {
        const id = section.id
        // A section that something reveals starts hidden. A section nothing reveals is
        // always shown — which is why the target set is computed page-wide, not per
        // section.
        if (id && revealTargets.has(id) && !revealed.has(id)) return null

        const cell = usesGrid && isGridCell(decision.archetype, section)
        return (
          <Prim.Box
            key={id ?? `${section.kind}-${index}`}
            width="100%"
            {...(cell ? { $lg: { width: '48%' } } : {})}
          >
            <SectionBoundary section={section} scope={scope} />
          </Prim.Box>
        )
      })}
    </Prim.Col>
  )
}

/**
 * One section, isolated.
 *
 * A section that throws must not take the page with it. The rest of a dashboard is still
 * useful when one endpoint's Output is shaped differently than its bindings expect, and a
 * whole-page white screen is the failure mode a generated app can least afford — it looks
 * identical to "the builder produced nothing".
 */
class SectionBoundary extends React.Component<
  { section: SectionSpec; scope: Scope },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title={`This ${this.props.section.kind} section could not render`}
          message={this.state.error.message}
        />
      )
    }
    return <SectionView section={this.props.section} scope={this.props.scope} />
  }
}

/**
 * A stand-in for a route that has no spec — used by a host that navigates before the spec
 * arrives. Not part of the section vocabulary; it is chrome.
 */
export function ViewNotFound({ route }: { route?: string }): React.ReactElement {
  return (
    <Prim.Col gap="$2" alignItems="center" paddingVertical="$10">
      <ViewIcon name="search" size="lg" tone="neutral" />
      <Prim.Text fontWeight="$medium">No page here</Prim.Text>
      {route ? (
        <Prim.Text fontSize="$sm" color="$muted-foreground">
          {route}
        </Prim.Text>
      ) : null}
    </Prim.Col>
  )
}
