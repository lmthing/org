---
id: plan_endpoints
output:
  endpoints: array
dependsOn: [plan_app, plan_tables, user_stories]
role: general
functions: []
---

Refine the endpoint list GROUNDED in the FULL tables that were just written, and ASSIGN each endpoint
its stable `name` — the single source of truth the whole app wires through. `query`, `plan_app`
(`plan_app.endpoints`, the binding list), `plan_tables` (`plan_tables.tables` — the full schemas +
columns + rows now in the DB), `implement_tables` (`{ name, ok }[]` — which tables actually landed), and
`user_stories` (`user_stories.stories` — the reads each story needs) are in scope. This is a THINKING
step — no writers. Plan the endpoints the pages need to read/write the real rows: at least one read
endpoint per view the app shows, and enough that every user story's data is reachable. Give each a
purpose specific enough that the implement step writes the right query against the real columns.

Each endpoint is `{ name, route, purpose, tables, fields, input? }`:
- `name` — a UNIQUE lowercase-hyphen id (e.g. `cost-lines`, `contacts-list`, `itinerary-legs`). This
  EXACT string is BOTH the endpoint module's `export const name` AND what pages pass to `useApi(...)`.
  **This is the ONLY node that assigns names; every downstream node uses them verbatim and never
  re-derives one.** No two endpoints may share a `name`, and no two may share a `route` — scan your own
  list before resolving and rename any collision.
- `route` — the file route with its HTTP method LAST (`cost-lines/GET`, `bookings/[id]/PATCH`); methods
  GET|POST|PUT|PATCH|DELETE.
- `tables` — the table name(s) it reads/writes, copied VERBATIM from `plan_tables.tables`. The whole
  contract is settled BEFORE anything is written, so `plan_tables` is the authority here; a
  host-run `validate_contract` rejects any table name it does not declare, and after the tables land
  a host-run `reconcile_tables` re-checks the contract against what actually reached disk. Do not
  invent a table name and do not re-case one — an endpoint planned against a table that never landed
  ships a handler that builds clean and 500s at runtime.
- **`input` — the EXACT keys of the request BODY**, each as `'key: type'`, exactly like `fields` but
  describing what the CALLER SENDS rather than what the endpoint answers. Suffix a key with `?` to make
  it optional (`'lastWatered?: string'`). **Do NOT list route parameters here**; `emit_types` adds those
  itself.

  **REQUIRED on any endpoint a `create` section submits to** — that is not bookkeeping, **it is what
  puts fields in a form.** A `create` section declares no fields of its own by design: the renderer
  derives every input from this endpoint's Input JSON Schema. So an omitted or empty `input` produces a
  typeless `Record<string, unknown>`, a schema with no properties, and a page that renders the words
  **"Nothing to fill in."** above a Save button — measured on the first model-built app, on web and
  native alike. The form was not broken; nothing had described what it should contain. A host-run
  `validate_contract` rejects the plan for exactly this case.

  Name the keys the way the FORM should present them and the handler should read them, and type them
  so the compiler can check the handler: `{ name: 'create-plant', route: 'plants/POST', input: [
  'name: string', 'room: string', 'waterIntervalDays: number', 'lastWatered?: string' ] }`.

  **OMIT it for an endpoint with no body**, and most writes here have none. A read (GET/DELETE) never
  carries one. Neither does an ACTION write — `plants/[id]/water-today/POST`,
  `plants/[id]/toggle-resting/PATCH` — whose only argument is the route `[param]` and whose new value
  the SERVER computes (see the toggle rule below: the page passes no value at all). Do not invent a body
  key to fill the field in; `input: []` and a made-up `'watered_at?: string'` are both worse than
  omitting it, because the handler then has a parameter no caller sends.

  **A `[param]` route declares who can call it, and that is a SILENT-SKELETON contract.** An endpoint
  whose route takes an id may be called only from a page whose OWN route declares that same `[param]`
  segment. And a section's binding for that endpoint is one of: a `$route.<param>` the PAGE's route
  actually declares, `$data.<earlierSectionId>.<field>` (output of an EARLIER section), or a literal.
  NEVER bind a bare `$.field` — that field exists only inside the query's OWN result, so the query
  waits on itself forever: the page answers with loading placeholders and issues ZERO requests, and
  every gate (typecheck, smoke render, validation) still passes because a permanent skeleton is valid
  markup.
