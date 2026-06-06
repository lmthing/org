# REPL v2 — Design Document

## Core Runtime

| # | Rule |
|---|------|
| 1 | QuickJS VM persists across turns |
| 2 | No git — full conversation history as context |
| 3 | Harness can inject `ts host` blocks into QuickJS; invisible to LLM |
| 4 | Only **value-yielding** awaits abort the stream: `ask`, `inspect`, `loadKnowledge`, `tasklist`, `fork`, `delegate`. Void host calls (`addIngredient`, etc.) run inline with no round-trip. Value-yielders return a marked Yield promise the harness detects. **On resume, the resolved value of the awaited expression is auto-injected as `VARIABLES(...)`** — so `const x = await ask(...)` shows `x` with no separate `inspect`. `inspect` is only for viewing *other* scope vars or re-querying large values |
| 5 | On a failing statement (runtime or typecheck), the host **rewinds history to the last successful line** — statements that already evaluated stay in history + VM — then surfaces the failing line (commented) + error as an `md user` block; the LLM regenerates from there. **Cap: 3 attempts on the same line, then abort the turn and surface the error to the user (top-level) / caller (delegated/fork)** |
| 6 | `.d.ts` overlay injected into QuickJS; **incremental tsc** typecheck per block against cached overlay before eval (latency accepted) |
| 7 | System block auto-generated from space at session start; globals always injected. Includes the **active agent's `instruct.md` body** (role, capabilities, rules), its actions, scoped functions/knowledge/components, and direct dependencies' actions |
| 8 | **Incremental statement eval**: harness scans streamed tokens, evals each complete statement as it arrives, aborts at the first value-yielding await |
| 9 | **Rolling auto-summarize** for context: keep full history until near the window limit, then collapse oldest code blocks + VARIABLES into a compact summary turn |
| 10 | **Persistence**: lightweight disk snapshot (no git) — serialize VM scope + history every N turns; resume by rehydrating the VM after a crash |
| 11 | **Waiting/polling**: turn-per-poll. `getX()` then `await inspect(x)` ends the turn; to let world-state evolve before re-checking, `await sleep(duration)` ends the turn and delays resumption. No spin-loops |

## Globals

| Global | Behaviour |
|--------|-----------|
| `await ask(<form/>)` | Suspends on await; shows form to user; result injected as VARIABLES |
| `display(<component/>)` | Fire-and-forget render; no suspension |
| `await inspect(...vars \| [var, query])` | Injects variable values as `md user`. Plain values: `inspect(value)` (no array). Query form: `inspect([value, query])` where `query` is an object — same model as the previous repl: `path`, `slice`, `depth`, `filter`, `sample`, `keys`, `count`, `search`. Capped JSON serialization (depth + byte cap); over-cap values replaced by a type/size placeholder + a re-query hint |
| `await loadKnowledge(...path)` | Async; resolves from `knowledge/` tree; injected as VARIABLES on await |
| `await sleep(duration)` | Value-yielding; ends the turn and resumes the LLM after the (wall-clock or simulated) delay, so async world-state can evolve between polls. Injects a minimal `VARIABLES(slept: ...)` confirmation on resume |
| `const result = await tasklist("name")` | Host-managed DAG execution; returns goal task output; control returns to main stream after DAG completes |
| `await delegate(...)` | Cross-space agent delegation; see Delegation section |

Renders to both terminal (Ink) and browser.

## Tasklist

- `await tasklist("name")` aborts the LLM stream; host takes over DAG execution entirely
- Host injects `ts host` fork setup code (invisible to LLM)
- Parallel forks created for all dependency-free tasks; each fork is a separate LLM stream
- Each fork receives: full conversation history up to `await tasklist()` + `md user` task message with instruction + output schema
- Each fork runs until `currentTask.resolve(output)` is called
- **Dependent-task data flow**: upstream outputs reach a dependent task fork BOTH as namespaced VM variables (`__task_boil_water`) AND summarized in the task's `md user` message
- `condition` is a **restricted mini-DSL** (`field op value`, `AND`/`OR`) evaluated by the host against accumulated task outputs — not raw JS eval
- Tasks support `optional: true` — failure does not block dependents. A required task's failure aborts the tasklist with the error surfaced
- Goal task output returned to main stream as VARIABLES; main LLM resumes

## Fork

- `fork()` creates a separate QuickJS VM seeded from parent scope at fork time
- **Only JSON-serializable values cross the VM boundary** — seed vars in, resolved value out. No closures, functions, or class instances. There is no scope merge; the fork's return is just the resolved promise value
- Forks within a tasklist are host-managed; LLM never writes fork orchestration code
- `fork.ts` and `delegate.ts` are **separate implementations** (not a shared spawn engine)
- Forks have a **timeout**; on timeout/throw the promise rejects and the parent handles it

## Delegation

```ts
// Mode 1 — child picks the action
const result = await delegate("space/agent", { query, context, output: Schema })

// Mode 2 — caller names an action of the child agent; child still receives query
const result = await delegate("space/agent", "action_id", { query, context })
```

