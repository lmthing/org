---
id: build_table
output:
  name: string
  ok: boolean
dependsOn: [design, create_project]
forEach: design.tables
optional: true
role: general
functions: []
---

Write ONE table's schema into the project's `database/`. Your table is in `item` =
{ name, schema }. Call `writeTableSchema` with the schema the design step produced — it already
carries `title`, `description`, `columns` (each with a description; one uuid primary key), and any
`relations`. Emit:

const t = item;
const w = writeTableSchema(t.name, t.schema);
// w = { ok, error? }. writeTableSchema validates the schema on write — if w.ok is false, read
// w.error (a missing description or a bad relation) before resolving honestly.
currentTask.resolve({ name: t.name, ok: w.ok });
