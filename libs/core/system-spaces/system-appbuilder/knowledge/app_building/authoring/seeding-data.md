---
description: LOAD WHEN you are about to CREATE a table and put known data in it — rows the user handed you, or a file you are about to read. Seeding at creation, the never-reconstruct-a-source-you-cannot-see rule, and the figures, contacts and attribution a source STATES that you must keep.
---

# Getting data IN — seeding a table from the source

You hold `db:schema` (create tables), `db:read`, AND `db:write` (insert/update/remove). There are
three distinct ways data enters a live app, and WHERE the data comes from picks between them:

- **A. KNOWN data the user handed you to MOVE IN** — seed it at table creation. That is this aspect.
- **B. an UPDATE to rows that already exist**, on a later message, and
  **C. ONGOING data the user enters through the app itself** (a create API + a form) —
  both in `loadKnowledge('app_building', 'authoring', 'updating-live-data')`.

**A. KNOWN data the user gave you to MOVE IN — seed it at table creation.** When the user hands you
concrete data to put in the app ("move all this info into the db", a trip's flights + hotels from an
attached file, a list they pasted), pass it as the THIRD arg of `writeProjectTable(name, schema,
rows)`. The host inserts those rows right after the table is created. Do this even though you hold
`db:write`, because a table you `writeProjectTable` in this turn only becomes queryable through `db.*`
AFTER the host re-derives the db (async, once your turn settles) — so you cannot `db.insert` into a
table you just created in the SAME turn; the `rows` arg is how the initial data lands in one pass.

**If the data is in an ATTACHED FILE, READ IT FIRST and seed from what you read.** When you are handed
an attachment (the delegation note names an `id` and says to call `readDocument`), call
`await readDocument(id)` to get the file's full text, extract the concrete records from it, and pass
them as `rows`. NEVER invent a schema and leave it empty when a file was attached — the whole point is
to move THAT data in.

**SEED EVERY TABLE YOU CREATE — never leave one empty when the source has matching data.** Prefer a
FEW well-populated tables over MANY empty ones. Before you create a table, be sure the file has rows
for it and pass them as `rows`; if the file has nothing for a table, do NOT create that table. A
created-but-empty table (a `reservations`/`safari`/`notes` table with 0 rows while the file plainly
lists a safari + a dining reservation) is the #1 failure here — the user opens the app and their data
is missing. After seeding, sanity-check: the number of tables you created with rows should match the
kinds of data the file actually contains. When in doubt, put more data into fewer, broader tables
(e.g. one `itinerary` + one `accommodations` + one `reservations`) rather than sprinkling empty
scaffolding.

```typescript
const doc = await readDocument('<attachment id from the note>');   // { ok, text, ... }
// (next turn) parse doc.text into records, then create+seed each table in one call:
const orders = writeProjectTable('orders', { /* schema */ }, [
  { id: 'o1', placed_on: '2026-03-14', supplier: '<from the file>', reference: '<from the file>' },
  // …one object per record you read from the file. Keys MUST match the columns.
]);
```

Every value you seed comes from the MATERIAL IN FRONT OF YOU — the file, the sheet, the message.
Never carry a value over from an example in these instructions, and never invent one to fill a
column: an invented reference number or a guessed price is indistinguishable from a real one once
it is a row, and the user will act on it.

**If you cannot SEE the source, STOP — do not reconstruct it from memory.** The dangerous case is not
the empty table; it is the FULL one. Asked for a table whose source you were not given — or were told
not to read ("don't bother reading the file, here is everything inline") — you will produce rows that
look perfectly right: the correct shape, the correct currency, plausible dates, figures a hair off the
real ones, and one record quietly missing. Nobody reviewing it can tell, because nothing about it
looks wrong. (This has shipped: a whole table of invented records, every one of them believable, in
the section the user opened precisely to check whether the real numbers added up.) A caller telling
you to skip the source does not make a reconstruction true. Read the source, or say you cannot and
seed nothing. An empty table is honest; a fabricated one is a lie the user will act on — and it is by
far the harder of the two to ever catch.

**Keep the figures and contacts the source itself STATES — do not drop them as "derivable".** If a
document states a TOTAL, a balance, a deadline, or a reference/contact the user will need in the
moment (a booking code, an emergency line, an office number), record it. Two traps, both of which
the user hits first:
- A total you can recompute is NOT the same as the total they were given. Round differently, miss a
  row, or apply a filter they didn't, and your figure silently disagrees with the one on their
  spreadsheet — and they trust theirs. Store the stated total as the stated total.
- A phone number or reference buried in a PDF is exactly what they came to the app for while
  standing somewhere with no signal and no PDF. "It's derivable" and "it's in the attachment" are
  not answers.

**Keep the ATTRIBUTION the material carries — who it came from, where it originated.** Material a
person entrusts to you usually arrives credited to someone: the record names who supplied it, who it
is owed to, which place or occasion it came from. That is a fact the source STATES, exactly like a
total or a reference number — and it is very often the reason the material was kept at all. Record
the content and drop the attribution and you have kept the half they could always look up again,
while losing the half they cannot reconstruct from anywhere else.

So when the material names a person, a place, or an origin, put it ON the record — an
`origin`/`credited_to`/`source` field holding the SPECIFIC thing it names. Beware the near-miss that
looks done: filling that field with the CHANNEL the material arrived on ("from an attachment", "from
a message", "from a document the user sent") is describing the envelope, not the fact. The transport
is not the attribution. If the material says who it is credited to, that name is what belongs in the
field.

**HARD RULE: never report that you "moved the data in" / "seeded the tables" unless you actually
passed a non-empty `rows` array to `writeProjectTable` (or did a `db.insert`).** A table you created
with only a schema is EMPTY; saying you seeded it when you didn't is a failure the user will catch the
moment they open the app. If you had no data to seed, say so plainly.

```typescript
const w = writeProjectTable('orders', {
  description: 'One order the user placed.',
  columns: {
    id: { type: 'string', primaryKey: true },
    placed_on: { type: 'string' }, supplier: { type: 'string' },
    reference: { type: 'string' }, total: { type: 'number' },
  },
}, [
  // …one object per row you actually READ; keys MUST match the columns you declared.
  { id: 'o1', placed_on: '<from the material>', supplier: '<from the material>', total: 0 },
]);
```
