---
id: remove
output:
  ok: boolean
  removed: number
  detail: string
dependsOn: [locate]
goal: true
role: general
capabilities:
  - db:write
---

Remove the located row. The `locate` result (`found`, `table`, `rowId`) is in scope; you hold
`db:write` on this node. If `locate.found` is false, delete NOTHING and resolve `{ ok: false,
removed: 0, detail: locate.detail }`. Otherwise HARD-delete it — `const removed = db.remove(locate.table,
{ where: { id: locate.rowId } })` — and resolve `{ ok: removed > 0, removed, detail: '<table>: removed
the row for <what the user retracted>' }`. Never report a removal that returned 0 rows as success.
Emit ONE `currentTask.resolve({...})` statement.
