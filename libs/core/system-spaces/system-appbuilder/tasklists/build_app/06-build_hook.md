---
id: build_hook
output:
  slug: string
  ok: boolean
dependsOn: [design, build_table]
forEach: design.hooks
optional: true
role: general
functions: []
---

Write ONE automation hook into the project's `hooks/`. Your hook is in `item` = { slug, purpose }.
Write the FULL `.ts` source inline. There is NO `{ type: 'database' }` hook anymore — a project-db
write is delivered as the EVENT `project/db.<table>.<event>` (`event` ∈ `insert`|`update`|`remove`),
whose emitted payload IS the written row. So a hook default-exports `{ type: 'event' | 'cron', … }`:

- **Event hook** (react to a db write, or to an installed space's event) — subscribe to ONE
  source-qualified address and either run a code `handler` (the handler IS the filter — cheap, no
  LLM) or `trigger` an agent. A code handler receives `ctx = { input, db, delegate, callConnection,
  tasklist }` — `input` is the event payload (the row for a `project/db.*` event); `ctx.db` is the
  project's async data API (`await ctx.db.insert(table, row)` / `query` / `update` / `remove`).
  There is no `ctx.project.db` and no `ctx.publishEvent` — use `ctx.db` only.
- **Cron hook** — `{ type: 'cron', every: '1d' | daily: 'HH:MM', trigger: '<space>/<agent>#<action>' }`.

Ground `table` in a table you designed and any `trigger` in a REAL agent action (never a self-
trigger back into `app-architect#build_app`). Emit ONE of these shapes for your `item`:

```typescript
const h = item;
const table = design.tables[0] ? design.tables[0].name : 'items';
// Code-handler event hook: enrich each freshly inserted row in plain code (no LLM).
const src = [
  "export default {",
  "  type: 'event',",
  "  on: { event: 'project/db." + table + ".insert' },",
  "  handler: async ({ input, db }) => {",
  "    const row = input;",
  "    if (!row || !row.id) return;",
  "    // ... derive fields and persist with ctx.db; e.g.:",
  "    // await db.update('" + table + "', { where: { id: row.id }, set: { seen: true } });",
  "  },",
  "};",
].join("\n");
const w = writeHook(h.slug, src);
// w = { ok, error? }. Rewrite and retry if w.ok is false.
currentTask.resolve({ slug: h.slug, ok: w.ok });
```

To hand the event to an agent instead of writing code, replace `handler` with
`trigger: '<space>/<agent>#<action>'` (mutually exclusive with `handler`). Prefer a code `handler`
whenever the reaction is a simple filter/relay — no agent, no LLM cost.
