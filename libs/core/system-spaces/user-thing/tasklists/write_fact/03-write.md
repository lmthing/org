---
id: write
output:
  ok: boolean
  target: string
  detail: string
dependsOn: [classify, locate]
goal: true
role: general
capabilities:
  - db:read
  - db:write
canDelegateTo:
  - user-memory/memory
  - system-appbuilder/automator
  - "registered:*"
---

Write the fact where `classify` decided, on the row `locate` proved. `fact`, the `classify` result
(`target`, `table`, `operation`, `criteria`, `spaceKey`, `agent`, `question`) and the `locate`
result (`status`, `rowId`, `candidates`) are in scope. You hold `db:read` + `db:write` on this node
(only) — use `db.query`/`db.insert`/`db.update` for the DB path. Branch on `classify.target`
(always set) — do exactly one branch:

- **`classify.target === "memory"`** → `const m = await delegate('user-memory', 'memory', { query: 'Remember: ' + fact });`
  then resolve `{ ok: true, target: 'memory', detail: 'Saved to memory.' }`.
- **`classify.target === "db"`** → branch on `classify.operation` (always set on this path). The write
  columns are constrained to the real table schema at typecheck — pass the actual column names, never
  invented ones. Do a read → write → RE-READ so you PROVE the row landed:
  - **`classify.operation === "update"`** — this REQUIRES a row that `locate` CONFIRMED. Branch on
    `locate.status` first; you never choose a row yourself, and you never write one `locate` did not
    confirm:
    - `locate.status === "confirmed"` — re-read row `locate.rowId` for a `before`,
      `const changed = db.update(classify.table, { where: { id: locate.rowId }, set: { /* real columns, verbatim value */ } });`,
      then re-read it for an `after`. Resolve
      `{ ok: changed > 0, target: 'db', detail: '<table> row <rowId>: <before> → <after>' }`.
      A mutation that changed 0 rows is `ok: false`, never a fabricated success.
    - `locate.status === "ambiguous"` — write NOTHING. Resolve `{ ok: false, target: 'ask', detail:
      'Which row did you mean? ' + locate.candidates }` so the caller asks the user to pick.
    - `locate.status === "none"` — write NOTHING to an unrelated row. Resolve `{ ok: false, target:
      'ask', detail: "I couldn't find a row matching " + classify.criteria + '. ' + (locate.candidates ? 'Closest: ' + locate.candidates : '') }`
      so the caller confirms before anything changes. Do NOT quietly fall back to `insert` — the
      user asked to correct something they believe exists.
  - **`classify.operation === "insert"`** (the default for a newly-reported fact) — this is a NEW row
    that must MOVE any total that sums those rows. `const before = db.query(classify.table, {}).length;`,
    `db.insert(classify.table, { /* real columns, the user's value verbatim */ });`, then re-read
    `const after = db.query(classify.table, {}).length;`. **Fill the table's grouping/linkage columns,
    not just the value:** read an existing row first and populate every classification column it uses
    (a category, a group, a parent reference) with the value the fact's context implies — a row whose
    grouping columns are empty is real but INVISIBLE to every grouped view and subtotal, so the user's
    "total" never moves even though the insert landed. Resolve
    `{ ok: after > before, target: 'db', detail: '<table>: inserted a new row (<what it holds>)' }`.
  - If no table fits after all, fall back to delegating the automator to place it and report what it did.
- **`classify.target === "space"`** → if `classify.spaceKey` is set, `delegate(classify.spaceKey,
  classify.agent, { query: 'Store this fact the user told me, as knowledge tagged as from the user: '
  + fact })`; resolve `{ ok: true, target: 'space', detail: '<space> now knows it.' }`. If no space
  fits, resolve `{ ok: false, target: 'space', detail: 'No space owns this topic yet.' }`.
- **`classify.target === "ask"`** → write NOTHING; resolve `{ ok: false, target: 'ask', detail:
  classify.question }` so the caller relays the question and asks the user first.

Never fabricate a write you did not perform, and never report a write that changed nothing as `ok:
true`. Do the reads and the write as separate statements, then resolve ONCE at the end.
