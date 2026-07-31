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


```typescript
currentTask.resolve({
  endpoints: [
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
