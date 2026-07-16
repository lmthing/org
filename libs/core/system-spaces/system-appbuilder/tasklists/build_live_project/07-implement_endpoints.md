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
{ name, route, purpose, tables }: `item.name` is the stable id the plan assigned, and `item.route`
already encodes the method last (e.g. `cost-lines/GET`). `plan_tables.tables` (the real schemas being
written) is in scope — read its columns so your query and `Output` type match real data. Write the
FULL endpoint ESM module inline with the array-`join("\n")` pattern (real line breaks): it MUST export
`name` set to `item.name` VERBATIM (the stable id the page passes to `useApi` — do NOT re-derive it
from the route or transform it; without the exact match the loader rejects the whole app), a
`description`, an `Input` interface, an `Output` interface, and a default `async (input, ctx) => Output`
handler that reads/writes through `ctx.db` (`await ctx.db.query/insert/update/remove`). Every read
endpoint returns `{ items: [...] }`; keep that exact envelope even for contacts, summaries, or grouped
data, because pages consume planned endpoints as `data.items`. `writeProjectApi` returns `{ ok, error? }`
and validates the module at write time; rewrite and retry if `w.ok` is false. Emit one statement:

```typescript
const ep = item;
const name = ep.name;
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

The handler source you assemble is a self-contained ESM module, typechecked against a **NO-DOM ambient**:
there is no `console`, `window`, `fetch`, `document`, or Node global — data comes ONLY through `ctx.db`.
`w` (the `writeProjectApi` result) is `{ ok, error? }`: branch on `w.ok`, read `w.error` — never treat it
as an array or call `.length` on it.

✅ **The module source should look like this** (name verbatim, typed, reads `ctx.db`, returns `{ items }`):

```typescript
export const name = 'cost-lines';                      // === item.name, character-for-character
export const description = 'Every cost line for the trip';
export interface Input {}
export interface Output { items: any[] }
export default async function handler(_input: Input, ctx: { db: any }): Promise<Output> {
  const items = await ctx.db.query('costs');
  return { items };
}
```

❌ **Never emit any of these** — each one has burned a real build:

```typescript
export const name = 'costLines';        // ✗ re-derived / renamed from the route → loader rejects the app
console.log('built endpoint');          // ✗ Cannot find name 'console' — no DOM lib in the ambient
const rows = await fetch('/costs');     // ✗ no fetch — read through ctx.db
return { items } as const;              // ✗ orphaned `as const` on the return → typecheck fails, write lost
if (w.length) { /* … */ }               // ✗ w is { ok, error? }, not an array — use w.ok
```
