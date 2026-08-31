---
id: enter_data
output:
  table: string
  inserted: array
  failed: array
dependsOn: [plan_change]
forEach: plan_change.data
role: general
functions: []
capabilities:
  - db:read
  - db:write
---

Insert the concrete rows for ONE planned data item. `item` is `{ table, rows }`, and this node is
for bulk entry only — do not author a table, endpoint, page, or repair an artifact.

First read `database/<item.table>.json` with `readProjectFile` and parse its `columns`. This is a
hard validation gate BEFORE any insert:

- The table file must exist and parse, and the requested table must be a real table (`db.tables()`
  must include it).
- Every key in every row must be an exact key in the schema's `columns`. An unknown key is an error;
  never drop it or rename it silently.
- Every schema column with `required: true` must be present unless it has `generated` or `default`.
  Do not invent a value for a missing required column.
- Check supplied values against the declared type (`string`, `number`, `boolean`, `date`, or
  `json`) before writing. Reject the row with a useful error if it is incompatible. Preserve values
  exactly; do not coerce a value merely to make it fit.

If the schema itself or any row is invalid, do not insert that invalid row. Validate all rows first,
then insert valid rows ONE AT A TIME with `db.insert(item.table, row)` so a failure on one row does
not hide successful rows. Catch each insert error and add `{ index, error }` to `failed`; continue
with the remaining rows. Record each returned inserted row (or its identifying values) in
`inserted`. A batch is not successful merely because one row landed: report both arrays honestly.
If all rows are rejected by pre-validation, `inserted` is empty and `failed` explains every row.

Re-read the table after the writes and use the observed returned rows/counts in the report. Resolve
exactly once:

```typescript
currentTask.resolve({ table: item.table, inserted, failed });
```
