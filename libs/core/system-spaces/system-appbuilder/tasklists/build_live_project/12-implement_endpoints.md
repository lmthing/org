---
id: implement_endpoints
output:
  route: string
  name: string
  ok: boolean
dependsOn: [plan_endpoints, plan_tables, emit_types, reconcile_tables]
forEach: plan_endpoints.endpoints
role: general
functions: []
---

Write ONE typed API handler into the LIVE project's `api/`. Your endpoint is in `item` =
{ name, route, purpose, tables, fields }: `item.name` is the stable id the plan assigned, and `item.route`
already encodes the method last (e.g. `cost-lines/GET`). `plan_tables.tables` (the real schemas being
written) is in scope — read its columns so your query matches real data. **`item.fields` is the EXACT
shape of one response item (`items[0]`) — each entry is `'key: type'`.** Your `Output` item type AND the
object you actually return MUST use exactly those keys, verbatim (same names, same snake_case) — never
add, drop, or re-case one. The page reads this same `item.fields` list, so it is the single source of
truth that keeps endpoint and page in agreement. For a table-backed read the keys are the table's
columns (return the rows). For an aggregate, build one object whose keys are exactly `item.fields` and
return it as `{ items: [thatObject] }`. Write the
FULL endpoint ESM module inline with the array-`join("\n")` pattern (real line breaks): it MUST export
`name` set to `item.name` VERBATIM (the stable id the page passes to `useApi` — do NOT re-derive it
from the route or transform it; without the exact match the loader rejects the whole app), a
`description`, an `Input` interface, an `Output` interface, and a default `async (input, ctx) => Output`
handler that reads/writes through `ctx.db` (`await ctx.db.query/insert/update/remove`). Every read
endpoint returns `{ items: T[] }` where **`items` is ALWAYS an ARRAY** — keep that exact envelope even
for contacts, a grouped summary, or a single-object dashboard/aggregate, which you return as the ONE
element of the array (`return { items: [summary] };`), NEVER as a bare object (`items: {…}`) or a
scalar. Pages read every endpoint as `data.items` (and an aggregate as `data.items[0]`), so a non-array
`items` silently gives the page nothing. `writeProjectApi` returns `{ ok, error? }`
and validates the module at write time; rewrite and retry if `w.ok` is false. Emit one statement:

## Satisfy the emitted type contract

`emit_types` already wrote `types/contract.d.ts` from the plan, BEFORE this node ran, and the
project-app typecheck loads it as a GLOBAL ambient — so its types are in scope with **NO import**. For
the endpoint `item.name` it declares `<Name>Item` (one row's exact fields), `<Name>Output`
(`{ items: <Name>Item[] }`) and `<Name>Input` — `<Name>` = the endpoint name in PascalCase
(`cost-lines` → `CostLines`).

Use the declared `Output` directly, so the compiler — not a later reviewer — catches a field you
renamed, dropped or typed wrong:

```typescript
export const name = 'cost-lines';
export type Output = CostLinesOutput;   // global — no import, no path to compute
```

NEVER write `import ... from '../types/contract'` or emit any project import (`@app/runtime`,
`../types/...`) as a statement: these are AMBIENT/app modules that do not exist in your authoring VM,
so importing one is a guaranteed "Cannot find module" that means nothing about whether the app builds.
The type name alone is enough. If a name is somehow not found, the plan and `emit_types` are the source
of truth — never abandon the typed contract for an inline shape.


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
there is no `window` or `document`. `fetch`, `crypto`, `console` and the timers ARE available (an
endpoint runs in real Node, so calling an external service is legitimate) — but the PROJECT's own data
comes ONLY through `ctx.db`, never by fetching your own API.

**A handler's ONLY legal import is `import { HttpError } from '@app/runtime'`** (to throw a typed HTTP
error). Nothing else. `ctx` (and `ctx.db`) is the second FUNCTION PARAMETER, injected by the runtime —
never imported. There is no `@app/database`, no `@app/db`, no db package of any kind; inventing one is a
guaranteed "Cannot find module" and the writer will REJECT the file. The db reaches you as `ctx.db`,
full stop; the GLOBAL contract types (`<Name>Output` etc.) are already in scope with no import; and an
external service uses the global `fetch` (no import). A Node builtin (`node:crypto`, `node:util`) is
also fine — a handler runs in real Node. But anything else — a `@app/*` package, a relative helper, a
third-party dependency — the writer REJECTS: import only `@app/runtime` or a `node:` builtin.
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

✅ **An aggregate** types `Output` from `item.fields` and returns the summary as the ONE array element —
the exact keys the page will read:

```typescript
export const name = 'dashboard-summary';
export const description = 'One-object trip summary for the home page';
export interface Input {}
// item.fields was ['trip_name: string', 'grand_total_usd: number', 'paid_total_usd: number']:
export interface Output { items: { trip_name: string; grand_total_usd: number; paid_total_usd: number }[] }
export default async function handler(_input: Input, ctx: { db: any }): Promise<Output> {
  const costs = await ctx.db.query('costs');
  const grand_total_usd = costs.reduce((s: number, c: any) => s + (c.amount_usd || 0), 0);
  return { items: [{ trip_name: 'My Trip', grand_total_usd, paid_total_usd: 0 }] };
}
```

❌ **Never emit any of these** — each one has burned a real build:

```typescript
export const name = 'costLines';        // ✗ re-derived / renamed from the route → loader rejects the app
import { db } from '@app/database';     // ✗ no such module — the db is the injected ctx param; writer REJECTS
const rows = await fetch('/api/costs'); // ✗ fetch EXISTS, but never fetch your OWN api — read ctx.db (an EXTERNAL fetch is fine)
return { items } as const;              // ✗ orphaned `as const` on the return → typecheck fails, write lost
return { items: { total: 5 } };         // ✗ items must be an ARRAY — an aggregate is items: [summary]
if (w.length) { /* … */ }               // ✗ w is { ok, error? }, not an array — use w.ok
```
