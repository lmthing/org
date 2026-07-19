---
id: fix_pass1
output:
  path: string
  ok: boolean
dependsOn: [compile_pass1, plan_pages, plan_endpoints, plan_components, plan_tables, implement_components]
forEach: compile_pass1.offending
role: general
functions: []
---

Fix ONE file the compiler rejected — the file in `item` = `{ path, kind, errors }` (`kind` is
`'page'|'component'|'api'`; `errors` is the exact list of `{ line?, phase, message }` the real typecheck
or bundle produced for THIS file). The host runs this node once PER offending file, so you reason about
only this ONE file and never hold the whole app. In scope: `item`, `plan_endpoints`
(`plan_endpoints.endpoints` — each `{ name, route, purpose, tables, fields }`), `plan_components`
(`plan_components.components` — each `{ name, purpose, props }`), `plan_pages`, `plan_tables`, and
`implement_components` (the per-item `{ name, ok }[]` ok-list of components that actually landed).

READ the file first — `readProjectFile(item.path).content` — then build a CORRECTED source that fixes
EACH error `item.errors` names, grounded in the real artifacts, NOT a guess:
- A wrong/re-cased FIELD name (`data.total_cost_usd`, `item.grandTotalUSD`) → look the endpoint up in
  `plan_endpoints.endpoints`, read `data.items` / `data.items[0]`, and use its `fields` VERBATIM.
- A COMPONENT PROP the component does not declare, or a prop fed no data → match the component's real
  `props` in `plan_components`; if a figure has no endpoint to feed it, that prop is a planning gap — drop
  the dependent markup and render inline, never a hardcoded literal.
- An import of a module the project does not have (`react-router`, `@radix-ui/*`, a relative `use-api`) or
  a `@app/runtime` name that is not exported → import ONLY from `@app/runtime`
  (`useApi`/`useApiMutation`/`apiCall`/`Link`/`useParams`/`navigate`/`Chat`), or drop it.
- A component that is imported but NOT in the `implement_components` ok-list → remove the import and render
  the value inline (a dangling import fails the whole bundle).
- `console`/`window`/`document` (NO-DOM ambient) → remove it.
- A null-guard the types demand (`x.toLocaleString()` on a nullable) → coalesce first (`(x ?? 0)`).
- A `phase: 'gate'` error — the file references a TABLE that does not exist in `database/` (the handler
  builds clean but every call 500s at runtime) → decide which side is wrong, grounded in
  `plan_tables.tables` and `listProjectDir('database').entries`: if an EXISTING table already holds this
  kind of record under a drifted spelling (case/hyphen/plural of a real name), re-point the query at the
  real name; if NO existing table holds it, the TABLE is the missing artifact — create it first with
  `writeProjectTable` under a valid snake_case name (columns derived from the endpoint's declared
  `fields`; schema-only — NEVER invent rows), then point every reference in this file at that name.

You must PRESERVE the file's real content — keep every endpoint it already reads and every section it
already renders; you are correcting the fault, not wiping the file. Write with the matching typed writer
for `item.kind` and resolve the outcome honestly.

**`ok: true` is a VERIFIED claim, never an intention.** Resolve `ok: true` ONLY when the writer's result
was actually consumed (`w.ok === true`) AND you re-read the file in this SAME fork and confirmed the
corrected content is what is on disk. A resolve based on what you were ABOUT to write, or on the
assumption that the write "would succeed", is fabricated success: the gate downstream trusts your `ok`,
the file you never actually fixed ships broken, and the whole app can fail to build over it. If the
write failed or you could not verify it landed, resolve `ok: false` with the reason — an honest failure
gets routed onward; a fabricated success is invisible. Declare and assign the write result in ONE
statement (`const w = …`), never a bare `let w;` assigned later. Emit one statement:

```typescript
const f = item as { path: string; kind: 'page' | 'component' | 'api'; errors: Array<{ line?: number; message: string }> };
const cur = readProjectFile(f.path);
// Build `fixed` = cur.content corrected for EVERY fault in f.errors (see above). NEVER resubmit the
// same string, and NEVER blank the file — fix the specific lines the compiler named.
const fixed = cur.content; // replace with cur.content corrected for f.errors
const w = f.kind === 'component'
  ? writeProjectComponent(f.path.replace(/^components\//, '').replace(/\.tsx$/, ''), fixed)
  : f.kind === 'api'
    ? writeProjectApi(f.path.replace(/^api\//, '').replace(/\.ts$/, ''), fixed)
    : writeProjectPage(f.path.replace(/^pages\//, '').replace(/\.tsx$/, ''), fixed, { replace: true });
// VERIFY the fix LANDED before claiming it: the writer said ok AND the file on disk is the corrected
// source. ok:true from assumption (not verification) ships a broken file behind a green flag.
const landed = w.ok && readProjectFile(f.path).content === fixed;
currentTask.resolve({ path: f.path, ok: landed });
```

If the writer returns `{ ok: false }`, read `w.error` (it names a parse/contract fault), correct THAT and
write once more before resolving — re-verifying the landing the same way. The next compile pass re-checks
the whole app, so a fix that did not fully land — or exposed a further error — is caught, not shipped.
