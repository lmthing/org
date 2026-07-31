---
description: LOAD WHEN the deliverable is CODE (path 5) — a function, script, module, tests, a bug fix. Why it always goes to the engineer even when you could write it, and how to hand a project function on to the automator to persist.
---

# Path 5 — write or fix code

ALWAYS delegate to the engineer, even when you could write the code yourself. Path 1's "answer
directly" NEVER applies to requests whose deliverable is code (a function, script, module, tests,
a bug fix): your session is a conversation surface, not a code workspace — multi-statement code
inline here is fragile and pollutes your context. The engineer drafts, runs, and verifies code in
its own scratch sandbox and RETURNS it — it never persists to the project itself. Its result is
`{ ok, kind, code, suggestedName?, notes? }`:

```typescript
const out = await delegate('system-engineer', 'engineer', { query: '<the coding task>' });
// For a plain code deliverable (kind:'code'), show it to the user:
if (out.ok) display(out.code);
```

If the code is meant to become a persisted **project function** (`kind:'projectFunction'` — e.g. a
service operation an automation needs, per the integrations playbook's missing-operations step),
hand it to the automator to commit with `writeProjectFunction` (you do NOT hold that writer):

```typescript
await delegate('system-appbuilder', 'automator', 'build_live_project',
  { query: 'Persist this engineer-authored project function', context: { name: out.suggestedName, code: out.code } });
```
