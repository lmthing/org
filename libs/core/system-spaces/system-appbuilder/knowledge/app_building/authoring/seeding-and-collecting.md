---
description: LOAD WHEN data has to get INTO the app — rows the user handed you to seed at table creation, data the app collects from the user through a create section, or data arriving on a schedule or an event.
---

# Getting data IN

**KNOWN data the user gave you to MOVE IN — seed it at table creation.** Pass it as the THIRD
argument of `writeProjectTable(name, schema, rows)`; the host inserts those rows right after the table
is created (a table you create in this turn only becomes queryable through `db.*` afterwards).
**Data the app COLLECTS from the user** arrives through a `create` section, whose form fields derive
from the mutation endpoint's `Input` schema — you never declare form fields. **Data that arrives on a
schedule or from an event** is a hook's job.

## Read the schema off `readProjectFile(path).content`, never the result object

To validate rows against a table, read its schema with
`const table = JSON.parse(readProjectFile('database/<name>.json').content)` — the body lives in
`content`. Passing the whole result object (`JSON.parse(readProjectFile(p))`) fails the statement's
typecheck with `Argument of type '{ ok: boolean; content: string; … }' is not assignable to
parameter of type 'string'`; always read the body off `.content` first.

## Annotate your accumulators and narrow `unknown` — your statement must typecheck on the first try

When you pair-forward rows through validation/insert loops, the ORDINARY array and `unknown` mistakes
burn a retry each — and they all fail the same way, so fix them up front:

- **`const inserted = []` and push later infers `never[]`** — the next `.push({ … })` errors
  `Argument of type '{ … }' is not assignable to parameter of type 'never'`. Declare the element
  type at the sight: `const inserted: Array<{ id: string }> = [];` (likewise `failed: Array<{ index: number; row: any; error: string }>`).
- **`for (const x of someSet)` yields `unknown` when the `Set` was built from a chained
  `.map().concat().filter()` expression** — TypeScript loses the string type and the first `.includes('[')`
  fails `is of type 'unknown'`. Build an explicitly-typed array first, then the `Set`:
  `const routes: string[] = …; const routeSet = new Set(routes);` so iteration is `string`.
- **A `catch (e)` variable and any `JSON.parse`/`any`-derived value are `unknown`** — reading a
  property or calling a string method on one fails `'x' is of type 'unknown'`. Narrow it
  (`typeof e === 'string' ? e : String(e)`) or read the field off a typed object before use.
