# LMThing Space & API Documentation

This guide covers the development of Workspaces (Spaces), the execution architecture, and the `@lmthing/core` and `@lmthing/cli` APIs for LMThing.

## 1. Overview & Architecture

LMThing is an LLM agent runtime where models drive programs by writing TypeScript. The core execution model is:
- **Sandbox:** The host evaluates statements one at a time in a QuickJS WASM sandbox.
- **Turn Loop:** The model streams TypeScript statements.
- **Value-yielding:** Calls like `ask()`, `sleep()`, and `fork()` abort the stream, hand control to the host, and resume on the next turn, with resolved values injected as bound variables.
- **Spaces:** A self-contained workspace representing a domain with agents, workflows (tasklists), custom React components, knowledge bases, and utility functions.

---

## 2. Space Specification

A "Space" is defined by a standard file system architecture. It encapsulates the context, tools, and UI an agent needs.

### Directory Structure

```
<space-slug>/
├── package.json              # optional: for npm dependencies
├── agents/                   # AI specialists
│   └── <agent-slug>/
│       ├── config.json       # accessible functions/components/knowledge
│       └── instruct.md       # required: YAML frontmatter + system prompt
├── functions/                # optional: utility functions (TS)
│   └── <functionName>.ts
├── components/               # optional: custom UI
│   ├── view/                 # display components
│   │   └── <ComponentName>.tsx
│   └── form/                 # interactive inputs
│       └── <Name>.tsx
├── tasklists/                # optional: DAG workflows
│   └── <tasklist-slug>/
│       └── NN-<task-id>.md   # numbered, sorted lexically execution steps
└── knowledge/                # optional: structured domain data
    └── <domain-slug>/
        └── <field-slug>/
            ├── index.md      # field metadata (frontmatter) + OVERVIEW body covering all aspects
            ├── <aspect-a>.md # one aspect of the field (loaded on demand)
            └── <aspect-b>.md # …several aspects, not a single "overview.md"
```

A field's `index.md` body is its **overview** (a short summary of every aspect) and is
surfaced into the agent's prompt automatically; the agent loads a specific `<aspect>.md`
with `loadKnowledge(domain, field, 'aspect.md')` only when it needs the detail. Put the
overview in `index.md` — do NOT create a single `overview.md` option.

### Agents (`agents/<slug>/`)
Every agent requires an `instruct.md` file detailing its configuration via YAML frontmatter and its system prompt via markdown body.
```yaml
---
title: <Agent Display Name>
knowledge: [<domain>/<field>, ...]             # refs to knowledge/ tree
functions: [<functionName>, ...]               # refs to functions/ files
components: [<ComponentName>, ...]             # refs to components/ (view or form)
canDelegateTo: [<space-ref>/<agent-slug>, ...]  # delegation policy — see table below
defaultAction: <action-id>                     # optional: robust freeform fallback
actions:
  - id: <action-id>
    label: "Display Label"
    description: "Long description"
    tasklist: <tasklist-slug>                  # refers to tasklists/<slug>/
---

You are an expert agent... (System Prompt)
```
`config.json` can alternatively be used to define function accessibility.

