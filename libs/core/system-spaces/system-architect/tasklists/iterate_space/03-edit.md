---
id: edit
output:
  dir: string
  agentSlug: string
  ok: boolean
  errors: string
dependsOn: [load, diagnose]
optional: false
goal: false
role: general
---

Apply the approved plan by **re-writing only the affected files** with the same per-file
builders used to synthesize a space. The builders overwrite by path, so the space stays
canonical and consistent with what a fresh synthesis would produce.

This task ALWAYS runs (no `condition:`) so downstream tasks are never silently skipped. If
`diagnose.plan` is `'no changes'`, make NO edits and resolve immediately as a clean no-op:

```typescript
const noChanges = diagnose.plan === 'no changes';
// noChanges → skip the builders below and jump straight to the resolve, passing through
//             the existing dir with ok: true (nothing was broken).
```

Available builders (all SYNC; each writes ONE file; see the synthesize_and_run build task for
full signatures): `writeAgentFile`, `writeTaskFile`, `writeKnowledgeIndex`, `writeKnowledgeOption`,
`writeFunctionFile` (typechecks on write), `writeComponentFile`.

Every builder takes the space as its first arg. Pass `load.dir` (the discovered absolute path) —
the builders accept either a bare slug or an already-resolved dir, so `load.dir` works as-is and you
never construct a path or touch `process.env`.

Steps:

1. Pass `load.dir` as the first arg to every builder.
2. Apply each change from `diagnose.plan` by calling the matching builder — e.g. rewrite the agent
   header with `writeAgentFile(load.dir, {...})`, add/replace a task with `writeTaskFile`, add a
   knowledge option with `writeKnowledgeOption`, fix a function with `writeFunctionFile` (read its
   `errors` and rewrite if not ok). If the plan needs fresh web research, run `await webSearch(...)`
   / `await webFetch(...)` FLAT at top level, ternary-guarded — never inside if/else/try/loops.
3. Re-validate (the gate):
   ```typescript
   const v = validateSpace(load.dir);
   ```
4. If `v.ok` is false, read `v.errors`, fix the offending file with the matching builder, and re-run
   `validateSpace`.

Resolve with (a no-op run is `ok: true` — the existing space is already valid):
```typescript
currentTask.resolve({
  dir: load.dir,
  agentSlug: load.agentSlug,
  ok: noChanges ? true : v.ok,
  errors: noChanges ? '' : (v.ok ? '' : v.errors.join('; ')),
});
```
