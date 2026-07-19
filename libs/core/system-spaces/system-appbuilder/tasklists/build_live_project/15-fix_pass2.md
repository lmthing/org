---
id: fix_pass2
output:
  path: string
  ok: boolean
dependsOn: [compile_pass2, plan_pages, plan_endpoints, plan_components, plan_tables, implement_components]
forEach: compile_pass2.offending
role: general
functions: []
---

Fix ONE file that is STILL broken after the first fix round — the file in `item` = `{ path, kind, errors }`
(`kind` is `'page'|'component'|'api'`; `errors` is the exact remaining `{ line?, phase, message }` list from
the real compiler for THIS file). This is the final correction pass, run once per still-offending file. In
scope: `item`, `plan_endpoints`, `plan_components`, `plan_pages`, `plan_tables`, and `implement_components`
(the landed-components ok-list).

READ the file — `readProjectFile(item.path).content` — and build a corrected source that resolves EVERY
error `item.errors` names, grounded in the real endpoints/components/schema (never a guess, never a blanked
file): wrong/re-cased field → read the endpoint's `fields` verbatim off `data.items`/`data.items[0]`; a prop
the component does not declare or has no data → match `plan_components` props, drop unfed markup rather than
hardcode; a bad import (`react-router`/`@radix-ui`/relative `use-api`) or non-exported `@app/runtime` name →
import only the real `@app/runtime` exports or drop it; a component not in the `implement_components` ok-list
→ remove the import and render inline; `console`/`window` → remove; a demanded null-guard → coalesce first.
Preserve every endpoint and section the file already has. Emit one statement:

```typescript
const f = item as { path: string; kind: 'page' | 'component' | 'api'; errors: Array<{ line?: number; message: string }> };
const cur = readProjectFile(f.path);
const fixed = cur.content; // replace with cur.content corrected for EVERY fault in f.errors
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

If the writer returns `{ ok: false }`, read `w.error`, correct that specific fault, and write once more. The
finalize gate re-checks the whole app authoritatively: anything still broken is surfaced as a failed build,
never silently shipped.
