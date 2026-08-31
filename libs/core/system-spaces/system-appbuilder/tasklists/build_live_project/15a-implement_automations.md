---
id: implement_automations
output:
  slug: string
  ok: boolean
dependsOn: [plan_automations, plan_tables, reconcile_tables]
forEach: plan_automations.automations
role: general
functions: []
---

Write ONE automation into the LIVE project's `hooks/`. Your automation is in `item` =
`{ slug, story, kind, run, purpose, every?, daily?, on?, reads, writes, trigger? }`. `plan_tables.tables`
(the real schemas already on disk — read its `columns` so your handler writes the EXACT column names)
is in scope. `reconcile_tables` has already landed every table, so `database/*.json` is on disk and the
writer checks your hook against it at write time. This node runs ONCE PER automation; when
`plan_automations` emitted `[]` (the common case) it runs ZERO times and NOTHING is written — that is
the correct skip, and the rest of the pipeline is unaffected.

Author the hook with `writeProjectHook(item.slug, src)`, which writes `hooks/<item.slug>.ts`. Assemble the
FULL hook module inline with the array-`join("\n")` pattern (real line breaks). A hook file must
`export default` a plain OBJECT whose `type` is `'cron'` or `'event'` — never a function or bare value.
`writeProjectHook` returns `{ ok, error? }` and validates at write time (parse, hook shape, and — for a
`db.insert`/`db.update` — that every column exists, and — for an event on `project/db.<table>.<event>` —
that the table exists); branch on `w.ok`, read `w.error`, correct THAT, and write once more before
resolving. Every runtime global you call (`writeProjectHook`, `currentTask`) is AMBIENT — already in
scope, never imported; there is no `@lmthing/*` module (and the hook itself imports nothing project-side:
`db` arrives as the handler's parameter). Emit one statement.

## The two shapes, by `item.kind` + `item.run`

**A deterministic job (`run: 'handler'`) — the default.** The `handler` is plain Node code run in-proc:
NO agent, NO LLM. It receives `{ db, input, delegate }` and does the work itself.

- `kind: 'cron'` → set exactly the cadence the plan gave (`every: item.every` OR `daily: item.daily`) and
  a `handler`. The handler reads its `item.reads` tables with `await db.query('<table>')`, computes, and
  writes its `item.writes` tables with `await db.insert('<table>', { …real columns })` /
  `await db.update('<table>', { where: { … }, set: { …real columns } })`.
- `kind: 'event'` → set `on: { event: 'project/db.' + item.on.table + '.' + item.on.event }` and a
  `handler`. `ctx.input` IS the written row (for a `project/db.<table>.insert` subscription), so read
  `input.<column>` and react — enrich the row, or write a derived row into `item.writes`.

**An agent job (`run: 'agent'`) — only when a model turn is genuinely needed.** Declare `trigger:
item.trigger` (a `'space/agent#action'` string) INSTEAD of a `handler`, plus a `budget`. A hook needs
EXACTLY ONE of `handler`/`trigger` — never both, never neither.

## The cadence is DECLARED — a cron handler must NEVER gate on the wall clock

The host owns dueness AND boot catch-up, so express the schedule in `every`/`daily` and let the handler do
its work WHENEVER it is invoked. A weekly job is `every: '7d'`, NOT `daily` plus an
`if (new Date().getDay() !== 1) return;` guard — that guard is a bug: it discards every catch-up run (a
day slept through by a scaled-to-zero pod is lost) and no-ops a manual run. The handler MAY skip work that
is already DONE (idempotence — "this week's list already exists"), but NEVER work it is asked to do now.

## Write REAL column names — the writer rejects the rest

Read the columns of every `item.reads`/`item.writes` table from `plan_tables.tables` and use those exact
snake_case names. A `db.insert('shopping_list', { … })` naming a column the table does not declare is
REJECTED at write time (the same failure that silently dropped a user's form submission in scenario 10) —
so match the schema, do not invent a column. NEVER author the `id` primary key in an inserted row; the
system generates it. The handler runs in Node: `db`, `fetch`, `crypto`, `console` and the timers all
exist, but there is NO `window`/`document` (a hook is not a page).

```typescript
const a = item;
const columnsOf = (name: string): string[] => {
  const t = (Array.isArray(plan_tables.tables) ? plan_tables.tables : []).find((x: { name: string }) => x.name === name);
  return t && t.schema && t.schema.columns ? Object.keys(t.schema.columns) : [];
};
let src: string;
if (a.run === 'agent') {
  // A model turn is genuinely needed — delegate to a space agent action on the schedule / write.
  src = [
    'export default {',
    "  type: '" + a.kind + "',",
    a.kind === 'cron'
      ? (a.every ? "  every: '" + a.every + "'," : "  daily: '" + a.daily + "',")
      : "  on: { event: 'project/db." + a.on.table + '.' + a.on.event + "' },",
    "  trigger: '" + a.trigger + "',",
    '  budget: { maxEpisodes: 10, maxWallClockMs: 600000 },',
    '};',
  ].join('\n');
} else if (a.kind === 'cron') {
  // Deterministic scheduled code — no agent. Reads its source tables, writes the derived row(s).
  src = [
    'export default {',
    "  type: 'cron',",
    a.every ? "  every: '" + a.every + "'," : "  daily: '" + a.daily + "',",
    '  handler: async ({ db }) => {',
    "    const rows = await db.query('" + a.reads[0] + "');",
    '    // …compute the result from `rows` (idempotent: skip if this period is already done)…',
    "    await db.insert('" + a.writes[0] + "', { /* real columns of " + a.writes[0] + " — never id */ });",
    '  },',
    '};',
  ].join('\n');
} else {
  // Reacts to a database write — ctx.input IS the written row.
  src = [
    'export default {',
    "  type: 'event',",
    "  on: { event: 'project/db." + a.on.table + '.' + a.on.event + "' },",
    '  handler: async ({ input, db }) => {',
    '    if (!input || !input.id) return;',
    "    await db.update('" + a.on.table + "', { where: { id: input.id }, set: { /* derived columns */ } });",
    '  },',
    '};',
  ].join('\n');
}
const w = writeProjectHook(a.slug, src);
currentTask.resolve({ slug: a.slug, ok: w.ok });
```

`w` is `{ ok, error? }` — read `w.ok`, never call `.length` on it. If `w.ok` is false, `w.error` names the
exact fault (an unparseable module, a `type` that is not `cron`/`event`, a column the table lacks, a
`project/db.<table>` naming a table that does not exist) — fix THAT in the source and write once more,
then resolve honestly. Never resolve `ok: true` on a write that did not land.
