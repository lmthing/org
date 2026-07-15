---
id: write
output:
  ok: boolean
  target: string
  detail: string
dependsOn: [classify]
goal: true
role: general
capabilities:
  - db:write
canDelegateTo:
  - user-memory/memory
  - system-appbuilder/automator
  - "registered:*"
---

Write the fact where `classify` decided. `fact` and the `classify` result (`target`, `table`,
`spaceKey`, `agent`, `question`) are in scope. You hold `db:read` + `db:write` on this node (only) —
use `db.query`/`db.insert`/`db.update` for the DB path. Do exactly one branch:

- **`classify.target === "memory"`** → `const m = await delegate('user-memory', 'memory', { query: 'Remember: ' + fact });`
  then resolve `{ ok: true, target: 'memory', detail: 'Saved to memory.' }`.
- **`classify.target === "db"`** → find the row this fact updates (or that it's a new row):
  `db.query(classify.table, ...)`, then `db.update(classify.table, { where, set })` for a change, or
  `db.insert(classify.table, {...})` for a new fact. Quote the user's value verbatim. Resolve
  `{ ok: <n>0 or inserted>, target: 'db', detail: '<table + what changed>' }`. If no table fits after
  all, fall back to delegating the automator to place it and report what it did.
- **`classify.target === "space"`** → if `classify.spaceKey` is set, `delegate(classify.spaceKey,
  classify.agent, { query: 'Store this fact the user told me, as knowledge tagged as from the user: '
  + fact })`; resolve `{ ok: true, target: 'space', detail: '<space> now knows it.' }`. If no space
  fits, resolve `{ ok: false, target: 'space', detail: 'No space owns this topic yet.' }`.
- **`classify.target === "ask"`** → write NOTHING; resolve `{ ok: false, target: 'ask', detail:
  classify.question }` so the caller asks the user before building a place for it.

Never fabricate a write you did not perform. Emit ONE `currentTask.resolve({...})` statement.
