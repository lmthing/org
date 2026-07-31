---
description: LOAD WHEN you are about to author a TABLE — its schema shape (exactly one primaryKey), and declaring hasMany/belongsTo when one table's rows belong to another's, without which `db.query(t,{include})` has nothing to expand.
---

# The table shape, and saying which rows belong to which

### DECLARE THE RELATION when one table's rows belong to another's

Real data is not a pile of flat lists: line items belong to an order, notes belong to a stop,
readings belong to a device. When you author a table whose rows each hang off a row in ANOTHER
table, say so in the schema — carry the parent's id in a column, and declare the relation on the
PARENT with `hasMany` (or on the child with `belongsTo`), naming the FK column in `via`:

```typescript
writeProjectTable('order_items', {
  description: 'A single line on an order.',
  columns: {
    id: { type: 'string', primaryKey: true },
    order_id: { type: 'string', description: 'the order this line belongs to' },  // the FK
    label: { type: 'string' }, amount: { type: 'number' },
  },
}, [/* rows */]);

writeProjectTable('orders', {
  description: 'One order the user placed.',
  columns: { /* …as above… */ },
  relations: {
    items: { hasMany: 'order_items', via: 'order_id', description: 'the lines on this order' },
  },
}, [/* rows */]);
```

A declared relation is what lets ONE query return a parent WITH its children —
`db.query('orders', { include: ['items'] })` hands back each order with its `items` array already
attached — instead of fetching the parents and then looping a query per parent (slow, and easy to
get subtly wrong). It is also what the generated `@app/types` expose to a page. If you leave it out,
every consumer has to re-derive the link by hand from a raw column, and nobody can tell from the
schema that the two tables are connected at all. So: whenever you create a child table, ask which
row it belongs to — and declare it.

## Authoring a table (when the automation stores data)

A table schema is `{ title, description, columns: { <col>: { type, description, primaryKey?, generated? } } }`.
Types: `'string' | 'number' | 'boolean' | 'date' | 'json'`. EXACTLY ONE column MUST carry
`primaryKey: true` — a `string` column with `generated: 'uuid'` (validation REJECTS a schema with
zero or two primary-key columns: `table must have exactly one primaryKey column`). Every column
needs a `description`.

```typescript
// A `tips` table: one uuid primary key + the domain columns.
const t = writeProjectTable('tips', {
  title: 'Tips',
  description: 'Story tips received or polled for the newsroom.',
  columns: {
    id:       { type: 'string',  description: 'Primary key', primaryKey: true, generated: 'uuid' },
    headline: { type: 'string',  description: 'Short headline' },
    body:     { type: 'string',  description: 'Full tip text' },
    source:   { type: 'string',  description: 'Where the tip came from' },
    status:   { type: 'string',  description: 'new | reviewed | published' },
    summary:  { type: 'string',  description: 'One-line agent summary (filled in later)' },
  },
});
display(t.ok ? 'wrote tips table' : ('table error: ' + t.error));   // check .ok — a bad schema returns { ok:false, error }
```

Once a table exists, a committed write to it auto-emits `project/db.<table>.<insert|update|remove>`
(payload = the row), and you can add a `{type:'db'}` emitter def for a curated domain event.

**Never declare the SAME event name from two defs in one project.** Every `emits` event name must
be UNIQUE across the whole project scope — a duplicate (e.g. two defs both declaring `tip.added`)
fails the ENTIRE project emitter scope to load, silently disabling every project emitter and every
`project/<event>` hook. Before adding an emitter, check the existing `events/` defs (`listProjectDir('events')`
+ read them). If a `db` emitter on `tips` already emits `tip.added`, do NOT re-emit `tip.added`
elsewhere: a cron poller that fills the same table should just `db.insert` the rows via a paired
hook (that insert re-fires the db emitter's `tip.added` for free), or emit a DIFFERENT event name.
Ground every hook in a REAL event and a REAL action — never fabricate an event address,
table, or agent action that the installed spaces do not declare. Read what an installed
space emits from the store finder's recommendation (`emits`/`actions`) or via
`storeInspect('<spaceId>')` (its `.events`/`.functions`/`.agents`).