`canDelegateTo` is a **delegation policy** with unified semantics (the same table applies to a
task's frontmatter `canDelegateTo`, where the *omitted* default is "no delegation" instead):

| Value | Meaning (agent level) |
|---|---|
| omitted | unrestricted delegation (back-compat default) |
| `[]` | **no delegation** — the `delegate` global is not injected and absent from the typecheck DTS; the loader warns (`use ["*"] for unrestricted`) |
| `["*"]` | explicitly unrestricted |
| explicit list | hard allowlist enforced at call time — `"space/agent"` (any action) or `"space/agent#action"` (that action only); a violating `delegate()` throws an error naming the allowed targets |
| `"registered:*"` entry | additionally allow any space registered at runtime via `registerSpace()` |

### Capabilities (`capabilities:` frontmatter)

An agent can additionally declare **project-app capability grants** — the powers behind a
project's `database/pages/api/hooks` (see **§7 Project Apps**). Each `capabilities:` list entry is
either a **bare capability id** (full scope) or a **single-key map** carrying that capability's
config (narrowed scope). A capability not listed is not injected as a global, **and is stripped
from the agent's typecheck DTS** — a stray call fails typecheck, not just at runtime.

```yaml
capabilities:
  - db:read: { tables: [sources, raw_items] }   # narrowed: only these tables
  - db:write: { tables: [raw_items] }           # per-verb scope — read wide, write narrow
  - api:call: { allow: [webSearch, markRead] }  # the allowlist IS api:call's config
  - pages:write                                 # bare = full scope
```

| Capability | Unlocks | Config |
|---|---|---|
| `db:read` | `db.query`, `db.tables` | optional `{ tables: [...] }` (bare = all tables) |
| `db:write` | `db.insert`, `db.update`, `db.remove` | optional `{ tables: [...] }` |
| `db:schema` | `db.createTable`, `db.addColumn`, `writeTableSchema` | optional `{ tables: [...] }` |
| `pages:write` | `writePage(route, src)` | bare only |
| `api:write` | `writeApi(route, src)` | bare only |
| `hooks:write` | `writeHook(slug, def)` | bare only |
| `api:call` | `apiCall(name, input)` | **required** `{ allow: [...] }` — there is no "call anything" |
| `project:manage` | `createProject(id, opts)`, `selectProject(id)` | bare only |

Validation is **fail-loud**: an unknown capability id, an unknown config key, a `db:*` `tables`
entry naming a table absent from the project's `database/`, a config payload given to a bare-only
capability, or a bare `api:call` (its `allow` list is required) all throw and abort the space load.

**All top-level frontmatter keys are validated against an allow-list** — `title`, `knowledge`,
`functions`, `components`, `actions`, `defaultAction`, `canDelegateTo`, `dependencies`,
`capabilities`. An unrecognized key (e.g. a typo'd `capabilties`) throws instead of being silently
ignored.

### Functions (`functions/*.ts`)
Functions are synchronous TypeScript exports that utilize the core host primitives. No Node.js imports are allowed.
```typescript
/**
 * Executes a calculation
 */
export function calculateThing(input: string): string {
    // Only host primitives available: fetch, execShell, readFileRaw, writeFileRaw, typecheckSource
    return "Calculated: " + input;
}
```

### Tasklists (`tasklists/<slug>/*`)
Tasklists provide deterministic, step-by-step DAG orchestrations. Files must be numbered (e.g. `01-setup.md`, `02-execute.md`).
```yaml
---
id: <task-id>
output:
  resultFlag: boolean
dependsOn: [<prior-task-id>]
optional: false
---

Task instruction for the model.
End by calling:
currentTask.resolve({ resultFlag: true })
```

### Components (`components/`)
Components give agents rich interactive capabilities.
- **View components (`components/view/*.tsx`)**: Simple React elements for displaying data visually using `display()`.
- **Form components (`components/form/<Name>.tsx`)**: Used with `ask()`. A single TSX file built from catalog components, exactly like a view component. The former `web.tsx`/`ink.tsx` two-file split has been removed.

### Knowledge (`knowledge/`)
A hierarchical context base injected into an agent.
- `index.md`: Defines the field type (`string`, `select`, `multiSelect`).
- `option.md`: A selectable knowledge item injected into the context via YAML metadata.

---

## 3. Core API & Globals

The QuickJS sandbox exposes several critical functions for the LLM to wield.

### Value-Yielding Globals
These pause execution to interact with the host or user:
- `ask(formComponent?)`: Pauses to wait for human input. Can present interactive `components/form`.
- `sleep(ms)`: Pauses execution.
- `fork({ role: 'explore'|'general'|'plan', instruction: string })`: Spawns a parallel subagent in an isolated VM.
- `delegate(spaceKey, agentSlug, action?, opts?)`: Defers execution to another specific agent.
- `tasklist(name, context?)`: Invokes a deterministic sequence of tasks (DAG).

### Utility Globals
- `display(viewComponent)`: Emits a standard React / Ink view component output.
- `inspect(variable)`: Probes large variable data back into the typecheck scope context.
- `loadKnowledge(path)`: Dynamically reads knowledge base fields.
- `registerSpace(dirpath)`: Registers a new custom space for future delegation.

### Host Privileges
Available inside TS `functions/`:
- `fetch(url, opts)`: Request web resources (backed by curl). Returns `{ ok, status, text(), json() }`.
- `execShell(cmd)`: Execute shell commands locally. Returns `{ ok, stdout, stderr }`.
- `readFileRaw(path, opts)`: Read file data. Returns `{ ok, content, lines, truncated }`.
- `writeFileRaw(path, content)`: Replaces a file's contents. Returns `{ ok, bytes }`.
- `typecheckSource(src)`: Typecheck a standalone TS source string against the library DTS. Returns `{ ok, errors }` ("Cannot find name" diagnostics are ignored; syntax + real type errors surface).

---

## 4. Execution Runtime Invariants

- **Sync Eval Loop:** Statements are evaluated synchronously. The result is yielded to the host, and once resolved, injected as global variables for the subsequent turns.
- **Host-side Yield Binding:** A bound value (e.g. `const x = await ask()`) does not continue execution via standard Javascript Promise continuations. The turn loop resolves the yield and binds `x` host-side upon resuming.
- **System Merging:** LMThing always merges the system spaces into all user spaces. The `system-global` space's functions (e.g. `readFile`, `execShell`, `grep`) are universally accessible without specific configuration.

---

## 5. CLI API & Tooling

To run and debug agents from the command line, use `@lmthing/cli`:

- **Run an agent (REPL mode)**
  ```bash
  node libs/cli/dist/cli/bin.js --space ./fixtures/<space-slug> --agent <agent-slug> --repl
  ```

- **Observability Interface (Web UI)**
  Boot a web-based inspector to trace agent thought processes, executions, forks, and variable states:
  ```bash
  node libs/cli/dist/cli/bin.js --space ./fixtures/<space-slug> --web 3000
  ```

- **Mock Mode (Testing without LLM Keys)**
  Use `--mock` to use a hardcoded TypeScript output instead of hitting the live OpenAI / Claude APIs:
  ```bash
  node libs/cli/dist/cli/bin.js --space ./fixtures/<space-slug> --mock ./fixtures/mock.mjs
  ```

---

## 6. Hello World Complete Example

A minimal space that asks for a user's name and greets them via a custom function and tasklist.

**Directory Setup**
```
hello-world/
├── package.json
├── agents/
│   └── greeter/
│       └── instruct.md
├── functions/
│   └── makeGreeting.ts
└── tasklists/
    └── run_greet/
        ├── 01-get-name.md
        └── 02-print-greet.md
```

**`hello-world/package.json`**
```json
{
  "name": "hello-world-space",
  "version": "1.0.0"
}
```

**`hello-world/agents/greeter/instruct.md`**
```yaml
---
title: Greeter
functions: [makeGreeting]
actions:
  - id: greet
    label: "Greet User"
    tasklist: run_greet
---

You are the Greeter agent. Your responsibility is to use the `run_greet` tasklist to output a friendly greeting.
```

**`hello-world/functions/makeGreeting.ts`**
```typescript
export function makeGreeting(name: string): string {
    return `Hello there, ${name}! Welcome to LMThing.`;
}
```

**`hello-world/tasklists/run_greet/01-get-name.md`**
```yaml
---
id: get-name
output:
  username: string
---

Ask the user for their name using the `ask()` global.

Resolve: currentTask.resolve({ username: <name> })
```

**`hello-world/tasklists/run_greet/02-print-greet.md`**
```yaml
---
id: print-greet
output:
  success: boolean
dependsOn: [get-name]
---

You have the user's name in `username`.
1. Call `makeGreeting(username)` to generate the string.
2. Display the resulting string using `display(<Text>{greeting}</Text>)`
3. Resolve the task with success boolean.

Resolve: currentTask.resolve({ success: true })
```

Run this Hello World space with:
```bash
node libs/cli/dist/cli/bin.js --space ./hello-world --agent greeter --repl
```

---

## 7. Project Apps

A **project** can own an application: `database/ pages/ api/ hooks/` at the **project root**
(siblings of `spaces/`, not inside any one space). Spaces stay the reusable "agent capability"
layer (§2); the project is the app + its data — several spaces in one project can share the same
database and pages. See [project-as-application.md](./project-as-application.md) for the full
design (serving/domains, Studio admin, safety, boot sequence); this section is the quick reference
for authoring one.

### `database/<table>.json` — the data model

One JSON file per table (table name = file basename). The table **and every column and relation
require a `description`** — the schema is the agent's mental model of the data, not just its
shape; the loader fails loud on any missing one.

```json
{
  "title": "Feed items",
  "description": "One personalized item in the user's feed.",
  "columns": {
    "id":    { "type": "string",  "description": "unique id", "primaryKey": true, "generated": "uuid" },
    "title": { "type": "string",  "description": "headline", "required": true },
    "read":  { "type": "boolean", "description": "opened yet", "default": false }
  },
  "relations": {
    "comments": { "hasMany": "comments", "via": "feedItemId", "description": "notes attached" }
  }
}
```

- Column `type`: `string | number | boolean | date | json`. Flags: `primaryKey` (exactly one,
  `generated: "uuid"` recommended), `required`, `unique`, `default`, `generated` (`uuid`|`now`).
- `references: { table, column?, onDelete? }` maps to a real SQLite `FOREIGN KEY` (`onDelete`:
  `cascade`|`setNull`|`restrict`, default `restrict`).
- `relations` name navigable links (`belongsTo`/`hasMany` + `via`), driving generated typed
  relation fields (e.g. `FeedItem.comments: Comment[]`) and `db.query(table, { include: [...] })`
  joins.
- Evolution is additive-lenient only — new tables/columns via `createTable`/`addColumn`; a
  rename/drop/type-change diverging from the live schema fails loud at boot rather than silently
  dropping data.

### Two db surfaces — sync in the agent, async on the Node side

One schema (`libs/core/src/db/schema.ts`) drives one `DbApi` interface with **two typed surfaces**
(`libs/core/src/db/types.ts`):

- **Agent sandbox — synchronous.** `db.query`/`tables`/`insert`/`update`/`remove`/`createTable`/
  `addColumn` is an execShell-class host call (SQLite in the same process, no turn boundary).
  Gated per verb by the `db:read`/`db:write`/`db:schema` capabilities (§2).
- **Node handlers (`api/`/`hooks/`) — `AsyncDbApi`.** The identical method set, each returning a
  `Promise` — a cross-thread message-channel proxy to the main process (`await ctx.db.update(...)`),
  because the handler runs worker-isolated. Every write still executes in the **main** process
  (what keeps hook dispatch and the loop guard sound); the worker is a crash boundary, not a second
  writer.

### `api/<route>/<METHOD>.ts` — named, typed Node handlers

The endpoint route is a directory; the HTTP method is the filename (`GET.ts`/`POST.ts`/`PUT.ts`/
`PATCH.ts`/`DELETE.ts`). Each exports a stable `name` (the agent-facing id), a `description`,
`Input`/`Output` interfaces, and a default **async** handler:

```ts
// api/mark-read/POST.ts → HTTP POST ".../api/mark-read" ; agent name "markRead"
export const name = 'markRead';
export const description = 'Mark a single feed item read, by its id.';
export interface Input  { id: string }
export interface Output { ok: boolean }

export default async function handler(
  input: Input,
  ctx: { db: AsyncDbApi; spawn: SpawnFn; apiCall: ApiCallFn },
): Promise<Output> {
  const n = await ctx.db.update('feed_items', { where: { id: input.id }, set: { read: true } });
  return { ok: n > 0 };
}
```

- **Dual-addressed**: the browser calls the HTTP route + method; an agent calls by `name` via the
  typed `apiCall('markRead', { id })`. `name` is unique per project (fail-loud on a duplicate).
- Runs in **Node, worker-isolated** — a crash boundary for the app, not a security boundary (the
  per-user pod is). TS + JSDoc are the single source of truth: `ts-json-schema-generator` emits a
  JSON Schema per endpoint that drives **ajv** request validation, a typed `apiCall` overload
  injected into the calling agent's DTS, and the client's typed `useApi`/`useApiMutation`.
- A handler may `ctx.spawn('space/agent#action', input, { onError })` to kick a headless agent run
  fire-and-forget (returns a `runId`; `onError` fails-close any pending row it wrote).

### `pages/*.tsx` — client-side React

File-based routing: `pages/index.tsx` → `/`, `pages/items/[id].tsx` → `/items/:id`; `_app.tsx` /
`_layout.tsx` are non-route wrappers (root providers / persistent chrome). A page is a
default-exported component; route params arrive as `params`, and data comes from **`@app/runtime`**
— never a pod-side loader:

```tsx
// pages/items/[id].tsx → route /items/:id
import { useApi } from '@app/runtime'
export default function ItemPage({ params }: { params: { id: string } }) {
  const { data: item, isLoading } = useApi('getItem', { id: params.id })  // typed to endpoint I/O
  if (isLoading) return <Spinner />
  return <article><h1>{item.title}</h1></article>
}
```

`useApi(name, input)` is a typed query hook (`{ data, error, isLoading, refetch }`);
`useApiMutation(name, { invalidates? })` is a typed mutation (`{ mutate, isPending, error }`); the
bare `apiCall(name, input)` covers one-shot/non-React calls. Styling uses `@lmthing/css` design
tokens only — the same hard token gate as every other web surface. A page may also drop in
**`<Chat agent="space/agent" />`** (from `@app/runtime`) for a live, full-capability conversation
with a project agent — the one place the catalog descriptor renderer lives inside an app.

### `hooks/<slug>.ts` — unified triggers

A default-exported hook object, `type: 'cron'` (`every: '<n>(m|h|d)'`, clamped ≥5m, or `daily:
'HH:MM'`) or `type: 'database'` (`on: { table, event: 'insert'|'update'|'remove' }`), each either
**declarative** (`trigger: 'space/agent#action'`) or **imperative** (`handler: async ({ row, db,
delegate }) => {...}`). `database` dispatch is **in-process and decoupled from the write** — a
`db.*` write enqueues matching hooks and returns immediately; the queue drains on the event loop
after the current eval unwinds (never re-entrant). `cron` rides the pod's native crond in
production (regenerated on boot) and an in-process 60s tick in local dev. A host-enforced **loop
guard** (depth cap, self-write exclusion, per-hook cooldown/coalesce) applies regardless of what an
agent authors.

### The capability model gates every surface

None of the above is ambient — every `db`/`pages:write`/`api:write`/`hooks:write`/`api:call` power
is off unless the authoring agent's frontmatter grants it (§2 Capabilities). There is no default
app access; even THING (the top-level chat agent) holds no app capabilities of its own.

### `system-appbuilder` — the space that builds apps

THING never authors an app directly — it **delegates** to the system space `system-appbuilder`
(`libs/core/system-spaces/system-appbuilder/`), which supplies five least-privilege agents:

| Agent | Capabilities | Role |
|---|---|---|
| `app-architect` | `project:manage` + the full authoring set + delegation to the other four | binds/creates the target project, plans, fans out |
| `data-modeler` | `db:schema`, `db:read` | designs/evolves tables |
| `page-builder` | `pages:write`, `db:read` | authors pages |
| `api-author` | `api:write`, `db:read` | authors named typed endpoints |
| `automator` | `hooks:write` | wires cron/db hooks |

Its `build_app` tasklist decomposes a request into `design → create_project → build_table[] →
build_api[] → build_page[] → build_hook[] → finalize` — one authoring call per file, the same
incremental, per-file scaffolding discipline `system-architect` uses for plain spaces (never one
giant scaffold call). See [project-as-application.md](./project-as-application.md) for the rest —
serving/domains, Studio admin/dev, safety rules, and the boot sequence.