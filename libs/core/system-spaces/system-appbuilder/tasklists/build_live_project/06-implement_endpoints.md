---
id: implement_endpoints
output:
  route: string
  name: string
  ok: boolean
dependsOn: [plan_endpoints, plan_tables, implement_tables]
forEach: plan_endpoints.endpoints
role: general
functions: []
---

Write ONE typed API handler into the LIVE project's `api/`. Your endpoint is in `item` =
{ route, purpose, tables }, where `route` already encodes the method last (e.g. `items-list/GET`).
`plan_tables.tables` (the real schemas being written) is in scope — read its columns so your query and
`Output` type match real data. Write the FULL endpoint ESM module inline with the array-`join("\n")`
pattern (real line breaks): it MUST export a UNIQUE string `name` (the stable id the page passes to
`useApi` — without it the loader rejects the whole app), a `description`, an `Input` interface, an
`Output` interface, and a default `async (input, ctx) => Output` handler that reads/writes through
`ctx.db` (`await ctx.db.query/insert/update/remove`). `writeProjectApi` returns `{ ok, error? }` and
validates the module at write time; rewrite and retry if `w.ok` is false. Emit one statement:

```typescript
const ep = item;
const name = ep.route.split('/')[0].replace(/[^a-zA-Z0-9]+/g, '');
const table = Array.isArray(ep.tables) && ep.tables[0] ? ep.tables[0] : (plan_tables.tables[0] ? plan_tables.tables[0].name : 'items');
const src = [
  "export const name = '" + name + "';",
  "export const description = '" + String(ep.purpose).replace(/'/g, '') + "';",
  "export interface Input {}",
  "export interface Output { items: any[] }",
  "export default async function handler(_input: Input, ctx: { db: any }): Promise<Output> {",
  "  const items = await ctx.db.query('" + table + "');",
  "  return { items };",
  "}",
].join("\n");
const w = writeProjectApi(ep.route, src);
currentTask.resolve({ route: ep.route, name, ok: w.ok });
```
