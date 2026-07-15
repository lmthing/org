---
id: forget
output:
  ok: boolean
  migrated: number
  forgotten: number
dependsOn: [migrate]
goal: true
role: general
capabilities: []
---

Forget the memory keys that are now safely in the DB, so each fact has exactly one home. The
`migrate` result (`migrated`, `migratedKeys`) is in scope. This node has NO database access — it only
tidies memory. For each key in `migrate.migratedKeys`, call `forget(key)` (a synchronous built-in —
do NOT `await`). Keep a count. Emit ONE statement:

let forgotten = 0;
for (const key of migrate.migratedKeys ?? []) { const r = forget(key); if (r.ok) forgotten++; }
currentTask.resolve({ ok: true, migrated: migrate.migrated, forgotten });
