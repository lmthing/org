---
id: compile_pass1
output:
  ok: boolean
  built: boolean
  routes: array
  offending: array
dependsOn: [implement_tables, implement_endpoints, implement_components, implement_pages]
role: general
functions: []
---

GATE the whole app against the REAL compiler. Every page/component/api file is now on disk, but a file
that PARSED at write time can still fail to TYPE-CHECK or BUILD — a wrong field name, a re-cased key, a
prop the component does not declare, a `console`/`window` reference, an import of a module the project
does not have, an undefined identifier. Those slips compile to nothing at write time and ship a broken
app; this node reads the PROGRAMMATIC ground truth and hands each broken file to a per-file fix fork.

Call `buildApp()` — it runs the write-time lint, the project-app typecheck (NO-DOM ambient: no
`console`/`window`; data only through `@app/runtime`), and the esbuild bundle, and RESOLVES a structured
`{ ok, built, routes, errors }`. `errors` is the exit-status ground truth (NOT a self-assessment): each is
`{ phase: 'lint'|'typecheck'|'build', file, line?, column?, message }` with `file` project-relative
(`pages/index.tsx`, `components/CostCard.tsx`, `api/items-list/GET.ts`). GROUP the errors by file into an
`offending` list — the host fans out ONE fix fork per offending file, so no fork ever holds the whole app.
Do NOT fix anything here; just read and route. Emit one statement:

```typescript
const r = await buildApp();
const byFile = new Map<string, Array<{ line?: number; phase: string; message: string }>>();
for (const e of r.errors) {
  const list = byFile.get(e.file) ?? [];
  list.push({ line: e.line, phase: e.phase, message: e.message });
  byFile.set(e.file, list);
}
const offending = [...byFile.entries()].map(([path, errors]) => ({
  path,
  kind: path.startsWith('components/') ? 'component' : path.startsWith('api/') ? 'api' : 'page',
  errors,
}));
currentTask.resolve({ ok: r.ok, built: r.built, routes: r.routes, offending });
```

A clean app resolves `offending: []` — the fix fan-out then runs zero forks and the pipeline flows
straight to the final gate. Nothing is excluded or stubbed: a file that failed is FIXED downstream, never
dropped.
