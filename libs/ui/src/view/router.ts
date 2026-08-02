/**
 * Pure, DOM-free client route matching — the shared matcher.
 *
 * The matching core extracted from the per-project client router
 * (`libs/cli/src/app/runtime/router.tsx`, aliased as `@app/runtime` in the page
 * bundle) so that **two** consumers share ONE implementation instead of forking it:
 *
 *   - the existing per-project page bundle (re-exports it through `@app/runtime`);
 *   - a future prebuilt app-shell that needs to match a path against a route table
 *     without dragging in React/DOM/history.
 *
 * Nothing here imports React, touches `window`/`document`, or reads globals — the
 * matching rules are pure functions of `(routeTable, clientPath)`. Base-aware
 * navigation (`toHref`, `clientPath`, `navigate`, `Link`) stays in the cli runtime:
 * those reach into `window.location`/`history` and the project's `…/app/<project>`
 * base, which is a browser-runtime concern, not a matching concern.
 */

// ── Route table shape ────────────────────────────────────────────────────────

/**
 * The minimal structural contract {@link matchRoutes} needs from a route entry:
 * a `routePath` pattern with `:param` segments (e.g. `/` or `/items/:id`).
 *
 * A consumer's entry type is free to carry whatever else it likes — a React
 * component (`@app/runtime`'s {@link RouteEntry}), a view spec, a handler —
 * because {@link matchRoutes} is generic over `T extends RoutePattern` and only
 * reads `routePath`. This is what keeps the matcher DOM-free and React-free
 * without losing the entry on the way out (the returned {@link RouteMatch}.entry
 * is the SAME `T` the caller put in, component and all).
 */
export interface RoutePattern {
  /** Route pattern with `:param` segments, e.g. `/` or `/items/:id`. */
  routePath: string;
}

/**
 * A successful match: the winning entry (same shape the caller supplied) plus the
 * captured `:param` → value map.
 */
export interface RouteMatch<T extends RoutePattern = RoutePattern> {
  entry: T;
  params: Record<string, string>;
}

// ── Path matching ─────────────────────────────────────────────────────────────

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/**
 * Drop a stray leading `/pages` segment from an app-relative path.
 *
 * Route-table paths are derived RELATIVE to the project's `pages/` dir
 * (`pages/park-fees.tsx` → `/park-fees`), so a real route is NEVER mounted under
 * `/pages/…`. But the on-disk folder is literally `pages/`, so an LLM-authored
 * page routinely links to a sibling as `/pages/park-fees` instead of the route
 * `/park-fees` — the link then resolves to a client path no route matches and the
 * page renders "No page for /pages/park-fees" (live: scenario 06 index page).
 * Normalizing the prefix away makes that natural mistake resolve to the real
 * route. `/pages` alone collapses to `/`. Non-`/pages` paths pass through.
 */
export function stripPagesPrefix(path: string): string {
  const stripped = path.replace(/^\/pages(?=\/|$)/, '');
  return stripped.length > 0 ? stripped : '/';
}

/**
 * Match a concrete client path against a route table (`:param` → capture).
 *
 * **A STATIC SEGMENT BEATS A PARAMETER**, regardless of declaration order. This used to return the
 * first entry that matched, and the table is built by walking `pages/`, so `/plants/:id` was
 * registered before `/plants/new` and therefore swallowed it: visiting `/plants/new` rendered the
 * DETAIL page. Found by the render rig (`scenarios/harness/lib/render-rig.mjs`) on the first
 * model-built app, whose `plants/new.view.json` is a perfectly good `create` section that no URL
 * could reach — which also explains the "Nothing to fill in." the page appeared to show: it was
 * never the create page at all.
 *
 * Ranking by parameter COUNT (fewest wins) is the whole rule, and it is the same one
 * `apps/mobile/src/app-views.ts#resolveRoute` already applies natively — which is why the phone
 * resolved this correctly while the browser did not. Ties keep declaration order, so nothing else
 * about the table's semantics changes.
 *
 * Generic in `T` so a caller's richer entry type (e.g. `@app/runtime`'s React-typed
 * `RouteEntry`) flows through untouched — the returned `entry` is the same object,
 * component and all. Callers that pass a plain {@link RoutePattern} get a plain
 * {@link RoutePattern} back.
 */
export function matchRoutes<T extends RoutePattern>(
  routes: T[],
  clientPath: string,
): RouteMatch<T> | null {
  const reqSegs = splitPath(clientPath);
  let best: { match: RouteMatch<T>; params: number } | undefined;
  for (const entry of routes) {
    const patSegs = splitPath(entry.routePath);
    if (patSegs.length !== reqSegs.length) continue;
    const params: Record<string, string> = {};
    let paramCount = 0;
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      const p = patSegs[i]!;
      if (p.startsWith(':')) {
        params[p.slice(1)] = decodeURIComponent(reqSegs[i]!);
        paramCount++;
      } else if (p !== reqSegs[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // A fully static match is maximally specific — nothing can beat it, so stop.
    if (paramCount === 0) return { entry, params };
    if (!best || paramCount < best.params) best = { match: { entry, params }, params: paramCount };
  }
  if (best) return best.match;
  // Fallback AFTER the literal pass (so a genuine route always wins): tolerate a
  // stray `/pages/` prefix on a page-authored link — see {@link stripPagesPrefix}.
  const normalized = stripPagesPrefix(clientPath);
  if (normalized !== clientPath) return matchRoutes(routes, normalized);
  return null;
}
