---
id: implement_tables
output:
  name: string
  ok: boolean
dependsOn: [plan_tables]
forEach: plan_tables.tables
role: general
functions: []
---

Write ONE table's schema + rows into the LIVE project's `database/`. Your table is in `item` =
{ name, schema, rows }. Call `writeProjectTable(item.name, item.schema, item.rows)` so the source
records land as rows at creation — never write an empty table when `item.rows` has data. `writeProjectTable`
validates the schema on write and returns `{ ok, error? }`; if `w.ok` is false, read `w.error` (a
missing column description, a bad relation) and fix it before resolving honestly. Emit one statement:

```typescript
const t = item;
const w = writeProjectTable(t.name, t.schema, Array.isArray(t.rows) ? t.rows : []);
currentTask.resolve({ name: t.name, ok: w.ok });
```
