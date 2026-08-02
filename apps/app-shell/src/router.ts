/**
 * AppHost's browser-routing shim — the thin History/base layer.
 *
 * Two consumers share ONE pure matcher (`matchRoutes` / `stripPagesPrefix` in
 * `@lmthing/ui/view/router`): the per-project page bundle (`libs/cli/.../router.tsx`,
 * aliased `@app/runtime`) and THIS shell. The matcher is DOM-free and React-free by design;
 * what it deliberately does NOT own are the browser-runtime pieces — reading
 * `window.location`, deriving the `…/app/<project>` base, and pushing History state. Those
 * belong to the HOST.
 *
 * The cli's `@app/runtime` is one such host, but it is published inside `@lmthing/cli` — a
 * heavy node package (node-pty, ink, undici, ws, xlsx, …) whose `exports` map exposes only
 * the server entry. Importing it here would drag that graph into a browser bundle. So this
 * module re-implements the ~40 lines of DOM/History glue the cli has, verbatim in semantics,
 * and leaves the matching to the shared pure matcher. The cli router's own comment states
 * this division: base-aware navigation "stays in the cli runtime … a browser-runtime concern,
 * not a matching concern" — and AppHost is a second browser runtime with the same concern.
 *
 * Semantics mirror `libs/cli/src/app/runtime/client.ts#resolveAppBase` and
 * `libs/cli/src/app/runtime/router.tsx#{clientPath,toHref,navigate}` exactly, because the
 * identical build must render under `localhost:8080/app/<project>/`, `lmthing.studio/app/
 * <project>/`, and the `/app`-stripped `lmthing.app/<project>/`.
 */

import { stripPagesPrefix } from '@lmthing/ui/view/router'

/** Custom event the host listens on for in-app (pushState) navigation — mirrors the cli. */
export const NAV_EVENT = 'lmthing:app-shell:navigate'

/**
 * Read the `window.__APP_BASE__` override, if any. Covers the `/app`-stripped host
 * (`lmthing.app/<project>/…`) where the `…/app/<project>` prefix cannot be recovered from
 * the path alone. The pod's serve layer (a later workstream step) sets this when it mounts
 * the shell at a non-standard prefix.
 */
function appBaseOverride(): string | undefined {
  const o = (globalThis as { __APP_BASE__?: string }).__APP_BASE__
  return typeof o === 'string' && o.length > 0 ? o : undefined
}

/**
 * Read an injected project id, if the serve path cannot derive it from the URL (the
 * `/app`-stripped host). `window.__APP_PROJECT_ID__` is the same escape hatch's twin.
 */
function projectIdOverride(): string | undefined {
  const o = (globalThis as { __APP_PROJECT_ID__?: string }).__APP_PROJECT_ID__
  return typeof o === 'string' && o.length > 0 ? o : undefined
}

/**
 * Resolve the app's server root (`…/app/<project>`) from a pathname.
 *
 * Primary rule: the first `…/app/<project>` prefix in `pathname`. A `window.__APP_BASE__`
 * override wins — it covers the `/app`-stripped host where the prefix isn't in the path.
 * Returns `''` when neither is available.
 */
export function resolveAppBase(pathname: string): string {
  const o = appBaseOverride()
  if (o) return o.replace(/\/+$/, '')
  const m = /^(.*?\/app\/[^/]+)/.exec(pathname)
  return m ? (m[1] as string) : ''
}

/**
 * The project id for THIS app instance — a RUNTIME route param, not a build constant.
 *
 * `/app/:projectId/*` is the canonical serve path: the id is the segment after `/app/`.
 * The `/app`-stripped host sets `window.__APP_PROJECT_ID__` instead, since the segment is
 * not prefixed by `/app` there. Returns `null` when neither yields one — the host renders a
 * configuration error rather than fetching an unknown project.
 */
export function projectIdFromLocation(pathname: string): string | null {
  const override = projectIdOverride()
  if (override) return override
  const base = resolveAppBase(pathname)
  // `resolveAppBase` already matched `…/app/<project>`; pull the last segment back out of it.
  const m = /\/app\/([^/]+)$/.exec(base)
  return m ? decodeURIComponent(m[1] as string) : null
}

/** The client route = current pathname minus the resolved `…/app/<project>` base. */
export function clientPath(pathname: string): string {
  const base = resolveAppBase(pathname)
  const rest = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname
  return rest.length > 0 ? rest : '/'
}

/**
 * Turn an app-relative route (`to`, like `recipes/abc`) into a server-absolute href by
 * prefixing the resolved `…/app/<project>` base. Without re-adding it, `navigate('recipes')`
 * would push the origin-absolute `/recipes`, dropping the `/app/<project>/` prefix and
 * leaving the app on reload. External URLs, protocol-relative (`//…`), hash, and query links
 * pass through untouched; an already-based path is left as-is so a stray absolute `to` never
 * double-prefixes.
 */
export function toHref(to: string): string {
  if (!to.startsWith('/') || to.startsWith('//')) return to
  const base = resolveAppBase(window.location.pathname)
  if (!base || to === base || to.startsWith(base + '/')) return to
  // Normalize a stray `/pages/` prefix (see `stripPagesPrefix`) so the pushed URL is the
  // clean route, not `…/pages/x`.
  return base + stripPagesPrefix(to)
}

/**
 * Programmatic navigation — pushes History state and signals the host to re-render.
 * `to` is an app-relative route path; `toHref` re-applies the `…/app/<project>` base so the
 * pushed URL stays inside the app.
 */
export function navigate(to: string): void {
  window.history.pushState({}, '', toHref(to))
  window.dispatchEvent(new Event(NAV_EVENT))
}

/**
 * Convert a view-spec route pattern (`recipes/[id]`, the AUTHORING grammar every spec field
 * uses) into the pure matcher's grammar (`recipes/:id`).
 *
 * The matcher (`matchRoutes`) ranks by parameter count with static-segments-beat-params —
 * exactly the rule the mobile host's `resolveRoute` applies — but speaks the `:param`
 * convention where view specs speak `[param]`. This is a syntactic normalization, not a
 * second matcher: the ranking logic stays in the shared module. `[param]` is the only form a
 * validated spec emits, so this regex is exhaustive over the grammar.
 */
export function toRoutePattern(route: string): string {
  return route.replace(/\[([A-Za-z][A-Za-z0-9]*)\]/g, ':$1')
}
