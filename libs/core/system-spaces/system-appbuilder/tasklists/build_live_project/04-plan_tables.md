---
id: plan_tables
output:
  tables: array
dependsOn: [plan_app, read_sources, user_stories]
role: general
functions: []
---

Detail EVERY table `plan_app` planned into a source-grounded data model — one entry per
`plan_app.tables`, same set, no additions and no drops (membership was decided upstream where the whole
app was in view). `query`, `read_sources` (`read_sources.summary`, the build brief), `user_stories`
(`user_stories.stories` — the jobs each table must support), and `plan_app` (`plan_app.tables`, the
BINDING list) are in scope. This is still a THINKING step — no writers.

For every planned table produce its full `schema` AND the actual `rows` read from the material, so the
implement step seeds data at creation. Do NOT invent rows: use only values the source states
(identifiers, contacts, dates, payments, stated totals, attribution). Mine the brief HARD for each
table's rows before concluding it has few — the acceptance checks in `user_stories` name the specific
data that must land. If after a genuine search a planned table truly has no rows in the material, keep
it with an empty `rows: []` and a complete schema rather than dropping it — the plan is binding — but
that should be rare; a planned table almost always has rows if you look.

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
