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
(`pages/index.tsx`, `components/CostCard.tsx`, `api/items-list/GET.ts`).

**The compiler has a blind spot this gate must cover mechanically: a handler that queries a table the
schema does not have.** The db surface is dynamically typed, so an api module reading a table that was
never created builds CLEAN and then 500s on every call at runtime — as broken as an unresolved import,
but invisible to `buildApp()`. So after the build, SCAN every api module's literal table references
(`db.query/insert/update/remove('<name>')`) against the tables actually in `database/`, and append a
`phase: 'gate'` error for every reference to a table that does not exist.

**Two more blind spots live on the CLIENT side (`pages/`, `components/`) and the compiler misses both.**
First — a page/component that calls `useApi`/`useApiMutation`/`apiCall` with a name that is not a real
generated endpoint: the hook validates the name client-side and silently short-circuits to an error state
WITHOUT ever issuing an HTTP request, so the page renders broken (a stale total, an empty list) with no
network trace — as broken as an unresolved import, but invisible to `buildApp()` and to a raw HTTP-status
probe. SCAN every page/component's literal `useApi(...)`/`useApiMutation(...)`/`apiCall(...)` calls
against the endpoint `name`s actually exported by `api/`, and append a `phase: 'gate'` error for every
name that does not resolve. Second — a page/component whose function RETURNS a plain `{ type, props }`
(or `{ type, props, children }`) object literal instead of JSX: that is THIS SYSTEM'S OWN
display()-descriptor shape (the chat/tasklist rendering protocol), not renderable React — it typechecks
(the return type is loose enough) but throws React error #31 ("object with keys {type, props}") at
runtime. SCAN every page/component source for a `return` of that exact descriptor shape and append a
`phase: 'gate'` error naming it. Both new scans fold into the SAME error list as the endpoint→table check,
above — a file with any of these faults is routed to the SAME per-file fix fork. Then GROUP all errors by
file into an `offending` list — the host fans out ONE fix fork per offending file, so no fork ever holds
the whole app. Do NOT fix anything here; just read and route. Emit one statement:

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

A clean app resolves `offending: []` — the fix fan-out then runs zero forks and the pipeline flows
straight to the final gate. Nothing is excluded or stubbed: a file that failed is FIXED downstream, never
dropped.