- `fields` — the EXACT keys of ONE item in the response (`items[0]`), each as `'key: type'`. The TYPE
  half is REQUIRED and binding: a host-run `emit_types` writes these into the project's `.d.ts` BEFORE
  any handler or page is authored, so the compiler — not a later reviewer — is what catches a field
  the page reads at the wrong type. Use real TypeScript (`string`, `number`, `boolean`, `string[]`,
  `string | null`), never a vague `any`. This is the
  SINGLE SOURCE OF TRUTH for the response shape: `implement_endpoints` emits exactly these keys and
  `implement_views` binds exactly these keys — so the two never disagree on a name. For a table-backed
  read, list the real `plan_tables` column names you return (snake_case, verbatim — do NOT re-case them
  to camelCase). For an aggregate/dashboard, list the computed keys you invent (still the exact strings
  the page will read). Every field a page needs must appear here. When a user story asks for a single
  RUNNING TOTAL — "how much am I paying", one figure that spans several tables — plan exactly ONE
  dedicated aggregate endpoint whose `tables` lists EVERY table that total draws from (not one of them),
  so it computes the whole figure in a single query. It is the one number the app shows AND the number
  THING reads back; two endpoints each covering part of the span give two answers that drift.
- **A field that carries a LIST the page renders as rows/cards, or a structured RECORD the page reads
  keyed sub-fields off of, MUST be typed STRUCTURALLY — an array/object of a NAMED item shape, NEVER a
  pre-formatted display `string`.** Declare its item shape inline with an `item` array (each entry a
  `'subkey: type'`), and mark a LIST with `list: true` and a maybe-absent RECORD with `nullable: true`:
    - `{ name: 'lineItems', list: true, item: [ 'label: string', 'value: number', 'date: string' ] }`
    - `{ name: 'latest', nullable: true, item: [ 'label: string', 'date: string' ] }`
  `emit_types` turns each into a named interface the page MAPS/reads with real field types
  (`lineItems: LineItemsItem[]`, `latest: LatestItem | null`). The ENDPOINT returns the
  structured rows/object; the PAGE does the formatting. A plain `'key: string'` field is ONLY for a
  genuine SCALAR the page prints verbatim (a title, a single status word) — the moment the page would
  `.map` a field or read `.someKey` off it, that field is a list/record and needs an `item` shape. Typing
  list data as a pre-formatted `string` (a `join('\n')`) is the defect that ships a page whose every row
  renders its EMPTY state over a full database: the handler returns display text, the page tries to treat
  it as data (and often `JSON.parse`s it — which throws on the text and silently falls back to `[]`), and
  the compiler cannot see the mismatch because both sides just call it `string`.

Read endpoints return `{ items: [...] }` (an aggregate is the single summary at `items[0]`), so plan
read endpoints the pages consume as `data.items`.

## Mark the PLAIN endpoints declarative — they get a GENERATED handler, not a hand-written one

Most endpoints in a typical app are a plain filtered/sorted list, a get-by-id, a straightforward sum/
count/avg aggregate, a create, an update, a **delete**, or a toggle — with NO cross-table lookup, NO
grouped breakdown, NO date/timezone-based pick, and NO classification label. **Every ordinary DELETE
MUST be declarative with `kind: 'delete'`**: do not leave it for a hand-written handler merely because it
is destructive. It has no body and no `set`; its `[id]` route segment (or a declarative `where` clause)
identifies the row. Only an explicitly required operation the query IR cannot express belongs on the
bespoke path. For exactly those, add
`declarative: true` plus the IR fields below; `12-implement_endpoints` then calls `writeProjectQuery`
instead of hand-writing a TS module, and the handler is GENERATED straight from this same plan — it
cannot disagree with its own contract, so the handler↔contract mismatches this file spends most of its
words guarding against (an invented field, a re-cased column, a body key nothing sends) stop being
possible for these endpoints. Keep every OTHER endpoint (cross-table lookups, grouped totals, date
picks, labels — everything §"ONE SECTION, ONE ENDPOINT" above describes) on the existing hand-written
path; the declarative IR cannot express them and must not be forced to.

```typescript
{
  name: 'jobs-list', route: 'jobs/list/GET', purpose: 'Open jobs, newest first',
  tables: ['job'], fields: [ 'id: string', 'status: string', 'hours: number' ],
  declarative: true,
  kind: 'list', entity: 'job',                              // the database/<entity>.json table
  where: [ { field: 'status', op: 'in', input: 'status', default: ['quoted', 'in-progress'] } ],
  order: [ { field: 'createdAt', dir: 'desc' } ],
  limit: 50,
}
{
  name: 'dashboard-stats', route: 'jobs/dashboard-stats/GET', purpose: 'Counts for the dashboard',
  tables: ['job'], fields: [ 'openCount: number', 'totalHours: number' ],
  declarative: true,
  kind: 'aggregate', entity: 'job',
  where: [ { field: 'status', op: '!=', value: 'done' } ],  // filters BEFORE the aggregate reduces
  compute: { openCount: { count: '' }, totalHours: { sum: '$hours' } },
}
{
  name: 'toggle-collected', route: 'jobs/[id]/collect/PATCH', purpose: 'Flip whether the job was collected',
  tables: ['job'], fields: [ 'id: string', 'collected: boolean' ],
  declarative: true,
  kind: 'toggle', entity: 'job', toggleField: 'collected',   // no value in Input — the handler flips it
}
```

