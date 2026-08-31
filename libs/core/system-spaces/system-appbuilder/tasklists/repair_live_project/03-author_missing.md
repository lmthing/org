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

Write the module with `writeProjectApi(route, src)` where `route` is `<item.name>/<METHOD>` (`GET` for
a read, the write verb for a mutation). **Declare `Input`/`Output` as LOCAL interfaces in the file
itself — do NOT reference an ambient `<Name>Input`/`<Name>Output` global.** Those globals exist only
when `emit_types` ran as part of a fresh `build_live_project` plan; this endpoint was never in that
contract, so the global does not exist and referencing it is `Cannot find name`. A handler typed
`(input: Input, ctx: ApiCtx): Promise<Output>` against interfaces YOU declare is exactly as sound —
`ctx.db` is still typed to the real tables either way.

```typescript
export const name = 'sessions-list';               // === item.name, character-for-character
export const description = 'Upcoming class sessions';
interface Input {}
interface Output { items: { id: string; title: string; date_time: string }[] }
export default async function handler(input: Input, ctx: ApiCtx): Promise<Output> {
  const items = await ctx.db.query('class_sessions');
  return { items };
}
```

Every read endpoint returns `{ items: T[] }` — an aggregate returns its ONE summary object as
`items: [summary]`, never a bare object. A `[param]` route reads the value off `input.<param>` — there
is no `ctx.params`. A handler's only legal import is `import { HttpError } from '@app/runtime'`; no
`@app/database`, no relative import. `w = writeProjectApi(route, src)` is `{ ok, error? }` — branch on
`w.ok`, read `w.error`, fix the ONE thing it names, and rewrite.

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
