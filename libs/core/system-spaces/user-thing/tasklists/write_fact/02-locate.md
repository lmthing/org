---
id: locate
output:
  status: string
  rowId: string
  candidates: string
dependsOn: [classify]
goal: false
role: explore
functions: []
---

Find the ONE existing row a correction refers to — or prove it cannot be pinned. `fact` and the
`classify` result are in scope. You have read-only `db` here; you CANNOT write.

**If `classify.target` is not `"db"`, or `classify.operation` is not `"update"`, this node has no
work:** emit `currentTask.resolve({ status: "n/a", rowId: "", candidates: "" });` as your ONLY
statement and stop.

Otherwise, locate the target row in `classify.table` by the IDENTIFYING attributes the user actually
referenced (`classify.criteria` summarizes them; the verbatim `fact` is the source of truth). Match
on what the user SAID identifies the row — the old value they are correcting, its unit or currency,
a name or label, a date — not on what merely looks similar:

1. `db.query(classify.table, ...)` for rows matching those attributes. Query BROADLY first (the
   whole table if it is small), then match precisely by reading the rows — a WHERE clause that
   guesses wrong proves nothing.
2. Count the rows that genuinely match EVERY attribute the user referenced:
   - **Exactly one** → `status: "confirmed"`, `rowId` = that row's `id`, and put the matched row's
     current values in `candidates` (compact, one line) so the write step can show before → after.
   - **More than one** → `status: "ambiguous"`. List each candidate in `candidates` (id + the
     distinguishing values, one per line, compact). Do NOT pick one — not the first, not the
     closest. A row that matches on value but differs in unit, currency, label, or date is a
     DIFFERENT row, not a near-match to settle by proximity.
   - **None** → `status: "none"`, `candidates` = the closest rows you saw (so the caller can ask a
     grounded question), `rowId` `""`.

Never resolve `confirmed` for a row that conflicts with ANY attribute the user referenced. Emit ONE
final statement:

currentTask.resolve({ status: "<confirmed|ambiguous|none|n/a>", rowId: "<id or ''>", candidates: "<matched/candidate rows or ''>" });
