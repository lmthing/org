---
description: LOAD WHEN the user STATES a fact about themselves or their data, or CHANGES one, in any language. Memory vs a DB row, why a newly-reported amount is a NEW row rather than an edit to an existing one, and why a changed value never goes to the domain space.
---

# A personal fact ("I paid $30, receipt no. A-118", "the rent is now €900")

- **No app in this project yet** → memory (path 6). It's theirs, and memory is the only home until
  an app exists.
- **An app whose schema has a place for it** → a DB row, and a **newly-reported** amount — something
  they say they just paid, spent, added, or did — goes through `await tasklist('write_fact', { fact,
  kind: 'personal' })`, NOT an inline write. The tasklist classifies insert-vs-update BY CONSTRUCTION
  (it refuses to `update` without a matched existing row) so a new payment cannot be silently folded
  into some other row, and it RE-READS to prove the row landed. That newly-reported amount is a NEW
  record: it `db.insert`s a new row, and it must MOVE any total that sums those records. Do NOT fold a
  new payment into some existing row's field just because a field for it happens to exist — a payment
  that had no prior row is a new row, and annotating an unrelated row instead leaves the total unmoved
  and the fact mis-filed. Only when they are **correcting** what a specific existing row already holds
  ("it was actually X, not Y") is it a `db.update` of that row — that narrow correction you may still
  do inline (`db.query`/`inspect` to find it first). When unsure whether a matching row even exists,
  INSPECT before you decide. Quote their value verbatim; never normalize it. Route on INTENT, in any
  language — a stated new value is a write whether it's English or Greek.
- **An app, but the value is a NEW STRUCTURED attribute the schema has no column for** — the user
  wants to start persistently tracking a specific kind of value that will RECUR (a reading, a
  reference/serial number, a per-row date, a rating) and that no column yet holds → this is an
  ADDITIVE SCHEMA change, not a `write_fact` into an existing field. A recurring structured value
  that a page or endpoint must be able to read, filter, sort, or sum earns its OWN column. You do not
  hold `db:schema`, so DELEGATE to the automator (the live-project path) to ADD the column — adding a
  column PRESERVES every existing row (it is a merge, not a rebuild) — then write the value into the
  new column. Do NOT cram such a value into a free-text `notes`/`description` field just because one
  exists: buried in prose it renders as a sentence, no view or endpoint can key off it, and the next
  occurrence of the same attribute has nowhere consistent to land. The test: a one-off remark about a
  single row → a note is fine; a value of a kind that will come again and belongs to a per-row
  attribute → it earns a column.
- **An app but no table for it** → OFFER to add one (the live-project path builds the table+page),
  then write it.

**When you build an app for a project whose facts are currently in memory**, sweep them in: after
the automator creates the tables, `await delegate('user-memory', 'memory', 'migrate_to_app_db', {
query: '<the new table(s) and what belongs in them>' })` so no personal fact is stranded in memory
while later ones become DB rows (the classic "one cost missing from the total" bug).

## A CHANGED FACT is an UPDATE — route it through `write_fact`, in EVERY language

When the user tells you something about their data is now different — a reference number was
reissued, "the rent went up to €900", "mark that invoice paid" — that is an update to a **row in the
project DATABASE**, not a space's knowledge. Do NOT locate-and-update inline: taking the first row a
query returns is how a correction lands on the WRONG row while the reply claims success. The
tasklist's locate step matches on every attribute the user referenced and refuses to guess — anything
but exactly one match comes back as a question.

```typescript
const w = await tasklist('write_fact', { fact: '<their sentence, values verbatim>', kind: 'personal' });
// w.ok === true  → relay w.detail (it shows the row and before → after).
// w.target === 'ask' → the match wasn't unique (or nothing matched): ask() the w.detail question,
//                      then act on their answer — never display-and-stop.
```

Quote the user's NEW value verbatim in `fact`; never normalize it. Only when the change needs a
NEW table or a schema/page that doesn't exist yet does it go to the **automator** — creating
tables/pages needs `db:schema`/`pages:write`, which you do not hold. Then TELL THE TRUTH: relay the
tasklist's `detail` as reported — if `ok` is false, the data did NOT change; never report "updated!"
on a write nothing can show.

Do NOT hand a data change to the domain space (`household-insurance-admin`, `pension-admin`, …).
Those spaces READ their knowledge and REPLY — their `answer` tasklist cannot write the database —
so routing an update there produces a fluent confirmation and changes NOTHING. The user is then
told his vault is updated when it is not: the worst answer we can give.

**Route on the INTENT, never on the words.** "Ανανέωσα την ασφάλιση κατοικίας — ο νέος αριθμός
συμβολαίου είναι PIR-882. Ενημέρωσε το vault." is the SAME request as its English twin and takes
the SAME path (an update to the row). Live, the English one updated the row and the Greek one
was answered in prose by the insurance space — a row that never changed. If the user states a new
value for something you are storing, in any language, it is an update.
