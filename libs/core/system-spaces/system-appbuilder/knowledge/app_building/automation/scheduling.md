---
description: LOAD WHEN the CLOCK is the trigger — poll a source every 30 minutes, run an agent nightly. A cron emitter def with a ctx.state cursor for polling, versus a cron hook for a scheduled agent run, and why the handler must never gate on the wall clock.
---

# Scheduled work — a cron EMITTER DEF to poll, a cron HOOK to run an agent

## Scheduled polling — a `cron` EMITTER DEF (events/, with a `ctx.state` cursor)

When the user wants to POLL a source on a schedule ("every 30 minutes, check X for new items and
store them"), author a `cron` EMITTER DEF with `writeProjectEvent` (it goes in `events/`, NOT
`hooks/`). It has exactly one of `every` (`'<n>m|h|d'`) or `daily` (`'HH:MM'`), an async
`emit(ctx)` that polls via `ctx.callConnection`, and a persisted `ctx.state` KV it uses as a
cursor so a re-poll never re-emits an item it already saw. Pair it with a hook that stores each
emitted item (the cron emit is PURE — it has NO `db`; it emits, a hook inserts):

```typescript
// events/poll-demo-source.ts — poll the demo source every 30m; ctx.state.lastId is the cursor.
const evt = [
  "export default {",
  "  type: 'cron',",
  "  every: '30m',",                                  // EXACTLY one of every / daily
  "  connections: ['demo'],",                         // the installed provider ctx.callConnection may reach
  "  emits: { 'source.item': { payload: { id: 'string', text: 'string' } } },",
  "  async emit(ctx) {",
  "    const since = (ctx.state && ctx.state['lastId']) || '0';",   // persisted cursor
  "    let items = [];",
  "    try { const res = await ctx.callConnection('demo', { method: 'GET', path: '/items', query: { since } });",
  "          items = (res && res.data && res.data.items) || []; } catch { items = []; }",
  "    if (ctx.state && items.length) ctx.state['lastId'] = String(items[items.length - 1].id);",  // advance cursor → next tick sees only newer
  "    return items.map((it) => ({ event: 'source.item', payload: { id: String(it.id), text: String(it.text || '') } }));",
  "  },",
  "};",
].join("\n");
writeProjectEvent('poll-demo-source', evt);
// Then a hook stores each polled item (do NOT re-declare an event the tips db emitter already owns):
writeProjectHook('store-polled-item', [
  "export default { type: 'event', on: { event: 'project/source.item' },",
  "  handler: async ({ input, db }) => { const it = input; await db.insert('tips', { headline: String(it.text||'').slice(0,160), body: String(it.text||''), source: 'demo-poll', status: 'new', summary: '' }); } };",
].join("\n"));
```

The `ctx.state` cursor is what makes a re-poll idempotent: because you advance `lastId` past every
item you emitted, the next tick's `since` skips them, so two consecutive runs never store the same
item twice. NEVER put a cron poll in a `handler` string that fabricates its own loop — use the def.

## Cron hooks (scheduled AGENT run, not a poll)

For a scheduled AGENT action (not a source poll) a time-based HOOK uses `type: 'cron'`
(`every: '<n>m|h|d'` or `daily: 'HH:MM'`) and a `trigger` (or `handler`):

```typescript
const cron = [
  "export default { type: 'cron', every: '1d', trigger: 'system-research/researcher#research' };",
].join("\n");
writeProjectHook('daily-refresh', cron);
```

Guidelines:

- **The SCHEDULE is declared, never re-implemented in the body.** The host decides when a cron
  hook is due (and, on boot, runs a window it missed while the pod was asleep — pods scale to
  zero). So express the cadence in the DEF and let the handler do its work **every time it is
  invoked**:

  ```typescript
  // ✅ weekly — declared. Fires on schedule, catches up a missed window, and a manual
  //    "run now" (Studio / the hook-run endpoint) actually does the work.
  "export default { type: 'cron', every: '7d', trigger: 'kitchen/planner#weekly_plan' };"

  // ❌ NEVER: a daily cron that re-implements "weekly" by returning early on the wrong day.
  //    It skips every catch-up run, and a manual run silently does nothing.
  "export default { type: 'cron', daily: '06:00', handler: async ({ db }) => {",
  "  if (new Date().getDay() !== 0) return;   // ← the bug: the handler must not gate on the clock",
  ```

  A handler may skip work that is genuinely already DONE (idempotence — "this week's plan
  already exists, nothing to do"), but it must never refuse to run because of the wall clock.
- Prefer a code `handler` over a `trigger` when the reaction is a simple filter/relay — no
  agent, no LLM cost. But when the rule needs genuine reasoning (summarize/classify/draft/
  decide), you MUST invoke a model — a `trigger` to an agent, or `ctx.delegate` from a
  handler (see "When the rule needs a MODEL"). Never fake it with hand-written string logic.
- Only list a provider in `connections:` that the user has installed; an unlisted provider
  throws at call time.