### Create/update/deletion IR — `set` is a column map, never a flat request body

A declarative **create** or **update** MUST carry `set`: its keys are real table COLUMNS, and each
value says whether that column comes from the request (`{ input: '<Input key>' }`) or is a literal
(`{ value: <literal> }`). Copy this shape exactly; do NOT write `set: { name: input.name }`, and do
NOT put an object such as `{ id: ... }` in `where` (a query `where` is an ARRAY of clauses).

```typescript
// POST /jobs — Input has status; hours is always initialized to the literal 0
{ name: 'job-create', route: 'jobs/POST', tables: ['job'], input: ['status: string'], fields: ['id: string', 'status: string'],
  declarative: true, kind: 'create', entity: 'job',
  set: { status: { input: 'status' }, hours: { value: 0 } } }

// PATCH /jobs/[id] — [id] identifies the row; only status comes from Input
{ name: 'job-update', route: 'jobs/[id]/PATCH', tables: ['job'], input: ['status: string'], fields: ['id: string', 'status: string'],
  declarative: true, kind: 'update', entity: 'job',
  set: { status: { input: 'status' }, hours: { value: 0 } } }

// DELETE has NO `set`: identify its row with [id] (or a where CLAUSE ARRAY).
{ name: 'job-delete', route: 'jobs/[id]/DELETE', tables: ['job'], fields: ['id: string'],
  declarative: true, kind: 'delete', entity: 'job' }
```

The `hours` literal above is illustrative: substitute only columns that really exist in `plan_tables`. A delete
has no request body and no set map. The route parameter is not included in `input`; the query writer
gets it from `[id]`.


**A toggle that ALSO needs to stamp a companion field on the SAME flip is STILL declarative — this is
not the signal to hand-write it.** Give that column a `set` entry shaped `{ whenTrue, whenFalse }`
(`"now"` = current timestamp, anything else a literal) — never `{ input }`/`{ value }` for this, since
those have no "which direction did it flip" to key off of:

```typescript
{
  name: 'job-toggle-collected', route: 'jobs/[id]/collect/PATCH',
  purpose: 'Flip collected; stamp collectedDate when collecting, clear it when un-collecting',
  tables: ['job'], fields: [ 'id: string', 'collected: boolean', 'collectedDate: string | null' ],
  declarative: true,
  kind: 'toggle', entity: 'job', toggleField: 'collected',
  set: { collectedDate: { whenTrue: 'now', whenFalse: null } },
}
```

The declarative IR shape (`kind`/`entity`/`where`/`order`/`limit`/`include`/`compute`/`set`/
`toggleField`) is `writeProjectQuery`'s own parameter — its TYPE is in your ambient DTS
(`declare function writeProjectQuery`), so read that signature for the exact field names and the
`where` op set (`= != in not-in gt gte lt lte contains is-null not-null`) rather than guessing. `compute`
is a closed formula AST over `add sub mul div min max round coalesce` (arithmetic) and
`sum count avg first` (aggregation over a row's `include`d relation, or — inside an `aggregate` — over
the whole filtered set); it is NOT TypeScript, and a formula that does not fit this set (a cross-table
lookup, a grouped breakdown, a conditional label) is exactly the signal to leave the endpoint OFF this
declarative path and hand-write it in `12-implement_endpoints` instead.

## ONE SECTION, ONE ENDPOINT — shape the endpoint for the view that reads it

Pages in this app are SPECS, not code: a section names ONE endpoint and binds paths (`$.title`,
`$.paidByName`) into its Output. There is no client-side glue — no `.map`, no `.filter`, no join
across two responses, no `? :`. **So every value a section shows must be a field on that section's
ONE endpoint.** Plan for that here, because a later node cannot invent it:

- **A value that comes from another table is a FIELD on this endpoint, not a second call.** A row
  showing "paid by Ana" means `list-expenses` returns `paid_by_name` on each row (one lookup in the
  handler), NOT the page calling `list-travelers` and matching ids.
- **A total, a breakdown, or a group-by is a COMPUTED FIELD.** "By category" and "by payer" strips are
  `totals_by_category` / `totals_by_payer` on the SAME endpoint that returns the rows (declare each
  with a nested `item` shape, per the rule above), not client reductions.
