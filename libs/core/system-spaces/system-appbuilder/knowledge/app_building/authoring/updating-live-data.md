---
description: LOAD WHEN a later message changes data that already exists, or the app must COLLECT data from the user itself. Using db.* against live rows, reporting AFTER the write from its own result, and persisting engineer-authored code.
---

# Updating live rows, and the data the app collects for itself

Two of the three ways data enters a live app. The third — **A**, seeding KNOWN data the user handed
you at table creation — is `loadKnowledge('app_building', 'authoring', 'seeding-data')`, and it is
the one to read when you are creating the table rather than changing what is in it.

**B. UPDATING existing data on a LATER message.** `db` is always available to you and, once the
table exists, its verbs operate on the live rows — so on a follow-up ("record that the balance is due
on arrival", "mark that one as needing a permit", "add the booking reference to that stay") use
`db.query`/`db.update`/`db.insert` DIRECTLY against the live table. This is the whole point of
"update the db based on info I give you later" — do not build a throwaway API or a tasklist to do
what `db.update` does in one statement.

**There is no generic filesystem — `ls`/`execShell`/`readFile`/`readFileRaw` do not exist for you.**
To discover what exists, use the PROJECT-ROOTED `listProjectDir('database')` (lists the authored table
files) + `readProjectFile('database/<name>.json')` (reads a schema), and `db.query(table, …)` (reads
rows) — all project-scoped.

```typescript
// listProjectDir + db are project-scoped; db operates on the live rows. Narrate with // comments.
const tables = listProjectDir('database').entries;       // e.g. ['orders.json','order_items.json',…]
const schema = readProjectFile('database/orders.json').content;  // .content (NOT .text — that is readDocument)
const rows = await db.query('orders', { where: { reference: '<the one the user named>' }, limit: 1 });
if (rows[0]) {
  await db.update('orders', { where: { id: rows[0].id }, set: { status: '<the new value>' } });
} else {
  // No matching row? INSERT it rather than silently doing nothing.
  await db.insert('orders', { reference: '<the one the user named>', status: '<the new value>' });
}
```

**HARD RULE (updates): actually perform a `db.update`/`db.insert` — and if a target row/column is
missing, ADD it (insert a row, or `writeProjectTable` to add the column) — never report a change you
did not make.** The user opens the app to check; a "done!" with no row changed is the failure. If
`db` is genuinely unavailable (a project with no tables yet), CREATE+seed the table first with
`writeProjectTable(name, schema, rows)` — do not fabricate success.

**HARD RULE (completeness): an INSERT carries every field your current context supplies a value for —
not just the one that prompted the write.** When the user hands you a NEW item with several attributes
in the SAME message (a name, a category, a date, an identifier — whatever the row's own columns are
for), a `db.insert` that sets only the first field or two you reach for and leaves the rest of the row
blank is the same data-loss failure as an empty seed table: the value was right there in what you were
just given, and it never reached the row. Before you write, check what your current context actually
states against the table's real columns, and set every one it has a value for — leave a column blank
only when the user genuinely did not supply that value, never because you stopped after the first
field.

**Report AFTER the write, from the write's own result — never before it.** A success card you
display in one statement is a promise the NEXT statement has to keep, and if that statement dies
(a typecheck error aborts it — `Cannot find name 'saved'` is enough), you have told the user their
policy number changed when nothing changed. That is exactly what happened live: a
"✅ Car Insurance Policy Updated" callout, then `Cannot find name 'saved'`, and the row still held
the old number. So: run the `db.update`, re-`db.query` the row, and display what the row NOW says.
And declare every identifier you use in the SAME statement — a bare name you never bound (`saved`,
`savedHousehold`, `rowsUpdated`) is a typecheck error that throws your write away.

**The user's data lives in the DATABASE, not in a space's knowledge.** An update request ("the
policy number is now X") means a ROW changes: `db.query` to find it, `db.update` to change it.
Loading a space's knowledge files and finding nothing (`found: false`) is not an update, and it is
not a reason to report success — it means you looked in the wrong place. Go to the table.

**Persisting engineer-authored code.** The engineer has no way to write to the project — it drafts
and verifies code in a scratch sandbox and RETURNS it. When you are handed an engineer result to
persist (THING routes it to you as `context: { name, code }` for a project function), commit it with
the matching typed writer and check `.ok`:

```typescript
// context.name is the function identifier, context.code is the verified source.
const w = writeProjectFunction(context.name, context.code);
display(w.ok ? ('persisted function ' + context.name) : ('error: ' + w.error));
```

The same applies to any other engineer-authored artifact: a page → `writeProjectComponent`/
`writeProjectPage`, an api → `writeProjectApi`. You are the one holding the writers; the engineer is not.

**C. ONGOING user-entered data — a create API + a form.** When the user will keep adding items
through the app itself ("add a city to my itinerary", "log my bookings"), author a
`<name>-create/POST` API handler doing `await ctx.db.insert('<table>', input)` AND a page with a form
calling `useApiMutation('<name>-create')`. That insert fires your `db` emitter /
`project/db.<table>.insert` hook. A table with no insert path (neither seeded rows, an update path,
nor a create form) is a dead end — the user could never see anything in it.
