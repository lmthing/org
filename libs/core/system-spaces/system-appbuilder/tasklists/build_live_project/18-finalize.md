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
  errors: array
dependsOn: [implement_tables, implement_endpoints, smoke_endpoints, check_acceptance, implement_components, implement_pages, implement_automations, verify, fix]
goal: true
role: general
functions: []
---

Complete, BUILD, and package the app — the authoritative gate. This is the GOAL task: it ALWAYS runs, does
the ONE real build, and resolves an honest summary. Upstream per-item arrays arrive by task id:
`implement_tables` ({ name, ok }[]), `implement_endpoints` ({ route, name, ok }[]), `implement_components`
({ name, ok }[]), `implement_pages` ({ route, ok, error }[]) — one entry PER planned page — and
`implement_automations` ({ slug, ok }[]) — one entry per planned cron/event hook, USUALLY an empty array
(most apps need no automation, and that is a complete, successful build — never treat zero hooks as a fault).

First make the app OPENABLE by writing the persistent chat layout `_layout` with the `<Chat agent="thing"
/>` dock — receive `children` and render them directly with the dock (NOT an `Outlet`); import `Chat` only
from `@app/runtime`.

Then run the AUTHORITATIVE build+check: call `buildApp()`. This is the SOLE build-invoker — it runs the
real project-app typecheck and THEN, only if that passed, the esbuild bundle, over EVERY route
(including the layout just written). Two phases, not three: `errors[].phase` is `'typecheck'` or
`'build'` and NEVER `'lint'` — the write-time contract lint is real but throws at the WRITER during the
authoring turn, so it can never appear here. Because typecheck short-circuits, an empty `build` phase on
a failed check means the bundle never ran, not that bundling succeeded. It is what
sets the app `built` (nothing relies on a lazy build the first time the app is opened). It resolves the
structured `{ ok, built, routes, errors }` — the programmatic ground truth. The prior gate+fix rounds have
already driven the offending files clean; this is the final verification.

The MECHANICAL checks the compiler cannot do — endpoint→table, page→endpoint, param arity, the
`{ type, props }` descriptor shape, surface-token-as-text — already ran in `verify`, a HOST-RUN code
node, and its findings were driven to zero by the `fix` loop. Do NOT re-implement them here: `verify`
(in scope by its task id) carries the last pass's `{ ok, built, routes, offending, offendingCount }`,
and a non-empty `verify.offending` means the loop exhausted its attempts with faults still open — fold
that into your report rather than declaring success.

`check_acceptance` (in scope by its task id) called each endpoint against the seeded data and evaluated
the source-grounded checks. Its CODE faults already flowed through `verify.offending` → `fix`; but its
`dataGaps` are a DIFFERENT class the fixer cannot touch — a check that failed because the backing data
was short, i.e. the source was under-mined upstream (a table with fewer rows than the brief states, an
aggregate reading a column the seed never filled). Each `dataGaps` entry is a real shortfall between what
the source promised and what the app can show, so add it to `missing` (it is exactly the kind of silent
data-loss that reads as a working-but-empty app). An EMPTY `dataGaps` list is the healthy norm.

Then report HONESTLY, and NEVER declare success on a partial or broken app. Read the pages that ACTUALLY
landed with `listProjectDir('pages').entries` (ground truth) and compare against what `implement_pages`
attempted: any `ok:false` entry is a MISSING page. The same discipline covers TABLES: any
`implement_tables` `ok:false` entry is a MISSING table — the data foundation of every endpoint planned
against it — and belongs in `missing` just like a failed page. It covers AUTOMATIONS too: a planned
`implement_automations` entry with `ok:false` is a hook that failed to land, so a story's automatic
behaviour is silently gone — surface it in `missing`. An EMPTY automations list is NOT a fault: most apps
need none, so `ok` never depends on there being any. Resolve `ok` ONLY when the layout wrote,
the build is clean (`buildApp().ok` — zero typecheck/build errors) and `built` for all routes, the
endpoint→table / page→endpoint / render-correctness scans found nothing dangling, at least one table and
one page landed, AND nothing planned is missing. If the build still has `errors`, resolve `ok:false` and
CARRY them (and `missing`) so the failure is surfaced LOUDLY to the caller — a build that finishes with a
broken/excluded page is a FAIL, not a pass. Emit one statement:

