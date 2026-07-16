---
id: write_data
output:
  tables: array
  rows: number
  ok: boolean
dependsOn: [read_sources]
role: general
functions: []
---

Write the complete source-derived data model into the LIVE project. `query` and `read_sources` are
in scope. Use `writeProjectTable(name, schema, rows)` for every table so each matching source record
lands as a row at creation; never create an empty table when the source has matching data. Include the
source's identifiers, contacts, dates, payments, stated totals, and attribution. This is a bounded
write node: do not write pages or APIs here and do not rely on a value declared by an earlier model
statement. Emit exactly one self-contained statement that performs all table writes and resolves the
names and row count. Statement-local variables disappear after execution, so do not declare `writes`
in one statement and resolve it in another. Do not use an IIFE: place the synchronous writer calls
directly inside the resolved object:

```typescript
currentTask.resolve({
  tables: ['<matching table name>'],
  rows: <source-derived row count>,
  ok: [
    writeProjectTable('<source-derived table>', { title: '<title>', description: '<description>', columns: { id: { type: 'string', description: 'Primary key', primaryKey: true, generated: 'uuid' } } }, [/* source-derived rows */]),
  ].every((write) => write.ok),
});
```