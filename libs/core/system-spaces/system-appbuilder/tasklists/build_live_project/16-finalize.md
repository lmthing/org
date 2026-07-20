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

Then run the MECHANICAL checks the compiler cannot do. **Endpoint→table:** the db surface is dynamically
typed, so an api module that queries a table `database/` does not have builds CLEAN and 500s on every
call at runtime — as broken as an unresolved import, but invisible to `buildApp()`. Scan every api
module's literal `db.query/insert/update/remove('<name>')` references against the tables actually on
disk and treat every miss as a build error (`phase: 'gate'`), folded into `errors` and into `ok`.
**Page→endpoint:** a page/component that calls `useApi`/`useApiMutation`/`apiCall` with a name that is
not a real generated endpoint silently short-circuits to an error state with NO network request ever
firing — the page renders broken (a stale total, an empty list) with no trace, invisible to `buildApp()`
and to a raw HTTP-status probe. Scan every page/component's literal `useApi(...)`/`useApiMutation(...)`/
`apiCall(...)` calls against the endpoint `name`s actually exported by `api/`, and fold every miss into
`errors` the same way. **Render-correctness:** a page/component function that RETURNS a plain
`{ type, props }` (or `{ type, props, children }`) object literal instead of JSX is returning THIS
SYSTEM'S OWN display()-descriptor shape (the chat/tasklist protocol) — not renderable React; it
typechecks (the return type is loose enough) but throws React error #31 ("object with keys {type,
props}") at runtime. Scan every page/component source for a `return` of that exact descriptor shape and
fold every hit into `errors` too.

