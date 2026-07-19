---
id: compile_pass2
output:
  ok: boolean
  built: boolean
  routes: array
  offending: array
dependsOn: [compile_pass1, fix_pass1]
role: general
functions: []
---

Re-GATE the app after the first round of per-file fixes. A fix can leave a residual error, or expose a new
one in the same file, so the app is compiled AGAIN and any file still broken is routed to a second, final
fix fork. Call `buildApp()` (lint → typecheck → esbuild bundle), read the structured `{ ok, built, routes,
errors }` — the exit-status ground truth — and GROUP the errors by file into `offending` exactly as the
first pass did. Do not fix here; read and route. Emit one statement:

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

A now-clean app resolves `offending: []` and the second fix fan-out runs zero forks. Whatever remains after
the final fix round, the finalize gate re-checks authoritatively and FAILS LOUDLY rather than shipping a
broken app.
