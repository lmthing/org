/**
 * The view-spec payload — `GET /api/apps/:id/views` — and the two pure helpers the host
 * needs around the fetch.
 *
 * Ported from `apps/mobile/src/app-views.ts` (`AppViews`, `fetchAppTarget`,
 * `initialRoute`), with one improvement and one intentional difference:
 *
 *  - **Improvement — `layouts`.** The pod payload
 *    (`libs/cli/src/server/routes/app-views.ts#AppViewsPayload`) carries `layouts`, so the
 *    native target can compose the same layout chain the web wrapper does. The mobile
 *    `AppViews` type dropped it and never passed it to `ViewRenderer`, so layout chains did
 *    not compose on native. AppHost keeps it and forwards it.
 *  - **Difference — no webview fallback.** The mobile host, on fetch failure or an empty
 *    `views[]`, resolves to `{ kind: 'webview' }` and loads the appbuilder bundle — a
 *    spec-vs-bundle discriminator that FAILS CLOSED to the default builder. AppHost IS the
 *    spec-app shell; there is nothing to fall back TO. So a failed fetch or an app with no
 *    views is a hard ERROR here, surfaced to the user, never a silent blank.
 */

import type {
  EndpointManifest,
  ShellSpec,
  ViewComponentSpec,
  ViewLayoutSpec,
  ViewSpec,
} from '@lmthing/ui/view'

/** The `GET /api/apps/:id/views` body — everything the renderer needs, in one round trip. */
export interface AppViews {
  project: string
  views: ViewSpec[]
  /** Nested layouts, so the renderer can compose the same chain the web wrapper does. */
  layouts: ViewLayoutSpec[]
  components: ViewComponentSpec[]
  shell: ShellSpec | null
  /** The endpoint manifest — straight into `createViewClient`. */
  endpoints: EndpointManifest
}

/**
 * Fetch a project's view-spec payload.
 *
 * Same-origin and cookie-authed: AppHost is served BY the pod, so `podRoot` is `''` (the
 * `fetch` URL is `/api/apps/<id>/views`) and the session cookie is sent with
 * `credentials: 'include'`. A non-2xx response, a malformed body, or an app with no views is
 * an ERROR — this shell renders spec apps only.
 */
export async function fetchAppViews(projectId: string, podRoot: string): Promise<AppViews> {
  const res = await fetch(`${podRoot}/api/apps/${encodeURIComponent(projectId)}/views`, {
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(`Could not load this app (HTTP ${res.status}).`)
  }
  let body: Partial<AppViews>
  try {
    body = (await res.json()) as Partial<AppViews>
  } catch {
    throw new Error('This app returned a malformed payload.')
  }
  const views = Array.isArray(body.views) ? body.views : []
  if (views.length === 0) {
    throw new Error('This project has no app views to render.')
  }
  return {
    project: typeof body.project === 'string' ? body.project : projectId,
    views,
    layouts: Array.isArray(body.layouts) ? body.layouts : [],
    components: Array.isArray(body.components) ? body.components : [],
    shell: body.shell ?? null,
    endpoints: body.endpoints ?? {},
  }
}

/**
 * The page a freshly opened app lands on.
 *
 * Ported verbatim from `apps/mobile/src/app-views.ts#initialRoute`: the shell's first
 * destination if it declares one, else `index`, else the first spec. Every candidate is a
 * STATIC route (a nav target cannot be parameterised, and `index` is not), so no params come
 * out of this — it picks a LANDING route, the matcher does the rest.
 */
export function pickInitialRoute(views: readonly ViewSpec[], shell: ShellSpec | null): string | null {
  const declared = shell?.nav?.[0]?.route ?? shell?.groups?.[0]?.home
  if (declared && views.some((v) => v.route === declared)) return declared
  if (views.some((v) => v.route === 'index')) return 'index'
  return views[0]?.route ?? null
}
