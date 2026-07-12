# Scenario 04 — Signals & Code nodes: the runtime observing itself, deterministically

**Persona.** Sam is an engineer. He doesn't want an LLM in the loop for things that aren't judgement
calls. He wants the model to *decide*, and code to *do* — and he wants a record of what the system
did to itself.

**Why this scenario exists.** Two features that only make sense together:
`integration-lmthing` turns the runtime's own **internal signals** into typed events, and **code
nodes** let a tasklist do deterministic work with no model call. Together they are how an automation
stays cheap and auditable. This scenario proves the DAG's execution flow and output handling
(`dependsOn`, `forEach`, `output`) and that internal signals emit and route correctly.

## Feature coverage

| Feature | Where |
|---|---|
| `integration-lmthing` **internal** emitter defs (all 5: `session.completed`, `space.installed`, `hook.fired`, `document.written`, `project.created`) | Steps 1–2 |
| `publishEvent(name, payload)` (the space's own function) + `emitEvent` global (`events:emit`) | Step 3 |
| Payload validation on emit (undeclared event / bad type → dropped with warn) | Step 3 (edge) |
| **Code nodes** in a space tasklist (`NN-<id>.ts`, `node` metadata statically extracted) | Step 4 |
| DAG output handling: `dependsOn`, upstream output keyed by node id, seed keys at top level | Step 4 |
| `forEach` fan-out over an upstream array output | Step 5 |
| Worker isolation of code nodes; `ctx` is exactly `{db, delegate, callConnection}` (no `fetch`) | Step 6 |
| Multi-tasklist project: a hook running a **headless** tasklist (`ctx.tasklist.run`) | Step 5 |
| Code-node failure = required-task failure (propagates, doesn't silently pass) | Step 6 (edge) |
| `system-engineer` authoring **project functions** (`functions/*.ts`, the third scope) | Step 7 |

## Setup

```bash
cd sdk/org/scenarios/harness && node ../04-signals/run.mjs
```

## Steps & expected outcomes

### Step 1 — Install the mirror
**Prompt:** *"Create a project `observatory`. I want to keep a record of everything the system does
for me — every hook that fires, every document written, every session that finishes, every space
installed."*

**Expect:** THING finds and installs `integration-lmthing` (consent card → approve), then authors
hooks subscribing to its typed events. The five internal emitter defs are scanned and registered.

**Assert:** all five events appear as subscribable addresses (`integration-lmthing/<event>`); the
project has hooks on at least `hook.fired`, `document.written`, `session.completed`.

### Step 2 — Provoke each signal and prove it routed
The runner triggers each signal through its *real* cause — not by faking the event:

| Signal | Provoked by | Expected row in `signals` |
|---|---|---|
| `project.created` | creating a second project | `{signal:'project.created', projectId:…}` |
| `space.installed` | installing `integration-demo` (consent → approve) | `{signal:'space.installed', spaceId:'integration-demo'}` |
| `document.written` | asking THING to write a note | `{signal:'document.written', path:…}` |
| `hook.fired` | any of the above firing a hook | `{signal:'hook.fired', slug:…}` |
| `session.completed` | a delegate/headless run finishing | `{signal:'session.completed', ok:true, durationMs:>0}` |

**Assert:** each row's payload matches the def's declared schema exactly (the emitter drops
incomplete signals — a partial signal must produce **no** row rather than a row with `undefined`).

**Edge:** an internal emitter that throws must be worker-contained and must **not** break the
instrumented path — the runner installs a deliberately-throwing internal def and confirms the
signalling operation (e.g. the space install) still completes.

### Step 3 — The project publishes its own event
**Prompt:** *"Let me publish a custom `report.ready` event that other automations can subscribe to."*

**Expect:** a project emitter def declaring `report.ready`, an agent with `events:emit`, and
`emitEvent('report.ready', {...})` publishing into the pipeline. A hook subscribed to
`project/report.ready` fires.

**Edges:**
| Edge | Expected |
|---|---|
| `emitEvent` naming an **undeclared** event | dropped with a warn; no hook fires; the caller learns it failed |
| `emitEvent` with a payload **violating** the declared schema (wrong type / missing required) | dropped with a warn; no hook fires |
| An agent **without** `events:emit` calling it | typecheck failure at injection — the call cannot be expressed |
| A space trying to emit **another scope's** address | impossible — scope is host-derived, not caller-supplied |

### Step 4 — A tasklist where the model decides and code does
**Prompt:** *"Build me a `digest` tasklist: research a topic, then format the result and store it —
and don't use a model for the formatting or storing."*

**Expect** a space tasklist with a **mixed DAG**:
- `01-research.md` — an **agent node** (uses `webSearch`/`webFetch`), `output: { findings: array, summary: string }`
- `02-format.ts` — a **code node** (`export const node = { id:'format', dependsOn:['research'] }`),
  pure formatting, **no LLM**
- `03-store.ts` — a **code node** `dependsOn: ['format']` writing to the project db via `ctx.db`

**Assert the wiring precisely** (this is where DAGs usually break):
- `inputs.research.findings` — the upstream node's output keyed **by node id**
- seed keys are **top-level** `inputs.<key>` (NOT `inputs.seed.<key>`)
- `node` metadata is statically extracted — core never executes the module to learn its id
- the two code nodes contribute **0** `llm_response` events, while `01-research` contributes ≥1
- the final row in the db matches the researched content (output actually flowed end to end)

### Step 5 — `forEach` fan-out + headless run from a hook
Extend the tasklist: a node with `forEach` over `inputs.research.findings` (an array), producing one
output per item, and a downstream node that consumes the collected results.

Then have a hook run the whole tasklist **headless** via `ctx.tasklist.run('<spaceId>/digest', seed)`
on an inbound demo message.

**Expect:** N parallel node executions for N findings (visible as N `node_start`/`node_end` pairs);
the collector receives all N outputs; the headless run returns its result to the hook handler (a
hook `delegate`/`tasklist.run` that drops its result is a known past bug — assert it does not).

### Step 6 — Code-node isolation & failure semantics

| Edge | Expected |
|---|---|
| A code node calling `ctx.fetch(...)` | **no such thing** — `ctx` is exactly `{db, delegate, callConnection}`; the call fails |
| A code node calling `ctx.callConnection('slack')` when the tasklist declares only `demo` | throws — gating is declared ∩ owned, not advisory |
| A code node that **throws** | required-task failure — the tasklist fails, downstream nodes are skipped, the error surfaces (not swallowed) |
| A code node that **hangs** | worker timeout bounds it; the pod survives |
| A code node trying to read a **secret outside its namespace** | unavailable |

### Step 7 — Project functions (the third scope)
**Prompt:** *"Give me a reusable `slugify` helper my hooks and code nodes can both call."*

**Expect:** `system-engineer` authors `functions/slugify.ts` via `writeProjectFunction`. It appears
in the DTS of project-rooted sessions, and is callable from **both** a hook handler and a code node.
It is **not** visible to a system-space session (project scope only).

## Assertions the runner makes

- All 5 internal signals emit, route, and match their declared payload schema
- A throwing internal def never breaks the instrumented path
- `emitEvent` validates: undeclared/mistyped payloads are dropped, not smuggled through
- The mixed DAG runs in dependency order; code nodes make **0** LLM calls; outputs flow by node id
- `forEach` fans out N ways and the collector sees all N
- `tasklist.run` from a hook returns its result to the handler
- A code-node throw fails the tasklist loudly; a hang is bounded; the pod survives both
- A project function is callable from hooks and code nodes, invisible outside the project

## Performance targets

| Metric | Target |
|---|---|
| Code-node execution (formatting/store) | < 500 ms, 0 tokens |
| Full `digest` tasklist (1 agent node + 2 code nodes) | < 90 s |
| `forEach` over 5 items | < 3× single-item time (real parallelism) |
| Whole scenario wall clock | < 40 min |

## Actual results

_Filled in by the scenario runner — see `sdk/org/scenarios/results/04-signals-report.md`._