- **A total the brief DEFINES arithmetically must compute what the brief said — every term of it.**
  When the request states a rule ("labour is £45/hour; a job's total is labour PLUS the parts fitted
  to it"), write the terms into the field's description and check the plan against them one by one. A
  field that silently drops a term is the worst failure class here, because nothing downstream can
  catch it: the shape is right, the type is right, every gate is green, the page renders a confident
  number — and it is wrong. The bike-shop build shipped a job total of £70.49 that was the parts
  alone; the labour the brief had priced in the same sentence was simply missing.
- **A selection — "tonight's meal", "the next appointment", "the winning option" — is a computed
  field.** The client cannot pick; the handler picks. When the pick depends on today's date, take the
  client's IANA timezone as an Input field (`tz: string`) and compute server-side.
- **A label, a status word, a percentage, a threshold classification is a computed field.**
  `adherence_pct`, `status_label`, `health_label`, `severity` — anything a page would otherwise
  compute with an `if` or a ternary. There are no conditionals in a spec.
- **A "blocked/enabled/pending" flag a row's controls depend on is a computed BOOLEAN field**
  (`pollable: boolean`), because a bound boolean is how a spec disables a control.
- **An embedded array is fine and PREFERRED** — a detail endpoint returning `sources`, `doses`,
  `citations`, `days` lets several sections read one response instead of one endpoint per array.
  Declare it with its nested `item` shape.

Fewer, richer endpoints is the right answer here. An endpoint whose `fields` cover its section's whole
display is a section that renders; one that covers half of it is a section that renders half-blank, and
a host-run `validate_contract` will reject the design and send it back to THIS node.

## Toggles are ENDPOINTS — plan the flip server-side

The spec language has **no `!`**. A page cannot send "the opposite of what is showing". So every
save / unsave, pin / unpin, dismiss, archive, mark-read, done / not-done, enable / disable **must be
an endpoint that FLIPS the stored value itself** when the new value is omitted from the Input. Plan
each one that way, and say so in its `purpose` — if you plan it as "set `saved` to the value the page
passes", the page has no way to pass one and the feature ships dead. This applies to every toggle in
every generated app; it is the single most common way a spec app breaks.

```typescript
// ✅ a toggle endpoint: no `saved` in Input — the handler reads the row and stores the opposite
{ name: 'toggle-saved', route: 'articles/[id]/save/PATCH', purpose:
    'TOGGLE: flip the article\'s saved flag server-side (no value in Input — read the row, store !saved)',
  tables: ['articles'], fields: ['id: string', 'saved: boolean'] }

// ❌ the page cannot express this — there is no way to send "not saved"
{ name: 'set-saved', route: 'articles/[id]/save/PATCH', purpose: 'set saved to the supplied boolean', … }
```

A non-toggle write (a rating, a chosen option, a typed note) DOES take its value — that is a `field`
control sending a real value, not a negation. Only the flip-what-is-there cases go server-side.

Emit one statement:

## If you are being RE-RUN (`feedback` is in scope)

A host-run `validate_contract` cross-checked the whole design and REJECTED it, so this node is running
again with `feedback` bound to its `errors` (and `attempt` to the pass number). Each entry is
`{ node, ref, message }`: `node` is which design node must change, `ref` is the exact offending
reference, `message` says what broke AND names the real options.

Read every entry that names THIS node and fix precisely that — do not redesign what was not faulted,
and do not re-emit the same reference and hope. An entry naming a different node is context: it tells
you what the rest of the contract must line up with. If `feedback` is not in scope, this is the first
pass; ignore this section.


**The declarative fields (`declarative`/`kind`/`entity`/`where`/`order`/`limit`/`include`/`compute`/
`set`/`toggleField`) belong on the SAME endpoint object you resolve here — they are NOT a separate pass,
NOT a comment, NOT something you work out and then drop.** If your own reasoning above concluded an
endpoint is declarative, the object you put in `endpoints: […]` below MUST carry `declarative: true`
plus its IR fields — an endpoint you decided was declarative but resolved WITHOUT those fields is
IDENTICAL, to every downstream node, to one you never considered declarative at all; the decision only
counts if it is on the object.

```typescript
currentTask.resolve({
  endpoints: [
    // A PLAIN endpoint — declarative. The IR fields ride on THIS SAME object, not a separate one.
    {
      name: 'jobs-list', route: 'jobs/list/GET', purpose: 'Open jobs, newest first',
      tables: [ 'job' ],
      fields: [ 'id: string', 'status: string', 'hours: number' ],
      declarative: true,
      kind: 'list', entity: 'job',
      order: [ { field: 'createdAt', dir: 'desc' } ],
    },
    // A BESPOKE endpoint — cross-table lookup / grouped breakdown / date pick / label. No `declarative`
    // key at all (never `declarative: false` — simply omit it), so `implement_endpoints` hand-writes it.
    {
      name: '<unique-hyphen-id>',
      route: '<path>/GET',
      purpose: '<what it returns or does>',
      tables: [ '<table from plan_tables.tables>' ],
      // Exact keys of items[0], verbatim — snake_case table columns for a list, computed keys for an aggregate:
      fields: [ 'id: string', 'amount_usd: number', '<real column or computed key>: <type>' ],
    },
  ],
});
```
