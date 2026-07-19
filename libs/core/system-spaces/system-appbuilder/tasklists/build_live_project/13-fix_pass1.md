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

You must PRESERVE the file's real content — keep every endpoint it already reads and every section it
already renders; you are correcting the fault, not wiping the file. Write with the matching typed writer
for `item.kind` and resolve the outcome honestly. Emit one statement:

```typescript
const f = item as { path: string; kind: 'page' | 'component' | 'api'; errors: Array<{ line?: number; message: string }> };
const cur = readProjectFile(f.path);
// Build `fixed` = cur.content corrected for EVERY fault in f.errors (see above). NEVER resubmit the
// same string, and NEVER blank the file — fix the specific lines the compiler named.
const fixed = cur.content; // replace with cur.content corrected for f.errors
let w: { ok: boolean; error?: string };
if (f.kind === 'component') {
  w = writeProjectComponent(f.path.replace(/^components\//, '').replace(/\.tsx$/, ''), fixed);
} else if (f.kind === 'api') {
  w = writeProjectApi(f.path.replace(/^api\//, '').replace(/\.ts$/, ''), fixed);
} else {
  w = writeProjectPage(f.path.replace(/^pages\//, '').replace(/\.tsx$/, ''), fixed, { replace: true });
}
currentTask.resolve({ path: f.path, ok: w.ok });
```

If the writer returns `{ ok: false }`, read `w.error` (it names a parse/contract fault), correct THAT and
write once more before resolving. The next compile pass re-checks the whole app, so a fix that did not fully
land — or exposed a further error — is caught, not shipped.
