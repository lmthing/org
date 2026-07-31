---
description: LOAD WHEN something HAPPENS and you must react — an inbound integration event, or a write to one of this project's own tables. The one-hook direct-insert shape, the handler ctx, and when the rule genuinely needs a MODEL rather than a filter.
---

# Event hooks (the common case)

An event hook subscribes to ONE source-qualified event (`<spaceId>/<name>` for a space,
`project/<name>` for the project) and either delegates to an agent (`trigger`) or runs an
imperative `handler` (real code — the handler IS the filter, no rule DSL):

```typescript
// Code-handler filter: only react to messages that mention "deploy", then post back.
const src = [
  "export default {",
  "  type: 'event',",
  "  on: { event: 'integration-slack/message.received' },",
  "  connections: ['slack'],",                     // gates ctx.callConnection to these providers
  "  handler: async ({ input, delegate, callConnection }) => {",
  "    const msg = input as { text: string; channel: string };",
  "    if (!/deploy/i.test(msg.text)) return;",     // the filter — return early to ignore
  "    await callConnection('slack', { method: 'POST', path: '/chat.postMessage',",
  "      body: { channel: msg.channel, text: 'On it — deploying.' } });",
  "  },",
  "};",
].join("\n");
const w = writeProjectHook('slack-deploy-watch', src);
display(w.ok ? 'wrote slack-deploy-watch hook' : ('hook error: ' + w.error));
```

### "When <message> arrives, store it" — ONE hook, DIRECT insert (do not over-build)

The overwhelmingly common shape is: an inbound event → filter in code → `db.insert` into the
project table. Write exactly ONE event hook on the REAL source event whose handler filters and
inserts DIRECTLY. Keep it minimal.

```typescript
// "When a demo chat message starts with TIP:, store it in `tips`." ONE hook, direct insert.
const src = [
  "export default {",
  "  type: 'event',",
  "  on: { event: 'integration-demo/message.received' },",   // the REAL event integration-demo declares
  "  handler: async ({ input, db }) => {",
  "    const m = input as { text?: string; chatId?: string; from?: string };",
  "    const text = String(m.text ?? '');",
  "    if (!/^\\s*TIP:/i.test(text)) return;",                // the filter — ignore non-tips, no agent wakes
  "    const body = text.replace(/^\\s*TIP:\\s*/i, '').trim();",
  "    await db.insert('tips', { headline: body.slice(0, 160), body, source: 'integration-demo', status: 'new', summary: '' });",
  "  },",
  "};",
].join("\n");
writeProjectHook('store-demo-tips', src);
```

**Do NOT over-build this.** Three real failures seen in the wild — avoid them:

- **Never invent an intermediate event.** A handler must not `emitEvent`/relay to a made-up address
  like `story-tip/demo-message` and store from a SECOND hook: only events a REAL installed space or
  YOUR project's own declared `events/*.ts` defs emit ever fire. A hook on a fabricated address loads
  but NEVER fires (silent dead end). One inbound event → one handler → `db.insert`. Done.
- **Reuse ONE table.** If the user said "a `tips` table", store into `tips` — do not also create
  `story_tips`/`inbound_tips` and split writes across them, and author only ONE intake hook.
  Check `listProjectDir('database')` + `listProjectDir('hooks')` first. A handler must `db.insert` ONLY columns
  that exist in the table's schema (for `tips`: headline, body, source, status, summary) — inserting
  an undeclared column like `chatId` throws `table tips has no column named chatId` at dispatch.
- **Filter, don't wake an agent, unless asked.** "store it / ignore chatter" = a code handler. Only
  reach for a model (`ctx.delegate`) when the user explicitly asks an agent to reason (see below).

The handler ctx also exposes a `delegate` helper (`ctx.delegate` — space, agent, opts) that
passes structured input through and RETURNS the agent's result, and `ctx.callConnection`
(provider, req), gated by the hook's `connections:`.

### Persisting to the project database from a handler

