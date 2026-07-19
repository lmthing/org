---
id: finalize
output:
  ok: boolean
  built: boolean
  tables: array
  endpoints: array
  components: array
  pages: array
  routes: array
  missing: array
  errors: array
dependsOn: [implement_tables, implement_endpoints, implement_components, implement_pages, compile_pass2, fix_pass2]
goal: true
role: general
functions: []
---

Complete, BUILD, and package the app — the authoritative gate. This is the GOAL task: it ALWAYS runs, does
the ONE real build, and resolves an honest summary. Upstream per-item arrays arrive by task id:
`implement_tables` ({ name, ok }[]), `implement_endpoints` ({ route, name, ok }[]), `implement_components`
({ name, ok }[]), `implement_pages` ({ route, ok, error }[]) — one entry PER planned page.

First make the app OPENABLE by writing the persistent chat layout `_layout` with the `<Chat agent="thing"
/>` dock — receive `children` and render them directly with the dock (NOT an `Outlet`); import `Chat` only
from `@app/runtime`.

Then run the AUTHORITATIVE build+check: call `buildApp()`. This is the SOLE build-invoker — it runs the
real lint → typecheck → esbuild bundle over EVERY route (including the layout just written) and is what
sets the app `built` (nothing relies on a lazy build the first time the app is opened). It resolves the
structured `{ ok, built, routes, errors }` — the programmatic ground truth. The prior gate+fix rounds have
already driven the offending files clean; this is the final verification.

Then report HONESTLY, and NEVER declare success on a partial or broken app. Read the pages that ACTUALLY
landed with `listProjectDir('pages').entries` (ground truth) and compare against what `implement_pages`
attempted: any `ok:false` entry is a MISSING page. Resolve `ok` ONLY when the layout wrote, the build is
clean (`buildApp().ok` — zero typecheck/build errors) and `built` for all routes, at least one table and
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
const okTables = (Array.isArray(implement_tables) ? implement_tables : []).filter((x: { ok: boolean }) => x.ok).map((x: { name: string }) => x.name);
const okEndpoints = (Array.isArray(implement_endpoints) ? implement_endpoints : []).filter((x: { ok: boolean }) => x.ok).map((x: { route: string }) => x.route);
const okComponents = (Array.isArray(implement_components) ? implement_components : []).filter((x: { ok: boolean }) => x.ok).map((x: { name: string }) => x.name);
const pageResults = Array.isArray(implement_pages) ? implement_pages : [];
// Pages actually on disk (ground truth): every top-level *.tsx that is not a wrapper (_layout/_app).
const diskPages = (listProjectDir('pages').entries || []).filter((e: string) => e.endsWith('.tsx') && !e.startsWith('_')).map((e: string) => e.replace(/\.tsx$/, ''));
// A planned page that failed to land — surface it, do not hide it.
const missing = pageResults.filter((x: { ok: boolean }) => !x.ok).map((x: { route: string; error: string }) => ({ route: x.route, error: x.error }));
currentTask.resolve({
  // ok ⇔ the app is COMPLETE and type-correct: layout wrote, the build is clean and built, real data
  // landed, and nothing planned is missing. A residual compiler error or a missing page ⇒ ok:false.
  ok: layout.ok && check.ok && check.built && check.errors.length === 0 && okTables.length > 0 && diskPages.length > 0 && missing.length === 0,
  built: check.built,
  tables: okTables,
  endpoints: okEndpoints,
  components: okComponents,
  pages: diskPages,
  routes: check.routes,
  missing,
  errors: check.errors,
});
```
