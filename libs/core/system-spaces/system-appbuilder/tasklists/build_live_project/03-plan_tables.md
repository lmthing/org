---
id: plan_tables
output:
  tables: array
dependsOn: [plan_app, read_sources]
role: general
functions: []
---

Turn the holistic table list into a DETAILED, source-grounded data model. `query`, `read_sources`
(the build brief), and `plan_app` (`plan_app.tables` is the high-level list) are in scope. This is
still a THINKING step — no writers here. For every table produce its full `schema` AND the actual
`rows` read from the material, so the implement step can seed data at creation. Do NOT invent rows: use
only values the source states (identifiers, contacts, dates, payments, stated totals, attribution). If
the source has no rows for a table, drop that table — a created-but-empty table is the #1 failure.

Every table schema needs a `title`, a `description`, and `columns` where each column has a
`description` and exactly one uuid primary key. Keys in each row object MUST match the column names.
Emit one statement:

```typescript
currentTask.resolve({
  tables: [
    {
      name: '<source-derived table name>',
      schema: {
        title: '<Title>',
        description: '<what this table stores>',
        columns: {
          id: { type: 'string', description: 'Primary key', primaryKey: true, generated: 'uuid' },
          // …one column per field the record carries, each with a real description.
        },
      },
      // One object per record READ FROM THE MATERIAL. Never carry over an example value.
      rows: [ /* { id: '…', …source-derived fields } */ ],
    },
  ],
});
```
