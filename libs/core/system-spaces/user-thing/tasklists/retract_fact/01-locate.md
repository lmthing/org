---
id: locate
output:
  table: string
  rowId: string
  grain: string
  field: string
  status: string
  candidates: string
  detail: string
dependsOn: []
goal: false
role: explore
functions: []
---

Find EXACTLY what the user wants undone — and no more. `fact` is in scope, and you have read-only
`db` (`db.tables()`, `db.query`). Two judgments, in order:

**1. The GRAIN — a whole row, or a piece within one?** Read the matching row(s) fully. If the thing
being retracted IS the row's reason to exist (a payment they never made, an item that shouldn't be
there), `grain: "row"`. If it is a piece attached to a bigger record — a remark inside a notes/text
column of a row that also holds other real data — `grain: "field"`, and set `field` to that column's
name. Retracting a remark must never take the record it was written on down with it.

**2. The MATCH — refuse to guess.** Scan the plausible table(s) and match on EVERY concrete
specific the user names (an amount, a reference, a payee, a date, the remark's wording):

- **Exactly one** row matches them all → `status: "confirmed"`, fill `table` + `rowId` (+ `field`
  when `grain` is `"field"`), and put the matched row's current values in `candidates` (one line).
- **More than one** → `status: "ambiguous"` — list each candidate (id + distinguishing values) in
  `candidates`. Do NOT pick one — not the first, not the best-looking. A row that matches on value
  but differs in any named specific is a different row.
- **None** → `status: "none"`, `candidates` = the closest rows you saw, and say in `detail` why
  nothing matched. Never guess a row you didn't actually find.

Emit ONE statement:

currentTask.resolve({ table: "<table or ''>", rowId: "<id or ''>", grain: "<row|field or ''>", field: "<column or ''>", status: "<confirmed|ambiguous|none>", candidates: "<matched/candidate rows or ''>", detail: "<what you matched, or why nothing matched>" });
