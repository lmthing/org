---
id: plan_tables
output:
  tables: array
dependsOn: [plan_app, read_sources, user_stories]
role: general
functions:
  - uuid
---

Detail EVERY table `plan_app` planned into a source-grounded data model — one entry per
`plan_app.tables`, same set, no additions and no drops (membership was decided upstream where the whole
app was in view). `query`, `read_sources` (`read_sources.summary`, the build brief), `user_stories`
(`user_stories.stories` — the jobs each table must support), and `plan_app` (`plan_app.tables`, the
BINDING list) are in scope. This is still a THINKING step — no writers.

For every planned table produce its full `schema` AND the actual `rows` read from the material, so the
implement step seeds data at creation. Do NOT invent rows: use only values the source states
(identifiers, contacts, dates, payments, stated totals, attribution). And do NOT drop a value the source
DID state: if `read_sources` captured a booking reference, flight number, amount, or contact detail for a
row, put it in that row's field — a column left null when the brief has the value (a blank `flight_no`
when the notes give one, a blank `amount_usd` when the spreadsheet cell has a number) is a
parse-loss failure, the same as inventing data. `read_sources.summary` is a
convenience index, not permission to invent: if a value there conflicts with the supplied source text
or cannot be supported by the source, use the source text or omit that value. Mine the brief HARD for
each table's rows before concluding it has few — the acceptance checks in `user_stories` name the specific
data that must land. If after a genuine search a planned table truly has no rows in the material, keep
it with an empty `rows: []` and a complete schema rather than dropping it — the plan is binding — but
that should be rare; a planned table almost always has rows if you look.

Every table schema needs a `title`, a `description`, and `columns` where each column has a `type` that
is EXACTLY ONE of the five base kinds the writer accepts — `string`, `number`, `boolean`, `date`, `json`
— NEVER a TypeScript union and NEVER an array shape (no `'string | null'`, no `'string[]'`, no `'string
| number'`). `date` is for any date/time value (an ISO string on disk); `json` is for a list or any
structured value (an array of tags, a nested object) — reach for `json` instead of inventing an array
type. A column that may be absent or empty sets `required: false` (or simply omits `required` — that is
the default), and the value is just missing/null at runtime; a column that must always be present on
insert sets `required: true`. Nullability is a FLAG (`required`), never encoded in `type`. Every column
also needs a non-empty `description` — the write-time validator rejects a column with no description as
loudly as it rejects a bad `type`.

**Closed domains — set `enum` on a `string` column whose values are a small, FIXED set the source
makes explicit** (a `status` of `['paid', 'owed', 'unconfirmed']`, a `currency`, a `category`). List
EXACTLY the values the source states, spelled the way you will also seed them in `rows`, and nothing
more. `emit_types` renders an `enum` column as a string-literal UNION, so an endpoint that later
compares the column against a value the domain never had — `r.status === 'still-owed'` when the domain
is `owed` — is a COMPILE error instead of a silently-empty result (the live bug where the owed total
came back $0 because the filter and the data disagreed on one word). This makes the plan the single
vocabulary both the seeded rows and every handler share. Declare `enum` ONLY when the set is genuinely
closed and evident: an open-ended text column (a name, a note, a free-form location) has NO `enum` and
stays plain `string` — a partial or guessed domain would wrongly reject a valid value the data uses.
Make sure your own `rows` only ever use values inside a column's declared `enum`. Keys in each row object MUST match the column names, and exactly one
column is the uuid primary key.

The types are binding, not decoration: a host-run `emit_types` writes a row interface per table into
the project's `.d.ts` BEFORE any handler or page is authored — deriving each field's optionality from
`required`/`primaryKey`, not from `type` — so every downstream file is typechecked against THESE
declarations. A `type` outside the five base kinds does not degrade gracefully: the write-time validator
(`writeProjectTable` → `validateTableSchema`) throws `unknown column type "<whatever you wrote>"` and the
WHOLE TABLE silently fails to write — no rows, no schema, and every endpoint planned against it still
compiles clean and 500s at runtime. There is no other way to express "this field can be empty."

**Never author the `id` primary key in a row.** It is `generated: 'uuid'` — the SYSTEM fills it on
insert. OMIT `id` from every row object (a row that carries `id: ''` collapses the whole table onto one
empty key). The ONLY time you set an id yourself is to WIRE A RELATION where a child row must point at a
parent row you're seeding in the same pass: call `uuid()` once, keep it in a `const`, and use that value
as BOTH the parent row's `id` and the child row's foreign-key column. Emit one statement:

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
// Mint ids ONLY for rows another table references. Plain rows omit id entirely.
const arushaStayId = uuid();
currentTask.resolve({
  tables: [
    {
      name: '<source-derived table name>',
      schema: {
        title: '<Title>',
        description: '<what this table stores>',
        columns: {
          id: { type: 'string', description: 'Primary key', primaryKey: true, generated: 'uuid' },
          // …one column per field the record carries, each with a real description. `type` is ALWAYS
          // one of string/number/boolean/date/json — nullability is `required: false` (or omitted),
          // never a union or array in `type`:
          // label: { type: 'string', description: 'display name', required: true },
          // checked_in_at: { type: 'date', description: 'arrival date/time', required: false },
          // amount_usd: { type: 'number', description: 'stated cost in USD', required: false },
          // tags: { type: 'json', description: 'list of topic tags', required: false },
        },
      },
      // One object per record READ FROM THE MATERIAL. NO `id` key (the system generates it),
      // unless this row is a relation target — then set id to a minted const (e.g. `id: arushaStayId`).
      rows: [ /* { …source-derived fields } */ ],
    },
  ],
});
```
