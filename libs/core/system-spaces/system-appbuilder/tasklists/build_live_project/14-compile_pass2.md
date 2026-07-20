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
errors }` — the exit-status ground truth — then RE-RUN the mechanical scans exactly as the first pass did
(a first-round fix may itself have re-pointed a query at a wrong table, invented a `useApi` name, or left a
`{ type, props }` descriptor return in place): the endpoint→table scan (the compiler cannot see a handler
querying a table that does not exist — the db surface is dynamic, so it builds clean and 500s at runtime),
the page→endpoint scan (a `useApi`/`useApiMutation`/`apiCall` name with no matching generated endpoint
silently short-circuits to an error state with NO network request), and the render-correctness scan (a
page/component that RETURNS this system's own `{ type, props }` display()-descriptor shape instead of JSX
typechecks clean but throws React error #31 at runtime). Append a `phase: 'gate'` error per miss, and GROUP
all errors by file into `offending`. Do not fix here; read and route. Emit one statement:

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
    if (!endpointNames.includes(m[1])) gateErrors.push({ file: p, phase: 'gate', message: 'calls useApi/useApiMutation/apiCall("' + m[1] + '") which is not a generated endpoint name (have: ' + (endpointNames.join(', ') || 'none') + ') — useApi silently short-circuits to an error state with NO network request, exactly like an unresolved import' });
  }
  const descriptorRef = /\breturn\s*\{\s*type\s*:\s*(?:'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)\s*,\s*props\s*:/;
  if (descriptorRef.test(src)) gateErrors.push({ file: p, phase: 'gate', message: 'returns a plain { type, props } object literal instead of JSX — that is this system\'s OWN display()-descriptor shape (the chat/tasklist protocol), not renderable React; it typechecks clean but throws React error #31 at runtime. Return real JSX (`<div>…</div>`), never `{ type, props }`.' });
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
