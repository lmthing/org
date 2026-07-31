/**
 * render-gate.mjs — the adapter that points {@link renderCheck} at a scenario run's live app.
 *
 * `render-rig.mjs` is deliberately ignorant: it takes a base URL and a list of routes, drives a real
 * Chrome over CDP, and measures pixels. Everything it knows how to find is therefore true of ANY app
 * served by the pod, whoever authored it. This module is the thin layer that supplies those two
 * inputs from a running scenario, and it is the reason the gate can score `system-appbuilder` and
 * `system-viewbuilder` on the same instrument:
 *
 *  - **routes** come from `POST /api/projects/:id/app/build`, which answers with the app's real route
 *    table (`{routePath, file}`) — the pages the app actually serves, not the pages some spec file
 *    claims. A TSX app and a spec app both produce it, and the `file` travels with the route so a
 *    finding names `pages/x.tsx` or `pages/x.view.json` as appropriate.
 *  - **route parameters** come from the app's own seeded data.
 *
 * ## Why parameters are resolved per-collection and never from a global pool
 *
 * `/plants/:id` needs a real plant id. The obvious implementation — keep every id seen from every
 * table in one bag and hand out the first — is a bug this codebase has already shipped and fixed
 * once: `renderSmokeViews` did exactly that, and because `ingredients` was fetched before `recipes`,
 * `recipes/[id]` was smoked with an INGREDIENT id. The page then 404'd, and the gate blamed the page.
 *
 * So the pool here is scoped: a route's parameter is filled only from the table its own path segment
 * names (`/plants/:id` → the `plants` table, singular or plural), and when no such table exists the
 * route is left unresolved. `renderCheck` then reports it as `measured: false` with the reason —
 * an honest gap, never a pass and never a false accusation.
 */
import { renderCheck } from './render-rig.mjs';

/** `/plants/:id` → `plants`; `/` → ``. The collection segment a parameter should be drawn from. */
export function collectionOf(routePath) {
  const segs = String(routePath).split('/').filter(Boolean);
  const i = segs.findIndex((s) => s.startsWith(':'));
  if (i <= 0) return '';
  return segs[i - 1];
}

/** Match a path segment to a table name, tolerating the singular/plural split app authors use. */
export function matchTable(segment, tableNames) {
  if (!segment) return null;
  const seg = segment.toLowerCase();
  const names = tableNames.map((n) => ({ raw: n, low: String(n).toLowerCase() }));
  const exact = names.find((n) => n.low === seg);
  if (exact) return exact.raw;
  const variants = [seg.endsWith('s') ? seg.slice(0, -1) : `${seg}s`, seg.endsWith('ies') ? `${seg.slice(0, -3)}y` : null].filter(Boolean);
  for (const v of variants) {
    const hit = names.find((n) => n.low === v);
    if (hit) return hit.raw;
  }
  return null;
}

/** The primary-key-ish value of a row: an explicit `id`, else the first `*_id`/`*Id`-free key. */
export function idOf(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.id !== undefined && row.id !== null && row.id !== '') return String(row.id);
  for (const [k, v] of Object.entries(row)) {
    if (/^(id|uuid|slug|key)$/i.test(k) && v !== undefined && v !== null && v !== '') return String(v);
  }
  return null;
}

/**
 * Build `renderCheck`'s `routes` from a build's route table plus the app's rows.
 *
 * @param {Array<{routePath:string,file?:string}>} buildRoutes  `appBuild().routes`
 * @param {Record<string, Array<object>>} tables                 table name → rows
 * @returns {Array<object>} `{route, file, params}` entries, params filled only where honestly known
 */
export function routesForGate(buildRoutes, tables = {}) {
  const tableNames = Object.keys(tables ?? {});
  return (buildRoutes ?? [])
    .filter((r) => r && typeof r.routePath === 'string')
    .map((r) => {
      const entry = { route: r.routePath, params: {} };
      if (r.file) entry.file = r.file;
      const names = [...r.routePath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
      if (!names.length) return entry;
      const table = matchTable(collectionOf(r.routePath), tableNames);
      const rows = table ? tables[table] : null;
      const id = Array.isArray(rows) && rows.length ? idOf(rows[0]) : null;
      // ONE parameter per route is what an app's detail page has; a multi-parameter route with no
      // owning table stays unresolved rather than being filled with a plausible-looking wrong value.
      if (id && names.length === 1) entry.params[names[0]] = id;
      return entry;
    });
}

/**
 * Run the layout + interaction gate against a live scenario app.
 *
 * @param {object} o
 * @param {object} o.pod              the harness Pod (for `appOrigin`)
 * @param {string} o.projectId
 * @param {Array} o.buildRoutes       `appBuild().routes`
 * @param {Record<string,Array>} o.tables  table name → rows (the runner already fetches these)
 * @param {string|null} o.screenshotDir
 * @param {boolean} o.interact        also CLICK one control per route (mutates app data)
 * @returns {Promise<object>} the `renderCheck` report, plus `routesChecked`
 */
export async function renderGate({ pod, projectId, buildRoutes, tables = {}, screenshotDir = null, interact = false, sdkRoot = undefined } = {}) {
  const routes = routesForGate(buildRoutes, tables);
  if (!routes.length) {
    return { ok: null, unavailable: true, reason: 'the build reported no routes — there is no app to look at', routes: [], findings: [], pages: [], counts: null };
  }
  const baseUrl = pod.appOrigin(projectId);
  const report = await renderCheck({ baseUrl, routes, screenshotDir, interact, sdkRoot });
  return { ...report, routesChecked: routes.map((r) => ({ route: r.route, params: r.params, file: r.file ?? null })) };
}

/** The compact form written into `step-NN.json` — the full report lives in `step-NN.full.json`. */
export function compactRenderGate(report) {
  if (!report) return undefined;
  if (report.unavailable) return { ok: null, unavailable: true, reason: report.reason };
  return {
    ok: report.ok,
    counts: report.counts,
    errorCount: report.errorCount,
    findings: (report.findings ?? []).slice(0, 12).map((f) => ({ code: f.code, route: f.route, viewport: f.viewport, message: f.message })),
    screenshots: (report.pages ?? []).map((p) => p.screenshot?.path).filter(Boolean),
  };
}