- Delegated child receives only the passed context object — no parent conversation history
- Delegation can nest, bounded by **structural caps**: max delegation depth (default 5), max concurrent forks (default 8), optional total token budget. Exceeding any surfaces an error to the LLM
- **Direct deps loaded eagerly**; only their actions shown in the system block. Deeper levels resolve lazily on first `delegate`. Dependency cycles detected and rejected
- Dependencies declared in agent `instruct.md` frontmatter as `dependencies: ["space/agent", ...]`
- Mode 2 names an **action** of the child agent; the result is that action's tasklist goal output. **Mode 1: the child picks an action; its goal output is coerced to the requested `output` schema**
- `ask`/delegate calls have a **timeout**; on timeout the promise rejects

---

## Space Structure

```
my-space/
├── agents/
│   └── <slug>/
│       ├── instruct.md       # frontmatter: title, tasklists[], dependencies[]
│       └── config.json       # knowledge, functions, components
├── tasklists/
│   └── <slug>/               # one dir per tasklist; numbered step files
│       ├── 1. <Step>.md      #   each file = a task node (frontmatter) + instruction (body)
│       └── 2. <Step>.md
├── functions/
│   └── <FunctionName>.ts     # one file per host function; auto-discovered
├── components/
│   ├── view/                 # web-only; Ink uses html-to-terminal viewer
│   └── form/                 # two variants required: React (web) + Ink (terminal)
└── knowledge/
    └── <domain>/
        ├── config.json
        └── <field>/
            ├── config.json
            └── <option>.md
```

- At least one agent required per space
- No `package.json`, `tsconfig.json`, or `index.ts` per space — harness handles all
- No `maxCycles`, no `checkpoint`/`rollback`/`pin`
- Numbered step files are task nodes (one per task), not LLM cycles as in the old `flows/`

## Agent `instruct.md` frontmatter

```yaml
---
title: My Agent
actions:                          # each action maps to a tasklist
  - id: cook_pasta
    label: Cook pasta
    description: Boil, cook, drain, and combine with sauce
    tasklist: make_pasta
dependencies:
  - space/agent
---
```

Body: role description, capabilities, coding patterns, rules — injected into system prompt.

Actions are the agent's named entry points (shown in the system block and as UI buttons);
each maps to a tasklist. Invoking an action runs that tasklist; the result is the
tasklist's goal task output.

## Agent `config.json`

```json
{
  "knowledge": {
    "<domain>": { "<field>": true | ["<option>", ...] }
  },
  "functions": ["FunctionName", ...],
  "components": ["ComponentName", ...]
}
```

- `functions` scopes which space functions this agent can call
- `true` on a knowledge field = enabled, loaded on demand via `loadKnowledge()`
- Array on a knowledge field = pre-loaded into system prompt at session start

## Session end

No sink. A session/turn loop ends when the agent emits a turn containing **no pending
value-yielding await** — there is nothing left to resume, so the agent is done.
- Top-level: the session ends; final state/`display` output is the result surface.
- Delegated / fork: the result is the invoked action's tasklist **goal output** (mode 1:
  coerced to the requested `output` schema).

## Tasklist `<slug>/` — directory of numbered step files

A tasklist is a **directory** named after the tasklist (the name passed to
`tasklist("make_pasta")`). Each task node is its own numbered markdown file: the
frontmatter defines the node (`id`, `dependsOn`, `output`, `condition`, `optional`,
`goal`); the body is the instruction. Numbering is for ordering/display — the DAG
shape comes from `dependsOn`.

```
tasklists/make_pasta/
├── 1. Boil water.md
├── 2. Make sauce.md
├── 3. Cook pasta.md
├── 4. Combine.md
└── 5. Garnish.md
```

```yaml
# tasklists/make_pasta/1. Boil water.md
---
id: boil_water
output:
  ready: boolean
  potId: string
  saltiness: number
---
Fill a pot with water, salt it, bring to a rolling boil.
```

```yaml
# tasklists/make_pasta/3. Cook pasta.md
---
id: cook_pasta
dependsOn: [boil_water]
output:
  drained: boolean
  potId: string
---
Cook pasta in the boiling salted water.
```

```yaml
# tasklists/make_pasta/4. Combine.md
---
id: combine
dependsOn: [cook_pasta, make_sauce]
goal: true                       # terminal node; its output is the tasklist result
output:
  dish: string
  servings: number
---
Combine the drained pasta with the sauce and plate it.
```

```yaml
# tasklists/make_pasta/5. Garnish.md
---
id: garnish
dependsOn: [combine]
optional: true                   # failure does not block the goal
condition: combine.servings > 1 AND make_sauce.sauce == "tomato"
output:
  garnished: boolean
---
Add a basil garnish.
```

## Functions

- One `.ts` file per function; exported name = global name in sandbox
- Full type annotations on parameters and return — extracted into `.d.ts` overlay
- Exported interfaces included in overlay
- Run on host (Node.js); async is fine; throw on error

## Knowledge

Three-level hierarchy: domain → field → option.

- `knowledge/<domain>/config.json` — domain metadata (`label`)
- `knowledge/<domain>/<field>/config.json` — field metadata (`type`, `variableName`, `default`)
- `knowledge/<domain>/<field>/<option>.md` — YAML frontmatter + markdown body
