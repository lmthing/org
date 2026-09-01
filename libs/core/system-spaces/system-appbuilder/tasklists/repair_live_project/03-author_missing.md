---
id: author_missing
output:
  kind: string
  name: string
  ok: boolean
dependsOn: [diagnose, fix_broken]
forEach: diagnose.toAuthor
role: general
functions: []
---

Author ONE thing that is referenced but was never written — `item` = `{ kind, name, hint }`. `kind` is
`'endpoint' | 'page' | 'table' | 'automation'`; `hint` is the diagnostic that found it missing (an
error message, or a planned artifact's own failure reason). There is no plan to consult — gather
context by READING the live project (`listProjectDir`/`readProjectFile` on `views/`, `api/`,
`database/`), the same way you would investigate a codebase you did not write.

**`kind: 'endpoint'`.** Find who calls it — grep the pages: read every `views/*.view.json` and look for
a section whose `query`/`mutation` equals `item.name`. That section's `id`, its bound
`$.field`/`item`/`keyvalue` paths, and any `input`/`param` it sends tell you exactly what fields the
Output needs and what the Input takes. Read `database/*.json` for the real table(s) it should query.

Author a declarative query with `writeProjectQuery(item.name, query)`. Infer the real `entity`, route,
kind, fields, and declared relations from the live tables and callers. The query route has no HTTP
method suffix. Every read returns generated `{ items: [...] }`; a `[param]` route names the selected
row. Parent/child data uses a declared `include` relation and row `compute`, never a handler join.

```typescript
const w = writeProjectQuery('sessions-list', {
  kind: 'list', entity: 'class_sessions', route: 'sessions',
  order: [{ field: 'date_time', dir: 'asc' }],
});
```

If the required behavior cannot be expressed by the query IR, resolve `ok: false` with the missing
capability; never author a TypeScript endpoint.

**`kind: 'page'`.** Read 1-2 sibling pages already on disk (`listProjectDir('views')`,
`readProjectFile` each) for the section-shape/style this app already uses, and read `database/*.json`
for what data exists. Write `writeProjectView(item.name, spec)` with `{ route: item.name, title?,
sections: [...] }` — the twelve section kinds are `list detail create stats markdown chat toolbar
timeline board calendar chart outlet`. A section's `query`/`mutation` must name a REAL endpoint
already on disk (`listProjectDir('api')`) — if the page you are authoring needs one that is not there
yet, that is a SEPARATE `kind: 'endpoint'` job; author the endpoint first (in this same turn, in an
earlier statement) or leave the section out rather than naming an endpoint that does not exist. The
writer validates against disk, not a plan, and names every real endpoint in its rejection if you get a
name wrong.

**`kind: 'table'` / `kind: 'automation'`.** These are rare — `item.hint` almost always names exactly
what was planned. For a table, write its schema with `writeProjectTable(name, schema)` (schema only;
never invent rows — seeding is a separate, targeted `db.insert` job, not this one). For an automation,
write `hooks/<slug>.ts` exporting a `type:'cron'` or `type:'event'` handler that reads/writes real
tables through `db`. If `item.hint` does not give you enough to author either safely, resolve
`ok: false` and say so — inventing a schema or a trigger nobody asked for is worse than leaving it
unauthored.

**`ok` is a REPORT.** Resolve `ok: true` only when the writer's result was consumed (`w.ok === true`)
and you verified the file is really there (`readProjectFile`/`listProjectDir`). Build nothing across
statements — declare and use `w` in the SAME statement that writes it, exactly as `02-fix_broken.md`
warns.
