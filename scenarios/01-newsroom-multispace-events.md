# Scenario 01 — Newsroom: one project, three spaces, all four emitter kinds

**Persona.** Maya runs a small newsroom. She wants a project that watches an inbound chat channel
for story tips, polls a source feed on a schedule, enriches every stored tip, and keeps an audit
trail of its own automation — all built by asking THING, never by touching a file herself.

**Why this scenario exists.** It is the breadth test for the unified event pipeline: it drives
**all four emitter kinds** (`webhook`, `cron`, `db`, `internal`) and **both hook consumer styles**
(a code `handler` used as a cheap pre-agent filter, and an agent `trigger`) inside one project,
built end-to-end through THING and its specialist spaces.

## Feature coverage

| Feature | Where it's exercised |
|---|---|
| New project created through THING | Step 1 |
| Multi-space install (`integration-demo`, `integration-lmthing`) via `system-store/finder` + `installSpace` | Step 2 |
| `webhook` emitter def (HMAC-verified inbound) | Step 4 — signed POST to `/api/inbound/demo` |
| `db` emitter def + synthetic `project/db.<table>.<event>` | Step 5 |
| `cron` emitter def (`every`, `ctx.state` cursor) | Step 6 — forced via the hook-run route |
| `internal` emitter def (`hook.fired`, `document.written`) | Step 7 |
| Code-handler-as-filter (no agent wakes on a non-match) | Step 4 |
| Agent `trigger` hook (delegates into a space agent) | Step 5 |
| `system-appbuilder/automator` authoring hooks into the LIVE project | Steps 3–5 |
| Payload validation (undeclared/mistyped event dropped with a warn) | Step 8 (edge) |
| Verify-before-emit (bad signature never reaches `emit`) | Step 8 (edge) |

## Setup

```bash
cd sdk/org/scenarios/harness
node smoke.mjs                        # must pass first
node ../01-newsroom/run.mjs
```

The runner provisions a fresh prod user (`newsroom`), loads Azure keys into the pod, and drives a
real THING session. `INTEGRATION_DEMO_WEBHOOK_SECRET` is set by the runner into pod env so the
harness can sign inbound deliveries exactly as a provider would.

## Steps & expected outcomes

### Step 1 — Project creation through conversation
**Prompt:** *"Create a project called `newsroom` for tracking story tips."*

**Expect:** THING creates the project (not a document, not a space). `GET /api/projects` lists
`newsroom`. THING calls `setSessionMeta` early. No eval errors.

### Step 2 — Discovery + install of two spaces, with consent
**Prompt:** *"I want to receive story tips from my chat tool, and I want an audit trail of the
automations you build. Find and install what you need."*

**Expect:**
- THING delegates to `system-store/finder` (`store:read`) rather than guessing space ids.
- It calls `installSpace('integration-demo')` and `installSpace('integration-lmthing')`.
- **Each install raises a `ConsentCard` ask** (`descriptor.type === 'ConsentCard'`,
  `props.function === 'installSpace'`). The harness approves both.
- After install: `GET /api/projects/newsroom/spaces` contains both ids; the spaces are
  live-registered (THING can `delegate()` into them without a restart).

### Step 3 — The data model + the db emitter
**Prompt:** *"Store every tip in a `tips` table (headline, body, source, status, summary), and give
the project a proper `tip.added` event when one is stored."*

**Expect:** THING delegates to `system-appbuilder` (`app-architect`/`data-modeler`). The project
gains `database/` with a `tips` table and `events/tip-added.ts` — a **`db` emitter def**
(`type:'db'`, `on:{table:'tips',event:'insert'}`) whose `emits` declares `tip.added` with a curated
payload. `validateEmitterDef` accepts it (it loads without a scan warning).

### Step 4 — Inbound webhook → code-filter hook (the cheap path)
**Prompt:** *"When a chat message comes in that starts with `TIP:`, store it as a tip. Ignore
everything else — don't wake an agent for chatter."*

**Expect:** an event hook `hooks/<slug>.ts` with `on: { event: 'integration-demo/message.received' }`
and a **code `handler`** (not a `trigger`) that filters on the `TIP:` prefix and `db.insert`s.

