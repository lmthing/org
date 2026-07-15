---
id: locate
output:
  table: string
  rowId: string
  found: boolean
  detail: string
dependsOn: []
goal: false
role: explore
functions: []
---

Find the single row the user wants undone. `fact` is in scope, and you have read-only `db`
(`db.tables()`, `db.query`). Scan the plausible table(s) for the row that matches what they're
retracting — match on the concrete specifics they name (an amount, a receipt number, a payee, a
date). Set `found` true and fill `table` + `rowId` (the row's id/primary-key value as a string) for
the ONE best match. If nothing matches, set `found` false and explain in `detail`. Never guess a row
you didn't actually find. Emit ONE statement:

currentTask.resolve({ table: "<table or ''>", rowId: "<id or ''>", found: <true|false>, detail: "<what you matched, or why nothing matched>" });
