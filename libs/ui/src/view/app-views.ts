/**
 * The `GET /api/apps/:id/views` payload + the pure route lookups a *host* needs to render a whole
 * app from it.
 *
 * There are two hosts that render a project's app from specs, and neither can use the browser URL as
 * its router: `apps/mobile` (React Native, no URL) and the `/chat` in-process app pane
 * (`libs/ui/src/chat/app/AppInline.tsx`, which must not fight TanStack Router). Both hold the current
 * page as state and match a concrete path back to the spec that owns it — so that matching lives
 * here, pure and renderer-free, shared by both. The web `apps/app-shell` bundle keeps its own
 * History-based router; it does not need these.
 *
 * This is transport + lookups only — no React, no `Prim.*`. The screen that owns the state and the
 * chrome is the host's.
 */

import type { ShellSpec, ViewComponentSpec, ViewLayoutSpec, ViewSpec } from './types'
import type { EndpointManifest } from './client'

/** The `GET /api/apps/:id/views` body — everything the renderer needs, in one round trip. */
export interface AppViews {
  project: string
  views: ViewSpec[]
  layouts: ViewLayoutSpec[]
  components: ViewComponentSpec[]
  shell: ShellSpec | null
  /** The transport twin of `window.__APP_ENDPOINTS__`, straight into `createViewClient`. */
  endpoints: EndpointManifest
}

/** Coerce an untyped `GET /api/apps/:id/views` body into a well-formed {@link AppViews}. */
export function normalizeAppViews(body: Partial<AppViews> | null | undefined, projectId: string): AppViews {
  return {
    project: typeof body?.project === 'string' ? body.project : projectId,
    views: Array.isArray(body?.views) ? body!.views : [],
    layouts: Array.isArray(body?.layouts) ? body!.layouts : [],
    components: Array.isArray(body?.components) ? body!.components : [],
    shell: body?.shell ?? null,
    endpoints: body?.endpoints ?? {},
  }
}

/** A resolved page: which spec is on screen, and what its `[param]`s are bound to. */
export interface ResolvedRoute {
  spec: ViewSpec
  params: Record<string, string>
}

/**
 * Resolve a CONCRETE path (`trips/abc/expenses`) against the specs, whose routes are PATTERNS
 * (`trips/[tripId]/expenses`).
 *
 * `ViewNavigation.navigate` hands the host a route "with its `[param]`s already filled" — a literal
 * path with the parameter NAMES gone — so the host matches segment by segment and hands the values
 * back as `params`, which is what `$route.tripId` reads. A static segment always beats a parameter
 * (`recipes/new` is the new-recipe page, not recipe "new"), so exact matches win and the rest are
 * ordered by how few parameters they use.
 */
export function resolveRoute(views: readonly ViewSpec[], path: string): ResolvedRoute | null {
  const exact = views.find((v) => v.route === path)
  if (exact) return { spec: exact, params: {} }

  const segments = path.split('/')
  let best: ResolvedRoute | null = null
  let bestParams = Infinity
  for (const spec of views) {
    const pattern = spec.route.split('/')
    if (pattern.length !== segments.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i]!
      const s = segments[i]!
      const dynamic = /^\[([A-Za-z][A-Za-z0-9]*)\]$/.exec(p)
      if (dynamic) params[dynamic[1]!] = s
      else if (p !== s) {
        ok = false
        break
      }
    }
    const count = Object.keys(params).length
    if (ok && count < bestParams) {
      best = { spec, params }
      bestParams = count
    }
  }
  return best
}

/**
 * The SERVED route pattern of an authoring route — `index` collapses to `/`, a `[param]` segment
 * becomes `:param` (`recipes/[id]` → `/recipes/:id`).
 *
 * Mirrors `viewRoutePath` in `sdk/org/libs/cli/src/app/view-spec/files.ts`, the pod's single source
 * of truth for that mapping and the grammar the sidebar manifest (`GET /api/projects/:id/app`)
 * speaks. A host holding AUTHORING routes translates each view to its served pattern to match a
 * served path a sidebar row names.
 */
export function servedRoutePath(route: string): string {
  const segs = route.split('/').filter((s) => s.length > 0)
  if (segs[segs.length - 1] === 'index') segs.pop()
  return '/' + segs.map((s) => s.replace(/^\[(.+)\]$/, ':$1')).join('/')
}

/**
 * The AUTHORING route whose SERVED pattern equals `servedPath`, or `null` when no view owns it (a
 * stale manifest, a legacy page — the caller falls back to the app's landing page).
 */
export function routeForServedPath(views: readonly ViewSpec[], servedPath: string): string | null {
  const match = views.find((v) => servedRoutePath(v.route) === servedPath)
  return match ? match.route : null
}

/**
 * The page a freshly opened app lands on: the shell's first declared destination if it names one,
 * else `index`, else the first spec — an app with no `index` and no shell is still openable rather
 * than blank. Every candidate is a STATIC route, so no params come out of this.
 */
export function initialRoute(views: readonly ViewSpec[], shell: ShellSpec | null): string | null {
  const declared = shell?.nav?.[0]?.route ?? shell?.groups?.[0]?.home
  if (declared && views.some((v) => v.route === declared)) return declared
  if (views.some((v) => v.route === 'index')) return 'index'
  return views[0]?.route ?? null
}
