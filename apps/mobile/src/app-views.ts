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
 * The payload shape (`AppViews`) and the two pure route lookups (`resolveRoute`,
 * `initialRoute`, plus the served-route translation) now live in `@lmthing/ui/view`
 * (`view/app-views.ts`), shared with the `/chat` in-process app pane — both are hosts
 * that route by state, not URL. This module keeps only the native webview/native
 * DISCRIMINATION (`fetchAppTarget`), which is native-surface-specific.
 */

import { normalizeAppViews, type AppViews } from '@lmthing/ui/view'

export {
  resolveRoute,
  servedRoutePath,
  routeForServedPath,
  initialRoute,
  type AppViews,
  type ResolvedRoute,
} from '@lmthing/ui/view'

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
    const app = normalizeAppViews(body, projectId)
    if (app.views.length === 0) return WEBVIEW
    return { kind: 'native', app }
  } catch {
    return WEBVIEW
  }
}
