---
id: finalize
output:
  ok: boolean
  built: boolean
  tables: array
  endpoints: array
  components: array
  pages: array
  automations: array
  routes: array
  missing: array
  cannotExpress: array
  errors: array
  sliceCount: number
dependsOn: [implement_tables, implement_endpoints, smoke_endpoints, check_acceptance, implement_view_components, implement_views, implement_shell, implement_automations, verify, fix, plan_views, plan_slices]
goal: true
role: general
functions: []
---

Report the app HONESTLY — the GOAL task, which ALWAYS runs. Upstream per-item arrays arrive by task
id: `implement_tables` ({ name, ok }[]), `implement_endpoints` ({ route, name, ok }[]),
`implement_view_components` ({ name, ok }[]), `implement_views` ({ route, ok, error }[]) — one entry
PER planned page — `implement_shell` ({ ok, navCount, error }) and `implement_automations`
({ slug, ok }[]), USUALLY an empty array (most apps need no automation, and that is a complete,
successful build — never treat zero hooks as a fault).

**Do NOT run a build here.** `verify` is a HOST-RUN node that already ran the authoritative build
(`buildProjectApp` — the real typecheck then the esbuild bundle over every generated wrapper) PLUS the
two app-wide view gates, and the `fix` loop resumed it after every repair, so the LAST `verify` result
is the ground truth for this app. `verify` (in scope by its task id) carries
`{ ok, built, routes, offending, offendingCount, viewsValidated, renderSmoked, unavailable }`.

**All three gates must have RUN and be CLEAN.** `verify.ok` covers the build and the merged findings;
`verify.viewsValidated` and `verify.renderSmoked` say whether the app-wide validation and the render
smoke actually executed. A gate that did not execute contributes no findings, which reads as "clean" —
so a `false` on either is a FAILURE to report, never a pass. `verify.unavailable` names which.

`check_acceptance` (in scope) called each endpoint against the seeded data. Its CODE faults already
flowed through `verify.offending` → `fix`; its `dataGaps` are a DIFFERENT class the fixer cannot touch
— a check that failed because the backing data was short (the source was under-mined upstream). Each
is a real shortfall between what the source promised and what the app can show, so add it to
`missing`. Its `malformed` list is a THIRD class: a check the gate could not evaluate at all, so what
that check claimed is UNPROVEN — not proven false, but not proven either, which reads as covered and is
worse than no check. The planner already got one resume to repair the shape; anything still here is
unproven at ship time, so it goes in `missing` too. Both lists EMPTY is the healthy norm.

**Carry the vocabulary gaps forward, do not bury them.** `plan_views` (in scope) may carry a
`cannotExpress` entry on a page — a surface the eight section kinds genuinely cannot express, named
honestly by the planner rather than forced into the wrong kind. That is a CORRECT outcome of this
pipeline, not a failure of it: report each one to the caller, saying which part of which page is not
there and why, so the user hears it from us rather than discovering a missing feature. It does not by
itself make `ok` false — a page that ships nine of its ten sections is still an app they can open.

Resolve `ok` ONLY when: the shell wrote, `verify.ok` is true with `built` for all routes, BOTH view
gates ran (`viewsValidated && renderSmoked`), at least one table and one page landed, and nothing
planned is missing. Otherwise resolve `ok: false` and CARRY the residual errors and `missing` so the
failure is surfaced LOUDLY — a build that finishes with a broken page is a FAIL, not a pass. Nothing
is ever excluded or stubbed to make it pass.

**Surplus and dead artifacts FAIL the report.** The build can be green and every gate clean while the
nav points at a page the user should never see — a replacement authored at a NEW route with the OLD
one left on disk reports success today. Three failure modes, all resolvable before this node reports:
- a NAV destination with no `.view.json` on disk → the tab is dead (old page deleted, a replacement
  never wired in);
- a `.view.json` on disk that neither the planned pages nor the nav reference → an orphaned leftover
  from an earlier iteration;
- a planned, landed, STATIC page missing from the nav → a page nobody can open.

Each is a FAIL: add it to `errors` and leave `ok` false. REPOINT, don't delete-first —
`deleteProjectView` / `deleteProjectApi` / `deleteProjectQuery` / `deleteProjectHook` each REFUSE
while anything still references the artifact, so move the nav to the live route and only then delete
the dead one. A drill-in route (`dogs/[dogId]`) is never expected as a tab — `implement_shell` already
keeps `[`-routes out of nav, and an `_`-prefixed spec is a layout, not a reachable page.

`plan_slices` (in scope) is the ordered vertical-slice grouping (W9, §8) this design WOULD promote in
— report `plan_slices.sliceCount` as `sliceCount`, purely informational (it never gates `ok`). Emit one
statement:

