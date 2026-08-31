---
id: implement_endpoints
output:
  route: string
  name: string
  ok: boolean
dependsOn: [plan_endpoints, plan_tables, emit_types, reconcile_tables, checkpoint_tables]
forEach: plan_endpoints.endpoints
role: general
functions: []
---

Write ONE typed API handler into the LIVE project's `api/`. Your endpoint is in `item` =
{ name, route, purpose, tables, fields, input? }: `item.name` is the stable id the plan assigned, and `item.route`
already encodes the method last (e.g. `cost-lines/GET`). **The plan's names are law: `item.name` is used
VERBATIM — never renamed, re-pluralised or tidied (`books-list` stays `books-list`, never `book-detail`);
a planned name you think is wrong is fixed in the plan, not silently diverged from here.**
`plan_tables.tables` (the real schemas being written) is in scope — read its columns so your query
matches real data. **`item.fields` is the EXACT
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
and validates the module at write time; rewrite and retry if `w.ok` is false. Every runtime global you
call — `writeProjectApi`, `writeProjectQuery`, `listProjectDir`, `currentTask` — is AMBIENT: already in
scope, never imported; there is no `@lmthing/*` (or any) module to import one from. Emit one statement:

## Check `item.declarative` FIRST — a declarative endpoint uses `writeProjectQuery`, never hand-written TS

If `plan_endpoints` marked this endpoint `declarative: true`, it already carries the IR fields
(`kind`, `entity`, `where`, `order`, `limit`, `include`, `compute`, `set`, `toggleField`) that
`writeProjectQuery` needs — build the query object from those SAME fields, verbatim, call
`writeProjectQuery`, resolve, and **stop — skip every section below**; the rest of this document
(the hand-written handler contract) is for the NON-declarative endpoints only.

**Two IR shapes to get right first time:** `query.route` NEVER carries the HTTP method — it is the
bare lowercase slash path, segments optionally a `[param]` (`members/list`, `members/[id]`); the
method lives only in `item.route`'s last segment, and you strip it, never carry it over. And
`include` is a list of relation NAME STRINGS declared on the entity (`include: ['comments']`) —
never an object, and never a relation the entity does not have (the rejection lists them all).

```typescript
const ep = item;
if (ep.declarative) {
  const query = {
    name: ep.name,
    kind: ep.kind,
    entity: ep.entity,
    route: ep.route.replace(/\/(GET|POST|PUT|PATCH|DELETE)$/, ''), // writeProjectQuery's route has NO method suffix
    ...(ep.where ? { where: ep.where } : {}),
    ...(ep.order ? { order: ep.order } : {}),
    ...(ep.limit !== undefined ? { limit: ep.limit } : {}),
    ...(ep.include ? { include: ep.include } : {}),
    ...(ep.compute ? { compute: ep.compute } : {}),
    ...(ep.set ? { set: ep.set } : {}),
    ...(ep.toggleField ? { toggleField: ep.toggleField } : {}),
  };
  const w = writeProjectQuery(ep.name, query);
  currentTask.resolve({ route: ep.route, name: ep.name, ok: w.ok });
}
```

`w` is `{ ok, error? }`, exactly like `writeProjectApi` — branch on `w.ok`, read `w.error` and fix the
IR (a bad `where.field`, an unknown `entity`, a `toggleField` that is not a real boolean column) and
retry; never treat it as an array. A rejected declarative endpoint is still NEVER a reason to fall back
to hand-writing it — the rejection names exactly what is wrong with the IR (`validateQueryIr`'s
messages name the real columns/tables/relations), so fix the IR object, not the strategy.

If this endpoint is NOT `declarative` (a cross-table lookup, a grouped breakdown, a date/timezone
pick, a classification label — anything the closed compute formula set cannot express), continue
reading below: it is hand-written, exactly as described.

## Satisfy the emitted type contract

