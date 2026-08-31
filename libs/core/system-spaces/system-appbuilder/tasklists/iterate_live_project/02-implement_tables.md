---
id: implement_tables
output:
  name: string
  ok: boolean
  error: string?
dependsOn: [plan_change]
forEach: plan_change.tables
role: general
functions: []
---

Write ONE table. Your item is `{ name, purpose, existing }`.

**`existing: true` — ADD to the real schema, never replace it.** `readProjectFile('database/' +
item.name + '.json')` first and parse its `columns`. Add exactly the column(s) `item.purpose`
requires (a real TypeScript-shaped column: `type` is `string | number | boolean | date | json`,
`required`/`description` set, nullable is `required: false` — never a union or array in `type`).
Keep every existing column untouched. `writeProjectTable` takes the WHOLE schema, so call it with
the OLD columns plus the NEW ones merged into one object — passing only the new column(s) would
silently drop every column that already existed.

**`existing: false` — author a fresh schema, schema-only.** Never invent rows: concrete data entry is
handled by the sibling `enter_data` node, not by this schema writer.

```typescript
const t = item;
const cur = t.existing ? readProjectFile('database/' + t.name + '.json') : undefined;
const prevSchema = cur?.ok ? JSON.parse(cur.content) : undefined;
const schema = prevSchema
  ? { ...prevSchema, columns: { ...prevSchema.columns, /* new column(s) merged in here */ } }
  : { title: t.name, description: t.purpose, columns: { /* new schema's columns */ } };
const w = writeProjectTable(t.name, schema);
currentTask.resolve({ name: t.name, ok: w.ok, error: w.ok ? undefined : w.error });
```

If `w.ok` is false, `w.error` names the exact fault (an invalid name, a missing column description, a
bad `type`) — fix that ONE thing and write once more before resolving.
