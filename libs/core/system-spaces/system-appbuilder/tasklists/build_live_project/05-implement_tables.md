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
missing column description, a bad relation) and fix it before resolving honestly.

**RETRY-SAFE: check before you seed.** This element can be RETRIED with a fresh fork after a prior
attempt already wrote the file (a bad resolve or a VM error on THIS element does not undo a write that
already landed). Passing `rows` again on a retry re-inserts them a second time with freshly generated
ids — a real duplicate row (seen live: a name and its record appearing twice, disagreeing with itself).
So check `listProjectDir('database').entries` FIRST: if `item.name + '.json'` is already there, this is
a retry of a write that already landed — call `writeProjectTable(item.name, item.schema)` with NO rows
(schema-only; the merge is idempotent) so nothing gets seeded twice. Only pass `item.rows` the FIRST
time this table is written. Emit one statement:

```typescript
const t = item;
const already = listProjectDir('database').entries.includes(t.name + '.json');
const w = already
  ? writeProjectTable(t.name, t.schema)
  : writeProjectTable(t.name, t.schema, Array.isArray(t.rows) ? t.rows : []);
currentTask.resolve({ name: t.name, ok: w.ok });
```