**Then the harness delivers two signed inbound webhooks** to `/api/inbound/demo`:

| Delivery | Body | Expected |
|---|---|---|
| A | `{"message":{"message_id":1,"text":"TIP: council votes on the bridge","chat":{"id":"c1"},"from":{"id":"u1"}}}` | `200 {ok:true, events:1}`; a row appears in `tips`; **zero LLM calls** attributable to the hook |
| B | `{"message":{"message_id":2,"text":"lunch?","chat":{"id":"c1"},"from":{"id":"u1"}}}` | `200 {ok:true, events:1}` (the event still emits) but **no new `tips` row** and **no agent run** — the code handler filtered it |

The "no agent woke" assertion is the point: a filter that costs a model call is not a filter.

### Step 5 — db event → agent `trigger` hook (the expensive path, earned)
**Prompt:** *"Whenever a tip is stored, have an agent write a one-line summary into it."*

**Expect:** a second hook with `on: { event: 'project/tip.added' }` (the def's curated event) **or**
`project/db.tips.insert` (the synthetic raw event) and a **`trigger`** to a project/space agent.
Delivering webhook A again (new message id) must:
- fire the hook,
- run the agent headless (a `node_start`/`node_end` pair for the delegate),
- leave `tips.summary` non-empty for that row.

**Assert the loop guard does NOT trip here:** the agent's own write to `tips` must not re-fire the
hook that triggered it (self-write exclusion).

### Step 6 — Cron emitter with a persisted cursor
**Prompt:** *"Every 30 minutes, poll for new items from the demo source and store any you haven't
seen before."*

**Expect:** `events/<name>.ts` with `type:'cron'`, exactly one of `every`/`daily`, and a
`ctx.state` cursor (`lastId`-style) so a re-poll doesn't duplicate.

The harness forces two consecutive runs via
`POST /api/projects/newsroom/hooks/@emitter:project:<name>/run` and asserts the **second run stores
nothing new** — proving `ctx.state` persisted between ticks.

### Step 7 — The project watches itself (internal signals)
**Prompt:** *"Keep an audit log of every hook that fires and every document you write."*

**Expect:** hooks on `integration-lmthing/hook.fired` and `integration-lmthing/document.written`,
writing to an `audit` table. After re-running steps 4–5, `audit` holds rows naming the hooks that
fired. **Critically:** the audit hook writing a row must not cascade infinitely — `hook.fired` from
the audit hook itself must not re-trigger the audit hook (self-trigger exclusion), and the chain
must terminate at the depth cap.

### Step 8 — Edges (these must fail *correctly*, not loudly)

| Edge | Expected |
|---|---|
| Inbound POST with a **bad HMAC signature** | `401`; `emit` never runs; no event, no row |
| Inbound POST to an **unknown path** (`/api/inbound/nope`) | `404` |
| Inbound POST with a **malformed body** (`{"garbage":true}`) | `200 {ok:true, events:0}` — verified, but `emit` returns `[]` |
| A hook subscribing to an **undeclared event** | load fails loudly for that hook; the rest of the project still loads |
| `emitEvent` with a payload that **violates the declared schema** | dropped with a warn; no hook fires |

## Assertions the runner makes (trace-level, not prose-level)

- `thing.didDelegate('system-store')` and `thing.didDelegate('system-appbuilder')`
- `thing.didYield('installSpace')` twice; `thing.consentCards().length === 2`
- The four emitter kinds all appear in the scanned manifest for the project
- Webhook B causes **0** `llm_response` events
- `tips` and `audit` table contents match expectations exactly
- No `eval_error` / `typecheck_error` anywhere in the session

## Performance targets

| Metric | Target |
|---|---|
| Inbound webhook → row committed (code-handler path) | < 2 s |
| Inbound webhook → agent-trigger summary written | < 60 s |
| Whole scenario wall clock | < 35 min |
| Eval errors | 0 |

## Actual results

_Filled in by the scenario runner — see `sdk/org/scenarios/results/01-newsroom-report.md`._