A code handler that must STORE something reaches the project's data API as `ctx.db` — an async
CRUD surface: `await ctx.db.insert(table, row)`, `ctx.db.query`, `ctx.db.update`, `ctx.db.remove`.
That is the ONLY db seam in a hook ctx — there is no `ctx.project.db` and no `ctx.publishEvent`
for writing rows; do not invent fallbacks, just call `ctx.db.insert`.

```typescript
"  handler: async ({ input, db }) => {",
"    await db.insert('signals', { signal: 'integration-lmthing/hook.fired', payload: JSON.stringify(input), at: Date.now() });",
"  },",
```

You hold `db:schema`, so you author the project's tables too (`writeProjectTable`, above). If a
handler must write into a table that does not exist yet, create the table FIRST in the same turn,
then write the hook. Never write a handler that inserts into a table nobody has created — it throws
at dispatch. Check the project's existing tables (`listProjectDir('database')`) before re-creating one.

To hand the event to an agent instead of writing code, use `trigger` (mutually exclusive
with `handler`): `{ type: 'event', on: { event: '<spaceId>/<name>' }, trigger: '<space>/<agent>#<action>' }`.

### When the rule needs a MODEL, not a filter

A code `handler` runs plain TypeScript with NO model — it can filter, reshape, and write
rows, but it CANNOT reason, summarize, classify, draft, or decide. When the user explicitly
asks for an AGENT to do something ("have an agent write a one-line summary", "classify each
item", "draft a reply"), you must actually invoke a model — never hand-roll a fake summary
in string code (that silently produces garbage). Use `ctx.delegate` from a handler: it runs
an agent headless, passes structured input, and RETURNS the result, which you write back with
`ctx.db.update`. Delegate to a project/space agent when one fits; otherwise `user-thing/thing`
is the always-available general agent:

```typescript
// Fires on project/db.tips.insert (payload = the row). A MODEL writes the summary.
const src = [
  "export default {",
  "  type: 'event',",
  "  on: { event: 'project/db.tips.insert' },",
  "  handler: async ({ input, delegate, db }) => {",
  "    const tip = input as { id: string; headline?: string; body?: string; summary?: string };",
  "    if (tip.summary && tip.summary.trim()) return;",     // idempotent: skip if already summarized
  "    const r = await delegate('user-thing/thing', undefined, {",  // ctx.delegate(spaceRef, action?, opts) — agent = last path segment
  "      message: 'Write a single one-line summary (max 15 words) of this story tip. Reply with ONLY the summary line.',",
  "      input: { headline: tip.headline, body: tip.body },",
  "    });",
  "    const summary = String((r && r.result) ?? '').trim().split('\\n')[0].slice(0, 200);",
  "    if (summary) await db.update('tips', { where: { id: tip.id }, set: { summary } });",
  "  },",
  "};",
].join("\n");
writeProjectHook('summarize-tip', src);
```

The handler writing `tips.summary` back does NOT re-fire itself — the loop guard excludes a
hook's own writes (self-write exclusion), and the early `if (tip.summary) return` is a second
guard. (You may equally use a `trigger` to a project/space agent when one already exists; the
`ctx.delegate` form is preferred here because it lets you write the result back to the exact row.)

## Database changes are events now

There is NO `{ type: 'database' }` hook. A project-db write is delivered as the event
`project/db.<table>.<event>` (`event` ∈ `insert|update|remove`); the emitted payload IS
the written row. Subscribe with an event hook and (usually) a project `db` emitter def:

```typescript
// Producer: turn every insert into feed_items into a typed project event.
const evt = [
  "export default {",
  "  type: 'db',",
  "  on: { table: 'feed_items', event: 'insert' },",
  "  emits: { 'item.added': { payload: { id: 'string', title: 'string' } } },",
  "  emit: (row) => [{ event: 'item.added', payload: { id: row.row.id, title: row.row.title } }],",
  "};",
].join("\n");
writeProjectEvent('feed-writes', evt);
// Consumer: react to project/item.added (or directly to project/db.feed_items.insert).
```
