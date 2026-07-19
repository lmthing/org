---
id: fix
output:
  applied: boolean
  changed: number
  before: string
  after: string
  detail: string
dependsOn: [diagnose]
condition: "diagnose.confidence == 'high'"
goal: false
role: general
capabilities:
  - db:read
  - db:write
---

Carry out exactly the correction the diagnosis settled on, then PROVE it took. The `diagnose` result
(`cause`, `table`, `targetIds`, `fixAction`, `targetValue`) is in scope; you hold `db:read` +
`db:write` on this node only. This node runs ONLY when the diagnosis was high-confidence, so there is
nothing left to decide here — do NOT re-litigate whether to act, and do NOT stop to ask. Execute the
mutation.

1. RE-READ first, so you have a real `before`: `db.query` the affected rows (and, if the complaint
   was about a total, the figure that sums them).
2. Apply the diagnosed mutation:
   - `fixAction === 'remove'` → `db.remove(diagnose.table, { where: { id: <each targetId> } })`.
   - `fixAction === 'update'` → `db.update(diagnose.table, { where: { id: <targetId> }, set: { <column>: diagnose.targetValue } })`. INTROSPECT the real column names first (`db.tables()` or a `limit: 1` query) — never guess a column; a bad column name throws.
3. RE-READ the SAME figure again for `after`, and set `applied` to whether it actually moved (rows
   changed, the figure now matches what the diagnosis expected).

Resolve `{ applied, changed: <rows mutated>, before: "<value before>", after: "<value after>",
detail: "<table + what changed>" }`. Never report a mutation that changed 0 rows as `applied: true`.
Do the reads and the write as separate statements, then resolve ONCE at the end.
