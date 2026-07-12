## Actual results — run 2026-07-12T08:28:18.767Z

**Verdict: ✅ PASS** · 51/51 checks · 0 issue(s) found · 8.6 min wall clock

### setup

*Expected:* a fresh prod user, pod env carrying the demo integration settings, pod settled

| Check | Result | Actual |
|---|---|---|
| user provisioned | ✅ | newsroom-mrhj63c1@lmthing.test (ns user-381428085909644938) |
| demo integration settings in pod env | ✅ | changed=true |
| store catalog: integration-demo publishes its webhook emitter | ✅ | {"inbound":[{"path":"demo","verify":"hmac"}],"events":["message.received"]} |
| store catalog: integration-lmthing publishes its internal signals | ✅ | document.written, hook.fired, project.created, session.completed, space.installed |

### Step 1 — project-creation request handled

*Expected:* THING does NOT mis-route into a build pipeline; the project is created via its real (UI) path

| Check | Result | Actual |
|---|---|---|
| THING did NOT mis-route into build_specialist/build_app | ✅ | no build pipeline |
| no eval/typecheck errors | ✅ | [] |
| project `newsroom` exists (created via the UI path) | ✅ | system, user, newsroom |

> THING said: {"type":"Stack","props":{"gap":2},"children":[{"type":"Paragraph","props":{},"children":["I can’t create a sibling project from here. Projects are created from the Studio/side-panel ",{"type":"Strong","props":{},"children":["New project"]}," control."]},{"type":"Paragraph","props":{},"children":["Cr

> Project creation is a UI action by design; THING correctly declines to scaffold an app for it and offers to set up data/automation once inside the project.

### Step 2 — store discovery + consent-gated install

*Expected:* THING delegates to system-store/finder, then installSpace()s integration-demo AND integration-lmthing, each behind a ConsentCard

| Check | Result | Actual |
|---|---|---|
| delegated to system-store | ✅ | system-store/finder · system-appbuilder/automator |
| installSpace yielded twice | ✅ | 2 install(s): [["integration-demo"],["integration-lmthing"]] |
| a ConsentCard per install | ✅ | 2 consent card(s) |
| consent cards name installSpace | ✅ | [{"function":"installSpace","argsSummary":"[\"integration-demo\"]"},{"function":"installSpace","argsSummary":"[\"integration-lmthing\"]"}] |
| integration-demo installed | ✅ | integration-demo, integration-lmthing |
| integration-lmthing installed | ✅ | integration-demo, integration-lmthing |
| no eval errors | ✅ | [] |

### Step 3 — tips table + db emitter def

*Expected:* THING delegates to system-appbuilder; the LIVE project gains database/tips.json and a {type:"db"} emitter def emitting tip.added

| Check | Result | Actual |
|---|---|---|
| delegated to system-appbuilder | ✅ | system-appbuilder/automator |
| LIVE project gained database/tips.json | ✅ | database/automation_audit.json, database/story_tips.json, database/tips.json |
| a {type:"db"} emitter def exists | ✅ | tips-events:db |
| a db emitter emits 'tip.added' | ✅ | tips-events |
| no eval errors | ✅ | [] |

### Step 4 — inbound webhook + code-handler filter

*Expected:* an event hook on integration-demo/message.received with a code handler (NOT a trigger) that stores only TIP:-prefixed messages

| Check | Result | Actual |
|---|---|---|
| delegated to system-appbuilder/automator | ✅ | system-appbuilder/automator · system-appbuilder/automator |
| event hook on integration-demo/message.received | ✅ | hooks/audit-lmthing-document-written.ts→integration-lmthing/document.written, hooks/audit-lmthing-hook-fired.ts→integration-lmthing/hook.fired, hooks/audit-lmthing-project-created.ts→integration-lmthing/project.created, hooks/audit-lmthing-session-completed.ts→integration-lmthing/session.completed, hooks/audit-lmthing-space-installed.ts→integration-lmthing/space.installed, hooks/store-demo-story-tips.ts→integration-demo/message.received, hooks/story-tip-intake.ts→integration-demo/message.receive |
| it is a code handler, not an agent trigger | ✅ | handler=true trigger=false |
| the handler filters on the TIP: prefix | ✅ | export default {   type: 'event',   on: { event: 'integration-demo/message.received' },   handler: async ({ input, db }) => {     const m = (input \|\| {}) as any;     const text = String(m.text ?? m.message ?? m.body ?? m.content ?? '');     |
| delivery A → 200 {ok, events:1} | ✅ | 200 {"ok":true,"events":1} |
| delivery A committed a tips row | ✅ | {"id":"686f1d90-5c16-4f36-9d3c-9d312fb930ee","headline":"council votes on the bridge","body":"council votes on the bridge","source":"integration-demo","status":"new","summary":""} |
| code-handler path woke NO agent | ✅ | project sessions 1 → 1 |
| delivery B → 200 {ok, events:1} | ✅ | 200 {"ok":true,"events":1} |
| delivery B stored NOTHING (filtered in code) | ✅ | 1 → 1 rows |
| delivery B woke NO agent | ✅ | project sessions 1 → 1 |

### Step 5 — db event → agent trigger

*Expected:* a second hook on project/tip.added (or project/db.tips.insert) with a `trigger`; a delivery makes an agent write tips.summary; the self-write does not re-fire it

| Check | Result | Actual |
|---|---|---|
| hook on project/tip.added or project/db.tips.insert | ✅ | hooks/audit-lmthing-document-written.ts→integration-lmthing/document.written, hooks/audit-lmthing-hook-fired.ts→integration-lmthing/hook.fired, hooks/audit-lmthing-project-created.ts→integration-lmthing/project.created, hooks/audit-lmthing-session-completed.ts→integration-lmthing/session.completed, hooks/audit-lmthing-space-installed.ts→integration-lmthing/space.installed, hooks/store-demo-story-tips.ts→integration-demo/message.received, hooks/story-tip-intake.ts→integration-demo/message.receive |
| it delegates to an agent (trigger or ctx.delegate) | ✅ | export default {   type: 'event',   on: { event: 'project/tip.added' },   handler: async ({ input, delegate, db }) => {     const tip = input as { id?: string; headline?: string; body?: string; source?: string; summary?: string };     const |
| delivery C → 200 | ✅ | 200 {"ok":true,"events":1} |
| the agent wrote tips.summary for the new tip | ✅ | {"id":"9b7bf3a1-9330-4412-84e9-78f76bfda205","headline":"mayor to resign at noon","body":"mayor to resign at noon","source":"integration-demo","status":"new","summary":"Mayor to resign at noon, according to integration-demo."} |
| an agent (headless delegate) produced the summary | ✅ | "Mayor to resign at noon, according to integration-demo." |
| self-write exclusion: the summary UPDATE did not re-fire the hook | ✅ | 1 mayor row(s), all with a stable summary |

### Step 6 — cron emitter + ctx.state cursor

*Expected:* events/<name>.ts with type:"cron", exactly one of every/daily, and a ctx.state cursor; a second forced run stores nothing new

| Check | Result | Actual |
|---|---|---|
| a {type:"cron"} emitter def exists | ✅ | poll-integration-demo-tips:cron, tips-events:db |
| exactly one of every/daily | ✅ | every=true daily=false |
| uses ctx.state as a cursor | ✅ | export default {   type: 'cron',   every: '30m',   connections: ['demo'],   emits: {     'integration-demo.item.polled': {       payload: { id: 'string', title: 'string', text: 'string' }     }   },   async emit(ctx) {     const since = Str |
| the second forced run stored nothing new (ctx.state persisted) | ✅ | 2 → 2 |

> cron rows: before=2 run1=2 run2=2

### Step 7 — audit trail from internal signals

*Expected:* hooks on integration-lmthing/hook.fired and /document.written writing to an `audit` table; the cascade terminates (self-trigger exclusion + depth cap)

| Check | Result | Actual |
|---|---|---|
| hook on integration-lmthing/hook.fired | ✅ | integration-lmthing/document.written, integration-lmthing/hook.fired, integration-lmthing/project.created, integration-lmthing/session.completed, integration-lmthing/space.installed, integration-demo/message.received, project/integration-demo.item.polled, integration-demo/message.received, project/tip.added |
| hook on integration-lmthing/document.written | ✅ | integration-lmthing/document.written, integration-lmthing/hook.fired, integration-lmthing/project.created, integration-lmthing/session.completed, integration-lmthing/space.installed, integration-demo/message.received, project/integration-demo.item.polled, integration-demo/message.received, project/tip.added |
| an audit table exists | ✅ | database/audit.json, database/automation_audit.json, database/story_tips.json, database/tips.json |
| audit rows recorded the hooks that fired | ✅ | [{"id":"2862d9f2-639d-4346-b5a0-82d477d10fee","eventType":"integration-lmthing/hook.fired","timestamp":"2026-07-12T08:36:18.587Z","hookId":"audit-lmthing-session-completed","documentId":"","status":"","outcome":"","summary":"Hook fired audit-lmthing-session-completed","payload":{"hookId":"audit-lmth |
| the audit cascade terminated (no runaway) | ✅ | 1 → 5 audit rows |

> audit table resolved to "audit"

### Step 8 — edges

*Expected:* bad HMAC → 401 (emit never runs); unknown path → 404; malformed body → 200 {events:0}

| Check | Result | Actual |
|---|---|---|
| bad HMAC → 401 | ✅ | 401 {"error":{"status":401,"message":"signature verification failed"}} |
| unknown inbound path → 404 | ✅ | 404 {"error":{"status":404,"message":"no webhook binding for \"nope\""}} |
| malformed body → 200 {ok:true, events:0} | ✅ | 200 {"ok":true,"events":0} |
| no edge case wrote a row | ✅ | 3 → 3 |
| an undeclared-event hook does not break the other hooks | ✅ | 200 {"ok":true,"events":1} |
| the healthy hooks still fired | ✅ | 4 tips |

> Edge "emitEvent with a schema-violating payload is dropped with a warn" is covered by the runtime unit tests (validateEmitted / emitter-load) — it is not reachable through THING, which holds no `events:emit` capability.

### totals

*Expected:* all four emitter kinds live; session trace facts

| Check | Result | Actual |
|---|---|---|
| all four emitter kinds live (db+cron project, webhook+internal spaces) | ✅ | {"db":true,"cron":true,"webhook":true,"internal":true} |

> yield kinds: setSessionMeta, storeInspect, installSpace, delegate, storeSearch, integrationStatus, inspect

### Performance

| Metric | Value |
|---|---|
| S1 turn | 14.6s |
| S2 turn | 80.2s |
| S3 turn | 62.8s |
| S4 turn | 36.1s |
| inbound → row committed (code-handler path) | 0.57s |
| S5 turn | 25.2s |
| inbound → agent-trigger summary written | 3.4s |
| S6 turn | 61.8s |
| S7 turn | 95.8s |
| eval/typecheck errors surfaced (recovered via retry) | 1 |
| LLM calls (THING session) | 34 |
| tokens | 207919 in / 14247 out |
| delegates | system-store/finder · system-appbuilder/automator · system-appbuilder/automator · system-appbuilder/automator · system-appbuilder/automator · system-appbuilder/automator · system-appbuilder/automator · system-appbuilder/automator |
