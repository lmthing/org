/**
 * Which of the two kinds of app is this, and what does the native one need?
 *
 * There are two app builders and they produce different things. `system-appbuilder`
 * produces an esbuild browser bundle — WebView-bound forever, and the default.
 * `system-appbuilder` produces **specs**: data, which this app fetches and renders
 * with the same `ViewRenderer` the web bundle uses. That is the one capability the
 * spec pipeline exists to deliver, so the branch has to be total — a viewbuilder app
 * never touches a WebView on any page.
 *
 * The pod answers `GET /api/apps/:id/views`
 * (`sdk/org/libs/cli/src/server/routes/app-views.ts`) and the discriminator is simply
 * whether it returned any: **`views.length > 0` ⇒ native**. There is no flag on the
 * project to consult, and that is deliberate — the thing the native path needs and
 * the thing that decides the branch are the same fetch.
 *
 * The payload carries the endpoint manifest as well as the specs, because on web
 * that manifest is injected into the host page; here there is no host page to
 * inject anything into. Layouts travel with the same payload so both hosts compose
 * the same nested frame around a matching route.
 *
 * Not a screen and not React: `AppScreen` owns the state and the chrome. This module
 * is the transport plus the two pure route lookups the host needs, so both can be
 * tested without a renderer.
 */

import type { EndpointManifest, ShellSpec, ViewComponentSpec, ViewLayoutSpec, ViewSpec } from '@lmthing/ui/view'

/** The `GET /api/apps/:id/views` body — everything the renderer needs, in one round trip. */
export interface AppViews {
  project: string
  views: ViewSpec[]
  layouts: ViewLayoutSpec[]
  components: ViewComponentSpec[]
  shell: ShellSpec | null
  /** The native twin of `window.__APP_ENDPOINTS__`, straight into `createViewClient`. */
  endpoints: EndpointManifest
}

/** How this project is opened. `webview` is the appbuilder path and the default. */
export type AppTarget = { kind: 'native'; app: AppViews } | { kind: 'webview' }

/** The webview outcome, allocated once — the branch compares by `kind`, never by identity. */
const WEBVIEW: AppTarget = { kind: 'webview' }

/**
 * Ask the pod how to open `projectId`.
 *
 * **Every failure resolves to `webview`, deliberately.** A pod that predates this
 * route, an offline moment, a 500 — none of those are evidence that the project is a
 * spec app, and the appbuilder path is the one that works for every app built so far.
 * Failing closed here would break opening the default kind of app; failing open costs
 * a viewbuilder app one WebView render of pages that do render in a WebView (their
 * wrapper bundle is built too). The branch that must never be partial is the one
 * INSIDE a known viewbuilder app, and that one is decided by this single answer.
 */
export async function fetchAppTarget(
  baseUrl: string,
  getToken: () => Promise<string>,
  projectId: string,
): Promise<AppTarget> {
  try {
    const token = await getToken()
    const res = await fetch(`${baseUrl}/api/apps/${encodeURIComponent(projectId)}/views`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) return WEBVIEW
    const body = (await res.json()) as Partial<AppViews>
    const views = Array.isArray(body.views) ? body.views : []
    if (views.length === 0) return WEBVIEW
    return {
      kind: 'native',
      app: {
        project: typeof body.project === 'string' ? body.project : projectId,
        views,
        layouts: Array.isArray(body.layouts) ? body.layouts : [],
        components: Array.isArray(body.components) ? body.components : [],
        shell: body.shell ?? null,
        endpoints: body.endpoints ?? {},
      },
    }
  } catch {
    return WEBVIEW
  }
}

/** A resolved page: which spec is on screen, and what its `[param]`s are bound to. */
export interface ResolvedRoute {
  spec: ViewSpec
  params: Record<string, string>
}

/**
 * Resolve a CONCRETE path (`trips/abc/expenses`) against the specs, whose routes are
 * PATTERNS (`trips/[tripId]/expenses`).
 *
 * The two grammars have to meet somewhere, and the client's contract puts it here:
 * `ViewNavigation.navigate` hands the host a route "with its `[param]`s already
 * filled", because filling them from `$result.id` is binding resolution and that is
 * the renderer's job. What comes back is therefore a literal path with the parameter
 * NAMES gone — so the host matches segment by segment and hands the values back as
 * `params`, which is what `$route.tripId` reads.
 *
 * A static segment always beats a parameter (`recipes/new` is the new-recipe page, not
 * recipe number "new"), so exact matches are taken first and the remaining candidates
 * are ordered by how few parameters they use.
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
 * This mirrors `viewRoutePath` in `sdk/org/libs/cli/src/app/view-spec/files.ts`, which is the pod's
 * single source of truth for that mapping and the grammar the chat sidebar's manifest
 * (`GET /api/projects/:id/app`) speaks. The native path holds the AUTHORING routes (`ViewSpec.route`,
 * from `GET /api/apps/:id/views`), so to open the page a sidebar row names we translate each view to
 * its served pattern and match. Kept tiny and pure so `app-views.test.ts` can pin it against the
 * server's mapping without a pod.
 */
export function servedRoutePath(route: string): string {
  const segs = route.split('/').filter((s) => s.length > 0)
  if (segs[segs.length - 1] === 'index') segs.pop()
  return '/' + segs.map((s) => s.replace(/^\[(.+)\]$/, ':$1')).join('/')
}

/**
 * The AUTHORING route whose SERVED pattern equals `servedPath`, or `null` when no view owns it.
 *
 * The chat sidebar hands the host a served path (`/`, `/recipes`, `/settings/profile` — always
 * static, since it drops the dynamic ones). The host's route state is an authoring path, so this is
 * the one translation between the two grammars. A `null` means the tapped page is not in THIS app's
 * specs (a stale manifest, a legacy page), and the caller falls back to the app's landing page.
 */
export function routeForServedPath(views: readonly ViewSpec[], servedPath: string): string | null {
  const match = views.find((v) => servedRoutePath(v.route) === servedPath)
  return match ? match.route : null
}

/**
 * The page a freshly opened app lands on.
 *
 * The shell's first destination if it declares one (the model said what the app is
 * FOR), else `index`, else the first spec — an app with no `index` and no shell is
 * still openable rather than blank. Every candidate is a STATIC route (a nav target
 * cannot be parameterised, and `index` is not), so no params come out of this.
 */
export function initialRoute(views: readonly ViewSpec[], shell: ShellSpec | null): string | null {
  const declared = shell?.nav?.[0]?.route ?? shell?.groups?.[0]?.home
  if (declared && views.some((v) => v.route === declared)) return declared
  if (views.some((v) => v.route === 'index')) return 'index'
  return views[0]?.route ?? null
}