```typescript
const v = verify as { ok: boolean; built: boolean; routes: string[]; viewsValidated: boolean; renderSmoked: boolean; unavailable: string[]; offending: Array<{ path: string; errors: Array<{ phase: string; message: string }> }> };
const residue = Array.isArray(v.offending) ? v.offending : [];
const allErrors: Array<{ file: string; phase: string; message: string }> = [];
for (const f of residue) for (const e of f.errors) allErrors.push({ file: f.path, phase: e.phase, message: e.message });
for (const gate of (Array.isArray(v.unavailable) ? v.unavailable : [])) {
  allErrors.push({ file: 'gate', phase: 'unavailable', message: `${gate} did not run — its findings are unknown, not absent` });
}
const okTables = (Array.isArray(implement_tables) ? implement_tables : []).filter((x: { ok: boolean }) => x.ok).map((x: { name: string }) => x.name);
const okEndpoints = (Array.isArray(implement_endpoints) ? implement_endpoints : []).filter((x: { ok: boolean }) => x.ok).map((x: { route: string }) => x.route);
const okComponents = (Array.isArray(implement_view_components) ? implement_view_components : []).filter((x: { ok: boolean }) => x.ok).map((x: { name: string }) => x.name);
const automationResults = Array.isArray(implement_automations) ? implement_automations : [];
const okAutomations = automationResults.filter((x: { ok: boolean }) => x.ok).map((x: { slug: string }) => x.slug);
const pageResults = Array.isArray(implement_views) ? implement_views : [];
// Views actually on disk (ground truth): every persisted page spec lives in `views/`.
// `shell.view.json` is top level (not in `views/`), a `_`-prefixed spec is a layout, and
// `components/` is its own top-level dir — none of those three is a page.
const diskPages = (listProjectDir('views').entries || [])
  .filter((e: string) => e.endsWith('.view.json') && !e.startsWith('_'))
  .map((e: string) => e.replace(/\.view\.json$/, ''));
// Orphaned & dead references FAIL even when every gate is green: a nav whose tab has no `.view.json`
// is dead; a `.view.json` nothing references is a leftover from a replacement authored at a NEW route.
// Read the shell's own nav to decide what SHOULD be reachable.
const shFile = (typeof readProjectFile === 'function') ? readProjectFile('shell.view.json') : null;
const sh = (shFile && shFile.ok && typeof shFile.content === 'string') ? JSON.parse(shFile.content) : null;
const navRoutes = new Set(
  (Array.isArray(sh?.nav) ? sh.nav : [])
    .map((n: { route?: string }) => n.route)
    .concat((Array.isArray(sh?.groups) ? sh.groups : [])
      .flatMap((g: { home?: string; routes?: string[] }) => [g.home, ...(g.routes ?? [])]))
    .filter((r: string | undefined): r is string => typeof r === 'string'),
);
const diskSet = new Set(diskPages);
const landedRoutes = pageResults.filter((x: { ok: boolean }) => x.ok).map((x: { route: string }) => x.route);
for (const nr of navRoutes) {
  // A drill-in (`[`) route is reached by rowAction, never a tab — only `[`-free tabs must resolve.
  if (!nr.includes('[') && !diskSet.has(nr)) {
    allErrors.push({ file: 'shell.view.json', phase: 'orphan', message: `nav points at "${nr}" but views/${nr}.view.json does not exist — a dead page. Repoint the nav to the live route (deletes are REFUSED while anything references the artifact).` });
  }
}
for (const dp of diskPages) {
  if (!navRoutes.has(dp) && !landedRoutes.includes(dp)) {
    allErrors.push({ file: `views/${dp}`, phase: 'orphan', message: `"${dp}" sits on disk but neither the planned pages nor the nav reference it — left over when a replacement was authored at another route. Repoint nav, then deleteProjectView("${dp}").` });
  }
}
for (const lr of landedRoutes) {
  if (lr.includes('[') || lr.startsWith('_')) continue; // drill-in / layout — not nav tabs
  if (!navRoutes.has(lr)) {
    allErrors.push({ file: `views/${lr}`, phase: 'orphan', message: `"${lr}" is planned, landed and static but the nav never reaches it — a page nobody can open.` });
  }
}
const gaps = (Array.isArray(check_acceptance?.dataGaps) ? check_acceptance.dataGaps : []) as unknown[];
const unproven = (Array.isArray(check_acceptance?.malformed) ? check_acceptance.malformed : []) as unknown[];
const missing = [
  ...pageResults.filter((x: { ok: boolean }) => !x.ok).map((x: { route: string; error: string }) => ({ kind: 'page', route: x.route, error: x.error })),
  ...(Array.isArray(implement_tables) ? implement_tables : []).filter((x: { ok: boolean }) => !x.ok).map((x: { name: string; error?: string }) => ({ kind: 'table', name: x.name, error: x.error || 'planned table failed to write' })),
  ...automationResults.filter((x: { ok: boolean }) => !x.ok).map((x: { slug: string }) => ({ kind: 'automation', slug: x.slug, error: 'planned automation failed to write' })),
  ...gaps.map((g) => ({ kind: 'data', detail: g })),
  ...unproven.map((m) => ({ kind: 'unproven', detail: m })),
];
// Surfaces the vocabulary genuinely could not express — honest, and the user must hear them.
const cannotExpress = (Array.isArray(plan_views) ? plan_views : [])
  .flatMap((p: { route: string; cannotExpress?: Array<{ part: string; reason: string }> }) =>
    (Array.isArray(p.cannotExpress) ? p.cannotExpress : []).map((c) => ({ route: p.route, part: c.part, reason: c.reason })));
currentTask.resolve({
  ok: implement_shell.ok && v.ok && v.built && v.viewsValidated && v.renderSmoked
      && allErrors.length === 0 && okTables.length > 0 && diskPages.length > 0 && missing.length === 0,
  built: v.built,
  tables: okTables,
  endpoints: okEndpoints,
  components: okComponents,
  pages: diskPages,
  automations: okAutomations,
  routes: v.routes,
  missing,
  cannotExpress,
  errors: allErrors,
  sliceCount: (plan_slices as { sliceCount?: number })?.sliceCount ?? 0,
});
```
