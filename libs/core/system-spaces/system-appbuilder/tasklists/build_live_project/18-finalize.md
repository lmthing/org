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
dependsOn: [implement_tables, implement_endpoints, smoke_endpoints, check_acceptance, implement_view_components, implement_views, implement_shell, implement_automations, verify, fix, plan_views]
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
is ever excluded or stubbed to make it pass. Emit one statement:

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
// Views actually on disk (ground truth): every persisted page spec. Pages live in `views/` (v2);
// a legacy project may still hold them in `pages/`. `shell.view.json` is top level (not in `views/`),
// a `_`-prefixed spec is a layout, and `components/` is its own top-level dir — none is a page.
const listPageSpecs = (dir: string): string[] => (listProjectDir(dir).entries || [])
  .filter((e: string) => e.endsWith('.view.json') && !e.startsWith('_'))
  .map((e: string) => e.replace(/\.view\.json$/, ''));
const diskPages = [...new Set([...listPageSpecs('views'), ...listPageSpecs('pages')])];
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
});
```