`emit_types` already wrote `types/contract.d.ts` from the plan, BEFORE this node ran, and the
project-app typecheck loads it as a GLOBAL ambient — so its types are in scope with **NO import**. For
the endpoint `item.name` it declares `<Name>Item` (one row's exact fields), `<Name>Output`
(`{ items: <Name>Item[] }`) and `<Name>Input` — `<Name>` = the endpoint name in PascalCase
(`cost-lines` → `CostLines`).

Use the declared `Input` and `Output` directly, so the compiler — not a later reviewer — catches a
field you renamed, dropped or typed wrong:

```typescript
export const name = 'cost-lines';
export type Input = CostLinesInput;     // global — the route [param]s PLUS the planned body keys
export type Output = CostLinesOutput;   // global — no import, no path to compute
```

**`Input` is a REAL typed object on a write endpoint — read its fields directly.** `plan_endpoints`
declares each write's body in `input`, and `emit_types` turns that into named, typed properties, so
`input.name` and `input.waterIntervalDays` are already `string` and `number`. Do **not** re-cast it
(`const body = input as Record<string, unknown>`) and do not hand-check each key's `typeof`: the cast
throws away exactly the checking that keeps the form, the handler and the table in agreement, and it
was only ever necessary back when a body had no declared type at all. An optional key (planned with a
`?`) arrives as `string | undefined`, so a guard THERE is real work; a guard on a required one is not.

```typescript
await ctx.db.insert('plants', { id: crypto.randomUUID(), name: input.name, room: input.room });  // ✅
const body = input as Record<string, unknown>;                                                   // ✗
```

**The handler MUST be `handler(input: Input, ctx: ApiCtx): Promise<Output>` — NEVER `input: any`, NEVER
`Promise<any>`, NEVER an unannotated parameter or return.** The writer REJECTS an `any`/`Promise<any>`
boundary, and rejects a return that is not this endpoint's contract `<Pascal>Output`. This is not
style — it is the ONE thing that keeps the endpoint and the page in agreement. A handler typed
`Promise<any>` satisfies every Output type VACUOUSLY: the object you return is checked against nothing,
so if you return `{ items: [{ monthly_total }] }` while the page reads `total_monthly` (the two names
the plan's `fields` never reconciled), it compiles clean, every gate is green, and the page renders
`undefined` / "0.00" over a fully-populated database. Typing the return `Promise<Output>` makes that
exact mismatch a compile error on the `return` statement, in THIS turn. If an endpoint is genuinely
dynamic, its explicit escape is a concrete type (`Record<string, unknown>`, `{ items: unknown[] }`) —
never `any`.

### `ctx` is `ApiCtx`, and route params arrive on `input` — NOT on `ctx`

Type the second parameter `ctx: ApiCtx` — the global the contract emitted. `ApiCtx` is
`{ db, apiCall, spawn }`, and **there is deliberately no `ctx.params`**: a route `[id]` value is
assembled by the runtime onto the handler's FIRST argument, so you read `input.id`, never
`ctx.params.id` (which is a compile error, by design — it was a live 400 on every day-detail page).
Because `ctx.db` is now typed to THIS app's tables, three faults are caught the moment you write them
instead of 500ing on the first real call:

- `ctx.db.query('costs')` returns `CostsRow[]` with each column's real type. Comparing a column
  against a value outside its declared domain — `r.status === 'still-owed'` when the `status` domain
  is `paid | owed | unconfirmed` — is a no-overlap compile error (the live owed-balance-$0 defect,
  where the filter said `still-owed` but the rows stored `owed`, so every total came back $0).
- `ctx.db.query('trips')` takes a TABLE NAME. A raw SQL string (`ctx.db.query('SELECT * FROM …')`) is
  not a table name and does not compile.
- `ctx.db.query` / `insert` / `update` / `remove` are all keyed on the real tables, so a typo'd table
  or column is a compile error, not an empty result.

**Do NOT re-type a `.find`/`.filter` callback's row parameter.** `ctx.db.query('plants')` already
returns a typed `PlantsRow[]`, so the row parameter is ALREADY `PlantsRow` — annotating it yourself,
especially as `(p: Record<string, unknown>) => …`, is a genuine build failure, not a style choice:
`Record<string, unknown>` has no index signature `PlantsRow` satisfies, so `.find`/`.filter` reports
"No overload matches this call" and the write is rejected (seen live, three times in one build, always
the same annotation). Leave the parameter unannotated and let it infer, or type it explicitly as the
real row (`PlantsRow`) — never `Record<string, unknown>`, `any`, or a hand-rolled shape:

```typescript
const plant = (await ctx.db.query('plants')).find((p) => p.id === input.id);   // ✅ inferred PlantsRow
```

**Every field you compute — including a flat stats number like a total or a count — goes INSIDE the
one `items[0]` object, never beside `items` at the response root.** `return { total_count,
overdue_count, items: [...] }` compiles under a loose type and fails once `Output` is real
(`'total_count' does not exist in type '<Name>Output'`, seen live) because the contract's item type
already declares those fields — they belong on the object inside the array, alongside the row's other
fields, exactly like the aggregate example above:

```typescript
return { items: [{ total_count: plants.length, overdue_count: overdue.length, ...restOfFields }] };  // ✅
return { total_count: plants.length, overdue_count: overdue.length, items: plants };                 // ✗
```

NEVER write `import ... from '../types/contract'` or emit any project import (`@app/runtime`,
`../types/...`) as a statement: these are AMBIENT/app modules that do not exist in your authoring VM,
so importing one is a guaranteed "Cannot find module" that means nothing about whether the app builds.
The type name alone is enough. If a name is somehow not found, the plan and `emit_types` are the source
of truth — never abandon the typed contract for an inline shape.


```typescript
const ep = item;
const name = ep.name;
const Pascal = name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join('');
const table = Array.isArray(ep.tables) && ep.tables[0] ? ep.tables[0] : (plan_tables.tables[0] ? plan_tables.tables[0].name : 'items');
const param = (String(ep.route).match(/\[(\w+)\]/) || [])[1]; // e.g. 'id' for trips/[id]/GET
const src = [
  "export const name = '" + name + "';",
  "export const description = '" + String(ep.purpose).replace(/'/g, '') + "';",
  "export type Input = " + Pascal + "Input;",   // global — route [param]s + the planned body keys
  "export type Output = " + Pascal + "Output;", // global — no import, no path to compute
  "export default async function handler(input: Input, ctx: ApiCtx): Promise<Output> {",
  param
    // a [param] route reads its value off INPUT (there is NO ctx.params) and filters:
    ? "  const items = (await ctx.db.query('" + table + "')).filter((r) => r.id === input." + param + ");"
    : "  const items = await ctx.db.query('" + table + "');",
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
export type Input = CostLinesInput;                    // global
export type Output = CostLinesOutput;                  // global
export default async function handler(input: Input, ctx: ApiCtx): Promise<Output> {
  const items = await ctx.db.query('costs');           // typed CostsRow[] — no `: any` needed
  return { items };
}
```

✅ **An aggregate** types `Output` from `item.fields` and returns the summary as the ONE array element —
the exact keys the page will read. The row is already typed, so the reduce needs no `any`:

```typescript
export const name = 'dashboard-summary';
export const description = 'One-object trip summary for the home page';
export type Input = DashboardSummaryInput;
export type Output = DashboardSummaryOutput; // items: { trip_name; grand_total_usd; paid_total_usd }[]
export default async function handler(input: Input, ctx: ApiCtx): Promise<Output> {
  const costs = await ctx.db.query('costs');
  const grand_total_usd = costs.reduce((s, c) => s + (c.amount_usd ?? 0), 0);
  const paid_total_usd = costs.filter((c) => c.status === 'paid').reduce((s, c) => s + (c.amount_usd ?? 0), 0);
  return { items: [{ trip_name: 'My Trip', grand_total_usd, paid_total_usd }] };
}
```

✅ **A TOGGLE endpoint flips the value ITSELF.** Its `purpose` says TOGGLE and its `Input` carries no
new value, because the page — a spec — has no `!` and cannot send one. Read the row, store the
opposite, return the new state:

```typescript
import { HttpError } from '@app/runtime';   // the handler's ONE legal import
export const name = 'toggle-saved';
export const description = 'Toggle whether the article is saved.';
export type Input = ToggleSavedInput;    // { id: string } — the route [param], nothing else
export type Output = ToggleSavedOutput;
export default async function handler(input: Input, ctx: ApiCtx): Promise<Output> {
  const [row] = (await ctx.db.query('articles')).filter((r) => r.id === input.id);
  if (!row) throw new HttpError(404, 'no such article');
  await ctx.db.update('articles', { id: input.id }, { saved: !row.saved });
  return { items: [{ id: input.id, saved: !row.saved }] };
}
```

A handler that instead expects `input.saved` compiles clean and can never be called correctly: every
save/pin/dismiss/archive button in the app becomes a no-op. Same rule for unpin, un-dismiss, mark
unread, and "done ↔ not done".

✅ **Compute the fields the VIEW needs — the page cannot.** This endpoint is read by ONE section that
binds paths straight into its Output, with no client code. So a cross-table name, a group-by total, a
"which one is tonight's" pick, a percentage, a status label, or a boolean the row's controls depend on
is computed HERE, in this handler, and returned as a declared field:

```typescript
const travelers = await ctx.db.query('travelers');
const nameById = new Map(travelers.map((t) => [t.id, t.name]));
const rows = (await ctx.db.query('expenses')).filter((e) => e.trip_id === input.id);
const expenses = rows.map((e) => ({ ...e, paid_by_name: nameById.get(e.paid_by_traveler_id) ?? '—' }));
const byCategory = new Map<string, number>();
for (const e of expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + (e.amount ?? 0));
return { items: [{ expenses, totals_by_category: [...byCategory].map(([category, total]) => ({ category, total })) }] };
```

Leaving that to the page is not an option in this builder — there is nowhere to put it, so the value
simply never appears.

**A LIST or RECORD field returns STRUCTURED data, never a pre-formatted display string.** When the
contract types a field as `<Name>Item[]` or `<Name>Item | null` (the plan declared it with a nested
`item` shape), the handler MUST return the ROWS/object — an array of item objects, or the record (or
`null`) — and let the PAGE do the formatting. Returning `rows.map(...).join('\n')` (one display string)
is a compile error on the `return` once it is typed `Promise<Output>`, and under any looser type it
ships a page whose list renders its EMPTY state over a full database:

```typescript
export default async function handler(input: Input, ctx: ApiCtx): Promise<Output> {
  const rows = await ctx.db.query('<table>');
  const lineItems = rows                                     // ✅ structured rows — the page maps them
    .sort((a, b) => (b.date > a.date ? 1 : -1))
    .slice(0, 3)
    .map((r) => ({ label: r.label, value: r.value, date: r.date }));
  return { items: [{ lineItems }] };
}
```

❌ **Never emit any of these** — each one has burned a real build:

```typescript
export const name = 'costLines';        // ✗ re-derived / renamed from the route → loader rejects the app
export default async function handler(input: any, ctx: ApiCtx): Promise<any> { /* … */ }
                                        // ✗ `input: any` / `Promise<any>` — the vacuous escape hatch: the
                                        //   returned object is checked against NOTHING, so a response whose
                                        //   fields differ from what the page reads compiles clean and the
                                        //   page shows `undefined`/"0.00" over real data. Writer REJECTS.
                                        //   Type it `(input: Input, ctx: ApiCtx): Promise<Output>`.
return { total_monthly: t };            // ✗ a field the contract Output does not declare (page reads a
                                        //   different name) — a real compile error ONCE the return is
                                        //   `Promise<Output>`; invisible under `Promise<any>`
return { items: [{ lineItems: rows.map(fmt).join('\n') }] };  // ✗ a LIST field returned as a
                                        //   pre-formatted display STRING — the contract types
                                        //   `lineItems` as `LineItemsItem[]`, so this is a compile
                                        //   error on the return; under a loose type it ships a page
                                        //   whose list renders EMPTY over real rows (the page maps the
                                        //   array and the string is not one). Return the ROWS as
                                        //   objects; the PAGE formats each for display.
import { db } from '@app/database';     // ✗ no such module — the db is the injected ctx param; writer REJECTS
const rows = await fetch('/api/costs'); // ✗ fetch EXISTS, but never fetch your OWN api — read ctx.db (an EXTERNAL fetch is fine)
const id = ctx.params.id;               // ✗ there is NO ctx.params — the [id] value is on INPUT: input.id
await ctx.db.query('SELECT * FROM costs'); // ✗ query takes a TABLE NAME, not SQL — ctx.db.query('costs')
return { items } as const;              // ✗ orphaned `as const` on the return → typecheck fails, write lost
return { items: { total: 5 } };         // ✗ items must be an ARRAY — an aggregate is items: [summary]
if (w.length) { /* … */ }               // ✗ w is { ok, error? }, not an array — use w.ok
```
