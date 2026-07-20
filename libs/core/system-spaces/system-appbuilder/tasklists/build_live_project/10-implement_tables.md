---
id: implement_tables
output:
  name: string
  ok: boolean
dependsOn: [plan_tables, emit_types]
forEach: plan_tables.tables
role: general
functions: []
---

Write ONE table's schema + rows into the LIVE project's `database/`. Your table is in `item` =
{ name, schema, rows }. Call `writeProjectTable(item.name, item.schema, item.rows)` so the source
records land as rows at creation — never write an empty table when `item.rows` has data. `writeProjectTable`
validates the schema on write and returns `{ ok, error? }`; if `w.ok` is false, read `w.error` (an
invalid table name, a missing column description, a bad relation) and fix it before resolving honestly.
**A table that fails to land is not a local failure**: every endpoint planned against it will still pass
the compiler (the db surface is dynamic) and 500 at runtime — so the retry below is load-bearing, and the
`name` you resolve must be the name you ACTUALLY wrote (downstream nodes wire endpoints to it).

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
if (w.ok) {
  currentTask.resolve({ name: t.name, ok: true });
} else {
  // w.error names the concrete fault. The most common: an invalid table NAME — table names are
  // snake_case identifiers (underscores), and the writer REJECTS any other shape, so a
  // hyphenated/kebab-case name never lands. Or a schema fault: a column missing its description,
  // a bad relation. Fix exactly that fault (e.g. rewrite the name in snake_case) and write ONCE more.
  const fixedName = t.name; // corrected for w.error (e.g. the snake_case form of a rejected name)
  const fixedSchema = t.schema; // corrected if w.error named a schema fault
  const w2 = already
    ? writeProjectTable(fixedName, fixedSchema)
    : writeProjectTable(fixedName, fixedSchema, Array.isArray(t.rows) ? t.rows : []);
  // Resolve the name that ACTUALLY landed — downstream nodes wire endpoints to THIS name; a stale
  // name here ships handlers that query a table that does not exist.
  currentTask.resolve({ name: fixedName, ok: w2.ok });
}
```