Then report HONESTLY, and NEVER declare success on a partial or broken app. Read the pages that ACTUALLY
landed with `listProjectDir('pages').entries` (ground truth) and compare against what `implement_pages`
attempted: any `ok:false` entry is a MISSING page. The same discipline covers TABLES: any
`implement_tables` `ok:false` entry is a MISSING table — the data foundation of every endpoint planned
against it — and belongs in `missing` just like a failed page. Resolve `ok` ONLY when the layout wrote,
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
// Mechanical endpoint→table check the compiler cannot do (dynamic db surface): every literal table
// an api module touches must exist in database/ — a miss is a build error, folded into ok.
const allErrors: Array<{ file: string; line?: number; phase: string; message: string }> = check.errors.map((e) => ({ file: e.file, line: e.line, phase: e.phase, message: e.message }));
const tableNames = (listProjectDir('database').entries || []).filter((n) => n.endsWith('.json')).map((n) => n.replace(/\.json$/, ''));
const walk = (listProjectDir('api').entries || []).map((n) => 'api/' + n);
while (walk.length) {
  const p = walk.shift() as string;
  if (!p.endsWith('.ts')) { for (const c of listProjectDir(p).entries || []) walk.push(p + '/' + c); continue; }
  const src = readProjectFile(p).content || '';
  const ref = /\bdb\s*\.\s*(?:query|insert|update|remove)\s*\(\s*['"`]([A-Za-z0-9_-]+)['"`]/g;
  for (let m = ref.exec(src); m; m = ref.exec(src)) {
    if (!tableNames.includes(m[1])) allErrors.push({ file: p, phase: 'gate', message: 'references table "' + m[1] + '" which does not exist in database/ — builds clean but 500s at runtime' });
  }
}
// Mechanical page→endpoint check + render-correctness check: every client useApi/useApiMutation/
// apiCall('<name>') call must resolve to a real generated endpoint name (a miss silently short-circuits
// to an error state with NO network request — invisible to buildApp()); and no page/component may
// RETURN this system's own { type, props } display()-descriptor shape in place of JSX (it typechecks,
// then throws React error #31 at runtime).
const endpointNames: string[] = [];
const epWalk = (listProjectDir('api').entries || []).map((n) => 'api/' + n);
while (epWalk.length) {
  const p = epWalk.shift() as string;
  if (!p.endsWith('.ts')) { for (const c of listProjectDir(p).entries || []) epWalk.push(p + '/' + c); continue; }
  const nm = /export\s+const\s+name\s*=\s*['"`]([A-Za-z0-9_-]+)['"`]/.exec(readProjectFile(p).content || '');
  if (nm && !endpointNames.includes(nm[1])) endpointNames.push(nm[1]);
}
const clientWalk = (listProjectDir('pages').entries || []).map((n) => 'pages/' + n)
  .concat((listProjectDir('components').entries || []).map((n) => 'components/' + n));
while (clientWalk.length) {
  const p = clientWalk.shift() as string;
  if (!p.endsWith('.tsx') && !p.endsWith('.ts')) { for (const c of listProjectDir(p).entries || []) clientWalk.push(p + '/' + c); continue; }
  const src = readProjectFile(p).content || '';
  const apiRef = /\b(?:useApi(?:Mutation)?|apiCall)\s*(?:<[^(]*>)?\s*\(\s*['"`]([A-Za-z0-9_-]+)['"`]/g;
  for (let m = apiRef.exec(src); m; m = apiRef.exec(src)) {
    if (!endpointNames.includes(m[1])) allErrors.push({ file: p, phase: 'gate', message: 'calls useApi/useApiMutation/apiCall("' + m[1] + '") which is not a generated endpoint name (have: ' + (endpointNames.join(', ') || 'none') + ') — useApi silently short-circuits to an error state with NO network request, exactly like an unresolved import' });
  }
  const descriptorRef = /\breturn\s*\{\s*type\s*:\s*(?:'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)\s*,\s*props\s*:/;
  if (descriptorRef.test(src)) allErrors.push({ file: p, phase: 'gate', message: 'returns a plain { type, props } object literal instead of JSX — that is this system\'s OWN display()-descriptor shape (the chat/tasklist protocol), not renderable React; it typechecks clean but throws React error #31 at runtime. Return real JSX (`<div>…</div>`), never `{ type, props }`.' });
}
const okTables = (Array.isArray(implement_tables) ? implement_tables : []).filter((x: { ok: boolean }) => x.ok).map((x: { name: string }) => x.name);
const okEndpoints = (Array.isArray(implement_endpoints) ? implement_endpoints : []).filter((x: { ok: boolean }) => x.ok).map((x: { route: string }) => x.route);
const okComponents = (Array.isArray(implement_components) ? implement_components : []).filter((x: { ok: boolean }) => x.ok).map((x: { name: string }) => x.name);
const pageResults = Array.isArray(implement_pages) ? implement_pages : [];
// Pages actually on disk (ground truth): every top-level *.tsx that is not a wrapper (_layout/_app).
const diskPages = (listProjectDir('pages').entries || []).filter((e: string) => e.endsWith('.tsx') && !e.startsWith('_')).map((e: string) => e.replace(/\.tsx$/, ''));
// Anything planned that failed to LAND — a page OR a table — is missing; surface it, do not hide it.
const missing = [
  ...pageResults.filter((x: { ok: boolean }) => !x.ok).map((x: { route: string; error: string }) => ({ kind: 'page', route: x.route, error: x.error })),
  ...(Array.isArray(implement_tables) ? implement_tables : []).filter((x: { ok: boolean }) => !x.ok).map((x: { name: string }) => ({ kind: 'table', name: x.name, error: 'planned table failed to write' })),
];
currentTask.resolve({
  // ok ⇔ the app is COMPLETE and type-correct: layout wrote, the build is clean and built, no api
  // module references a nonexistent table, real data landed, and nothing planned is missing.
  ok: layout.ok && check.ok && check.built && allErrors.length === 0 && okTables.length > 0 && diskPages.length > 0 && missing.length === 0,
  built: check.built,
  tables: okTables,
  endpoints: okEndpoints,
  components: okComponents,
  pages: diskPages,
  routes: check.routes,
  missing,
  errors: allErrors,
});
```
