---
id: plan_automations
output:
  automations: array
dependsOn: [user_stories, plan_tables]
role: general
functions: []
---

Plan the app's AUTOMATIONS — the recurring (cron) or reactive (event) behaviour a user story asks for
that no page, endpoint or button can deliver, because it must happen WITHOUT the user present. This is a
THINKING step — no writers. `user_stories` (`user_stories.stories`) and `plan_tables`
(`plan_tables.tables`, the real schemas + columns being written) are in scope. Emit the automations as
part of the CONTRACT, exactly like tables and endpoints, so a host-run `validate_contract` can cross-check
every reference before a line of hook code is written.

## MOST APPS NEED ZERO — the empty list is the correct, common answer

An automation is authored ONLY when a user story's payoff is impossible without something firing on its
own: a schedule, or a reaction to a database write. If every story is satisfied by opening the app and
reading/editing data through its pages, there is NOTHING to plan here — resolve `{ automations: [] }`.
A hook nobody's story demanded is a defect, not a feature. Do NOT invent a "daily summary", a "cleanup
job", or a "welcome email" the material never asked for.

- ❌ "See the trip costs in order", "review the contacts", "edit a booking" → pages + endpoints. **No automation.**
- ✅ "Every Monday, merge this week's recipe ingredients into ONE shopping list" → a **cron** automation
  (a weekly schedule fires code that reads the plan and writes the list). Nobody is present on Monday.
- ✅ "Warn me before a renewal runs out" → a **cron** automation (a daily schedule scans the renewals
  table and writes a warning row when one is within N days). The warning must appear without being asked for.
- ✅ "When I file a recipe through the form, auto-derive its ingredient list" → an **event** automation
  (reacts to the `insert` on the recipes table and enriches the row).

The test is always: *does a real story break if this never runs while the user is away?* If not, drop it.

## How an automation runs REAL CODE (not a chat reply)

A scheduled or reactive job runs deterministic Node code — no agent, no LLM, no AI credits — by declaring
an imperative `handler` on the hook (`run: 'handler'`). The handler reads and writes the project's tables
through `db` and computes the result itself. Use `run: 'handler'` for every merge/scan/compute/derive job
— that is how "a schedule fires code" is delivered. Only choose `run: 'agent'` (a declarative `trigger`
delegating to a `space/agent#action`) when the job genuinely needs a model turn (drafting prose, judging
free text) — most app automations do NOT.

Each automation is `{ slug, story, kind, run, purpose, ... }`:
- `slug` — a UNIQUE lowercase-hyphen id (`weekly-shopping-list`, `renewal-warnings`). This EXACT string
  becomes the hook filename `hooks/<slug>.ts`. No two automations share a slug.
- `story` — the `id` of the `user_stories.stories` entry this automation exists to satisfy. Every
  automation must trace to exactly one real story; there is no automation without a story that needs it.
- `kind` — `'cron'` (fires on a time schedule) or `'event'` (fires on a database write).
- `run` — `'handler'` (deterministic Node code, the default) or `'agent'` (delegate to a space agent).
- `purpose` — one plain-language sentence tying it to the story: what it does and why it must be automatic.
- For a **cron** automation, the CADENCE — exactly one of:
  - `every` — an interval `'<n>m' | '<n>h' | '<n>d'` (a WEEKLY job is `every: '7d'`; granularity is
    clamped to ≥ 5 minutes by the host).
  - `daily` — a time-of-day `'HH:MM'` (24-hour).
- For an **event** automation, `on: { table, event }` — the table (copied VERBATIM from
  `plan_tables.tables`) and the write kind (`'insert' | 'update' | 'remove'`) it reacts to.
- `reads` / `writes` — the table names (VERBATIM from `plan_tables.tables`) the handler reads from and
  writes to. These are the contract: a host-run `validate_contract` REJECTS any table name `plan_tables`
  does not declare (a handler querying a table that never landed builds clean and 500s at runtime), and
  every `on.table` must be a real table too. List every table the handler touches.
- For `run: 'agent'` only, `trigger` — the `'space/agent#action'` to delegate to. Omit for `run: 'handler'`.

The tables an automation names are the whole reason it can be validated before it is written — so name
them exactly as `plan_tables` declares them (snake_case, verbatim, no re-casing, no inventing).

## If you are being RE-RUN (`feedback` is in scope)

A host-run `validate_contract` cross-checked the whole design and REJECTED it, so this node is running
again with `feedback` bound to its `errors` (and `attempt` to the pass number). Each entry is
`{ node, ref, message }`: `node` is which design node must change, `ref` is the exact offending
reference, `message` says what broke AND names the real options. Read every entry that names
`plan_automations` and fix precisely that — re-point a `reads`/`writes`/`on.table` at a table that
actually exists, or drop an automation whose story does not need it. An entry naming a different node is
context. If `feedback` is not in scope, this is the first pass; ignore this section.

Emit exactly one statement (an EMPTY list when no story needs a schedule or a reaction):

```typescript
currentTask.resolve({
  automations: [
    {
      slug: 'weekly-shopping-list',
      story: '<the user_stories id this serves>',
      kind: 'cron',
      run: 'handler',
      purpose: 'Every Monday, merge this week\'s planned recipes into one shopping list the user opens to.',
      every: '7d',
      reads: ['meal_plan', 'recipes'],
      writes: ['shopping_list'],
    },
    // …one entry per story that genuinely needs automatic behaviour. Usually there are none.
  ],
});
```
