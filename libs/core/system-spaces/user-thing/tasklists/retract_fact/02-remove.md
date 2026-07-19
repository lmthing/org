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
  - db:read
  - db:write
---

Undo EXACTLY what `locate` confirmed — nothing else. The `locate` result (`status`, `table`,
`rowId`, `grain`, `field`, `candidates`, `detail`) is in scope; you hold `db:read` + `db:write` on
this node. Branch on `locate.status` first — you never choose a target yourself:

- `locate.status === "ambiguous"` — remove NOTHING. Resolve `{ ok: false, removed: 0, detail:
  'Which one did you mean? ' + locate.candidates }` so the caller asks the user to pick.
- `locate.status === "none"` — remove NOTHING. Resolve `{ ok: false, removed: 0, detail:
  locate.detail }`.
- `locate.status === "confirmed"` — branch on the grain:
  - **`locate.grain === "row"`** — hard-delete that ONE row:
    `const removed = db.remove(locate.table, { where: { id: locate.rowId } });` then re-read to
    prove it is gone AND that only one row went (`removed` must be exactly 1 — more than 1 means
    the where-clause was broader than the confirmed target; report that as a failure, never a
    success). Resolve `{ ok: removed === 1, removed, detail: '<table>: removed the row for
    <what the user retracted>' }`.
  - **`locate.grain === "field"`** — the record STAYS; only the retracted piece goes. Re-read the
    row for a `before`, then `db.update(locate.table, { where: { id: locate.rowId }, set:
    { /* locate.field: the column value with ONLY the retracted piece removed — empty if the
    piece was all it held */ } });` then re-read and CONFIRM the row still exists with its other
    columns untouched. Resolve `{ ok: true, removed: 0, detail: '<table> row: cleared the
    retracted note; the record itself is unchanged' }`.

Never report a removal that changed nothing as success, and never let an undo take more with it
than the user retracted. Emit the reads, the write, and ONE final `currentTask.resolve({...})`.