```typescript
const layout = writeProjectPage('_layout', [
  "import type { ReactNode } from 'react';",
  "import { Chat } from '@app/runtime';",
  "export default function Layout({ children }: { children: ReactNode }) {",
  "  return <>{children}<Chat agent=\"thing\" /></>;",
  "}",
].join("\n"));
const check = await buildApp(); // { ok, built, routes, errors } — the one authoritative build
// `verify` already ran every mechanical scan host-side; carry its residue, never re-scan here.
const residue = (verify && Array.isArray(verify.offending) ? verify.offending : []) as Array<{ path: string; errors: Array<{ phase: string; message: string }> }>;
const allErrors: Array<{ file: string; line?: number; phase: string; message: string }> = check.errors.map((e) => ({ file: e.file, line: e.line, phase: e.phase, message: e.message }));
for (const f of residue) {
  for (const e of f.errors) allErrors.push({ file: f.path, phase: e.phase, message: e.message });
}
const okTables = (Array.isArray(implement_tables) ? implement_tables : []).filter((x: { ok: boolean }) => x.ok).map((x: { name: string }) => x.name);
const okEndpoints = (Array.isArray(implement_endpoints) ? implement_endpoints : []).filter((x: { ok: boolean }) => x.ok).map((x: { route: string }) => x.route);
const okComponents = (Array.isArray(implement_components) ? implement_components : []).filter((x: { ok: boolean }) => x.ok).map((x: { name: string }) => x.name);
// Automations are OPTIONAL — `implement_automations` is empty for the many apps that need none, and an
// empty list is a COMPLETE build, never a fault. A planned hook that FAILED to write is a real gap.
const automationResults = Array.isArray(implement_automations) ? implement_automations : [];
const okAutomations = automationResults.filter((x: { ok: boolean }) => x.ok).map((x: { slug: string }) => x.slug);
const pageResults = Array.isArray(implement_pages) ? implement_pages : [];
// Pages actually on disk (ground truth): every top-level *.tsx that is not a wrapper (_layout/_app).
const diskPages = (listProjectDir('pages').entries || []).filter((e: string) => e.endsWith('.tsx') && !e.startsWith('_')).map((e: string) => e.replace(/\.tsx$/, ''));
// Anything planned that failed to LAND — a page OR a table — is missing; surface it, do not hide it.
const missing = [
  ...pageResults.filter((x: { ok: boolean }) => !x.ok).map((x: { route: string; error: string }) => ({ kind: 'page', route: x.route, error: x.error })),
  ...(Array.isArray(implement_tables) ? implement_tables : []).filter((x: { ok: boolean }) => !x.ok).map((x: { name: string; error?: string }) => ({ kind: 'table', name: x.name, error: x.error || 'planned table failed to write' })),
  // A planned automation that failed to write — a story's automatic behaviour silently gone.
  ...automationResults.filter((x: { ok: boolean }) => !x.ok).map((x: { slug: string }) => ({ kind: 'automation', slug: x.slug, error: 'planned automation failed to write' })),
];
currentTask.resolve({
  // ok ⇔ the app is COMPLETE and type-correct: layout wrote, the build is clean and built, the
  // verify gate ended with nothing outstanding, real data landed, and nothing planned is missing.
  ok: layout.ok && check.ok && check.built && allErrors.length === 0 && okTables.length > 0 && diskPages.length > 0 && missing.length === 0,
  built: check.built,
  tables: okTables,
  endpoints: okEndpoints,
  components: okComponents,
  pages: diskPages,
  automations: okAutomations,
  routes: check.routes,
  missing,
  errors: allErrors,
});
```
