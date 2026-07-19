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
errors }` — the exit-status ground truth — then RE-RUN the mechanical endpoint→table scan exactly as the
first pass did (the compiler cannot see a handler querying a table that does not exist — the db surface is
dynamic, so it builds clean and 500s at runtime; and a first-round fix may itself have re-pointed a query
at a wrong name). Append a `phase: 'gate'` error per unresolved table reference, and GROUP all errors by
file into `offending`. Do not fix here; read and route. Emit one statement:

```typescript
const r = await buildApp();
const gateErrors: Array<{ file: string; line?: number; phase: string; message: string }> = r.errors.map((e) => ({ file: e.file, line: e.line, phase: e.phase, message: e.message }));
// Mechanical endpoint→table check: every literal table an api module touches must exist in database/.
const tableNames = (listProjectDir('database').entries || []).filter((n) => n.endsWith('.json')).map((n) => n.replace(/\.json$/, ''));
const walk = (listProjectDir('api').entries || []).map((n) => 'api/' + n);
while (walk.length) {
  const p = walk.shift() as string;
  if (!p.endsWith('.ts')) { for (const c of listProjectDir(p).entries || []) walk.push(p + '/' + c); continue; }
  const src = readProjectFile(p).content || '';
  const ref = /\bdb\s*\.\s*(?:query|insert|update|remove)\s*\(\s*['"`]([A-Za-z0-9_-]+)['"`]/g;
  for (let m = ref.exec(src); m; m = ref.exec(src)) {
    if (!tableNames.includes(m[1])) gateErrors.push({ file: p, phase: 'gate', message: 'references table "' + m[1] + '" which does not exist in database/ (have: ' + (tableNames.join(', ') || 'none') + ') — builds clean but 500s at runtime, exactly like an unresolved import' });
  }
}
const byFile: Record<string, Array<{ line?: number; phase: string; message: string }>> = {};
for (const e of gateErrors) {
  const list = byFile[e.file] || [];
  list.push({ line: e.line, phase: e.phase, message: e.message });
  byFile[e.file] = list;
}
const offending = Object.entries(byFile).map(([path, errors]) => ({
  path,
  kind: path.startsWith('components/') ? 'component' : path.startsWith('api/') ? 'api' : 'page',
  errors,
}));
currentTask.resolve({ ok: r.ok && offending.length === 0, built: r.built, routes: r.routes, offending });
```

A now-clean app resolves `offending: []` and the second fix fan-out runs zero forks. Whatever remains after
the final fix round, the finalize gate re-checks authoritatively and FAILS LOUDLY rather than shipping a
broken app.
