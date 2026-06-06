# Creating a Space

A **space** is a self-contained directory that packages agents, flows, functions, UI components, and domain knowledge for one problem area. The `llm-repl` CLI loads it via `--space <path>`, wires the host-side functions into the QuickJS sandbox, and drives an LLM through a structured multi-cycle session.

This document covers everything needed to author a production-quality space from scratch.

---

## Table of contents

1. [Concepts](#1-concepts)
2. [Directory layout](#2-directory-layout)
3. [package.json and tsconfig.json](#3-packagejson-and-tsconfigjson)
4. [index.ts — the host-function bridge](#4-indexts--the-host-function-bridge)
5. [Agents](#5-agents)
6. [Flows](#6-flows)
7. [Functions](#7-functions)
8. [Components](#8-components)
9. [Knowledge](#9-knowledge)
10. [Cross-space delegation](#10-cross-space-delegation)
11. [Running a space](#11-running-a-space)
12. [Agent coding patterns](#12-agent-coding-patterns)
13. [Minimal-space checklist](#13-minimal-space-checklist)

---

## 1. Concepts

### What a space is

A space bundles:

| Part | Purpose |
|------|---------|
| **Agents** | Prompt files — who the LLM is and what it can do |
| **Flows** | Multi-step workflow definitions with a task DAG and a sink |
| **Functions** | Host-side TypeScript that runs in Node.js, callable as globals inside QuickJS |
| **Components** | React UI components (view or form) rendered in the web surface |
| **Knowledge** | Structured domain docs injected into the system prompt on demand |

### How the runtime uses a space

1. CLI parses `--space <path>` and calls `loadSpaceFromDisk()`.
2. `index.ts` is dynamically imported; every entry in `hostFunctions` is injected as a QuickJS global.
3. TypeScript signatures are extracted from `functions/*.ts` and `components/**/*.tsx` via `ts.transpileDeclaration()` and spliced in as an ambient `.d.ts` overlay — the LLM's code type-checks against them.
4. The agent's `instruct.md` and the active flow step are composed into a system prompt by `buildAgentPrompt()`.
5. The LLM runs TypeScript in the sandbox; each `await inspect()` commits state and reconstructs context for the next cycle.
6. When the LLM calls the flow's sink function (e.g. `submitBrief(markdown)`), the session ends.

### Session state

The sandbox is a persistent QuickJS isolate. Variables survive across cycles (inspections). Every `inspect()` call commits a snapshot to git so state can be rolled back with `rollback()` or `checkpoint()`.

---

## 2. Directory layout

```
my-space/
├── package.json                  # required
├── tsconfig.json                 # required
├── index.ts                      # required — host-function bridge
├── README.md                     # recommended
│
├── agents/
│   └── <agent-slug>/
│       ├── instruct.md           # required — role + instructions (YAML frontmatter + body)
│       └── config.json           # required — declares knowledge, functions, components
│
├── flows/
│   └── <flow-slug>/
│       ├── index.md              # required — task DAG + sink (YAML frontmatter + summary body)
│       ├── 1.<StepName>.md       # required — instructions for cycle 1
│       ├── 2.<StepName>.md       # optional — cycle 2, 3, …
│       └── N.<StepName>.md
│
├── functions/
│   └── <FunctionName>.ts         # one file per host function; exported name = global name
│
├── components/
│   ├── view/
│   │   └── <Name>.tsx            # read-only display components
│   └── form/
│       └── <Name>.tsx            # interactive form components
│
└── knowledge/
    └── <domain>/
        ├── config.json           # domain metadata
        └── <field>/
            ├── config.json       # field metadata
            └── <option>.md       # content — YAML frontmatter + markdown body
```

**Slugs** (agent names, flow names, task IDs) must be lowercase with hyphens or underscores — no spaces. They appear as directory names, frontmatter keys, and are passed to `tasklist()` at runtime.

---

## 3. package.json and tsconfig.json

### package.json

```json
{
  "name": "my-space",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "One-line description of what this space does",
  "exports": {
    ".": {
      "types": "./index.ts",
      "import": "./index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@lmthing/llm-repl": "workspace:*",
    "zod": "^4.1.13"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

Key points:
- `"name"` must be unique across all spaces in the monorepo — it is the identifier passed to `Space.load("name")` from other spaces.
- `"type": "module"` is required; the runtime imports `index.ts` as ESM.
- `"private": true` prevents accidental publication.

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
```

`module: NodeNext` + `moduleResolution: NodeNext` are required for the `.js` import extensions that ESM demands. `strict: true` and `noUncheckedIndexedAccess: true` match the project-wide baseline.

---

## 4. index.ts — the host-function bridge

`index.ts` is the single entry point imported by the CLI. It must export one named export: `hostFunctions`.

```ts
// index.ts

import { mySearch } from "./functions/mySearch.js";
import { myFetch }  from "./functions/myFetch.js";

export const hostFunctions: Record<string, (...args: unknown[]) => unknown> = {
  mySearch: (...a) => mySearch(a[0] as string, a[1] as never),
  myFetch:  (...a) => myFetch(a[0] as string, a[1] as never),
};
```

Rules:
- The key in `hostFunctions` is the name visible inside the sandbox. It must match the exported function name in the `functions/` file exactly (same casing) — this is what the `.d.ts` overlay uses.
- Use `a[N] as never` to pass variadic args cleanly without TypeScript complaining about the broad `unknown[]` signature. The real types come from the `.d.ts` overlay.
- Import with `.js` extensions (required by Node ESM resolution even for `.ts` source files when `moduleResolution: NodeNext`).
- This file runs on the host (Node.js), not inside QuickJS. All Node.js APIs are available here.

---

## 5. Agents

An agent is a directory under `agents/<slug>/` with two files.

### instruct.md

The YAML frontmatter declares the agent's identity and available actions. The markdown body is the system prompt section describing role, capabilities, coding patterns, and rules.

**Frontmatter spec:**

```yaml
---
title: My Agent                  # human-readable name shown in UI
actions:
  - id: do_something             # action ID — maps to a flow slug
    label: Do the thing          # button label in the UI
    description: What it does    # tooltip / description
    flow: my_flow                # must match a directory under flows/
  - id: another_action
    label: Another thing
    description: Second action
    flow: another_flow
---
```

- `title` is required.
- `actions` is a list of entry points the user can invoke from the UI. Each `flow` value must match a directory name under `flows/`.
- An agent can have zero actions (ad-hoc conversational agent with no structured flow).

**Body guidelines:**

Write the body in markdown. It is injected verbatim into the system prompt. Structure it as:

```markdown
You are the **<name>** agent. <One-sentence role description>.

## Capabilities

- What this agent can do, as bullet points.
- Reference available host functions by name.
- Describe specialist knowledge domains used.

## <Pattern section>  (e.g. "Fork patterns", "Delegation", "Persistence")

Code examples showing the agent how to use each capability.
Include model-size hints in fork instructions (see §12).

## Rules

- Short, unambiguous rules the agent must follow.
- One rule per bullet.
```

**Example:**

```markdown
---
title: Analyst
actions:
  - id: analyse
    label: Run analysis
    description: Fetch data, process it, and produce a structured report
    flow: analyse
---

You are the **analyst** agent. You fetch data from external APIs, process it with host functions, and produce structured markdown reports.

## Capabilities

- Use `fetchData(endpoint, opts)` to retrieve records from the API.
- Use `aggregateRows(rows, groupBy)` to summarise tabular data.
- Fork parallel data fetches when the dataset has independent partitions.
- Pin key results with `pin("results")` so they survive context compaction.

## Fork patterns

For independent fetches, fork one worker per endpoint:

```ts
const forkA = fork<DataRow[]>({
  instruction: "[model:S] Fetch records from /api/sales and return DataRow[].",
  tokenBudget: 3000,
});
const forkB = fork<DataRow[]>({
  instruction: "[model:S] Fetch records from /api/returns and return DataRow[].",
  tokenBudget: 3000,
});
await inspect(forkA, forkB);
// next cycle: forkA and forkB hold their results
\```

## Rules

- Never fabricate numbers from external APIs. If `fetchData` fails, report the error.
- Checkpoint before overwriting a saved report: `checkpoint("before-overwrite")`.
- Always call `pin("results")` after the first successful data fetch.
```

### config.json

Declares which knowledge domains, functions, and components this agent uses:

```json
{
  "knowledge": {
    "<domain>": {
      "<field>": true | ["<option>", "<option>"]
    }
  },
  "functions": ["FunctionName1", "FunctionName2"],
  "components": ["ComponentName"]
}
```

The `knowledge` value for a field controls what is available at session start:

| Value | Behaviour |
|-------|-----------|
| `true` | The field is enabled; the agent can load options from it dynamically at runtime via `Space.current().loadKnowledge(...)`. No options are pre-loaded. |
| `["option1", "option2"]` | Those specific options are pre-loaded into the system prompt at session start. The agent has their content from cycle 1 without any explicit load call. |

Use `true` when the agent selects which option applies based on context (e.g. the user's intent determines which strategy mode to load). Use an array when certain options are always needed regardless of context.

- `functions` lists function names to expose; must match keys in `hostFunctions`.
- `components` lists component names to include in the DTS overlay.

**Example:**

```json
{
  "knowledge": {
    "cuisine": { "style": ["italian", "french"] },
    "technique": { "method": true },
    "dietary": { "restriction": true }
  },
  "functions": ["fetchData", "aggregateRows"],
  "components": ["DataTable", "ReportForm"]
}
```

Here `cuisine/style` pre-loads the Italian and French option bodies at session start. `technique/method` and `dietary/restriction` are enabled but empty until the agent calls `loadKnowledge` to pull in the specific option it needs.

---

## 6. Flows

A flow is a multi-cycle workflow. It lives under `flows/<flow-slug>/` with one `index.md` and one or more numbered step files.

### index.md — the flow manifest

The frontmatter defines the entire workflow shape. The body is a human-readable summary (shown in trace and UI, not injected into the agent prompt).

**Full frontmatter spec:**

```yaml
---
title: My Flow
description: One-sentence description of what this flow produces
defaultAgent: <agent-slug>    # agent to use if none is specified on the CLI
maxCycles: 6                   # hard limit on LLM cycles before the session is forced to end

sink:
  name: submitResult                          # function name the agent calls to end the session
  signature: (result: MyResultType) => void  # TypeScript signature (declared as ambient global)
  description: Submit the final result and end the session

tasks:
  <taskId>:
    description: What the agent should accomplish in this task
    dependsOn: [<taskId>, ...]   # list of tasks that must complete first (omit for entry tasks)
    optional: true               # if set, failure does not block dependent tasks
    outputSchema:
      type: object
      required: [field1, field2]
      properties:
        field1: { type: string }
        field2: { type: number }
        field3: { type: array, items: { type: string } }
        field4: { type: object }
        field5: { type: boolean }
---

Narrative summary of the flow phases, agent assignments, and expected outcomes.
```

**Task DAG rules:**

- Every task without `dependsOn` is an entry point — it can start immediately.
- `dependsOn` is an array of task IDs that must reach `finished` state before this task's `start()` call succeeds. The runtime enforces this.
- `optional: true` means a task that fails (throws before calling `finish`) does not block its dependents.
- `outputSchema` is a JSON Schema object validated by `tasklist().finish(taskId, value)`. If validation fails, the cycle ends with an error. Keep schemas tight — it prevents the agent from submitting incomplete results.
- Task IDs must be valid JavaScript identifiers (no hyphens; use underscores).

**Example `index.md`:**

```yaml
---
title: Data Report
description: Fetch, aggregate, and present a structured data report with a human-readable summary
defaultAgent: analyst
maxCycles: 8
sink:
  name: submitReport
  signature: (report: { title: string; summary: string; rows: object[] }) => void
  description: Submit the completed report
tasks:
  fetch:
    description: Retrieve raw records from the data source. Handle errors gracefully.
    outputSchema:
      type: object
      required: [rows, fetchedAt]
      properties:
        rows: { type: array }
        fetchedAt: { type: string }
  aggregate:
    description: Group and summarise the fetched rows by category.
    dependsOn: [fetch]
    outputSchema:
      type: object
      required: [groups]
      properties:
        groups: { type: array }
  draft:
    description: Write a markdown summary of the aggregated data.
    dependsOn: [aggregate]
    outputSchema:
      type: object
      required: [summary]
      properties:
        summary: { type: string }
  submit:
    description: Call submitReport with the completed report.
    dependsOn: [draft]
---

Two-phase reporting flow:

| Phase (cycle) | Tasks |
|---------------|-------|
| 1 — Collect | `fetch` → `aggregate` |
| 2 — Report  | `draft` → `submit`    |
```

### Step files: `N.<StepName>.md`

Each step file maps to a cycle. `N` is the 1-based cycle number. `<StepName>` is a descriptive label (no spaces; PascalCase conventional).

**Frontmatter (optional):**

```yaml
---
step: 1
name: FetchAndAggregate
agent: analyst
tasks: [fetch, aggregate]
---
```

The frontmatter is informational; the `name` becomes `activeStepName` in the built prompt.

**Body:** instruction text telling the agent exactly what to do in this cycle — which tasks to start/finish, which globals to call, which patterns to use. Include code scaffolding for the expected structure:

```markdown
---
step: 1
name: FetchAndAggregate
agent: analyst
tasks: [fetch, aggregate]
---

# Phase 1 — Fetch and aggregate

Declare the tasklist, then run `fetch` and `aggregate`.

\```ts
const __flow = tasklist("data_report", { /* DAG literal from harness */ });

// ── fetch ─────────────────────────────────────────────────────────────────
__flow.start("fetch");
const rawRows = await fetchData("/api/records", { limit: 200 }) as DataRow[];
__flow.finish("fetch", { rows: rawRows, fetchedAt: new Date().toISOString() });

// ── aggregate ─────────────────────────────────────────────────────────────
__flow.start("aggregate");
const groups = await aggregateRows(rawRows, "category") as AggregatedGroup[];
__flow.finish("aggregate", { groups });

// ── yield ─────────────────────────────────────────────────────────────────
await inspect(rawRows, groups);
\```

End the cycle here. Cycle 2 will receive `rawRows` and `groups` in reconstructed scope.

## Notes

- If `fetchData` throws, call `__flow.fail("fetch", error.message)` and `await inspect()` to yield for retry.
- `aggregateRows` is synchronous — no await needed.
```

**How many step files?** One per logical phase. A flow with `maxCycles: 6` can have 1–6 step files. The runtime maps cycle number to file number; if the cycle number exceeds the last step file, the last step is re-used.

### The sink

The sink is the terminal signal. When the agent calls the sink function (e.g. `submitReport({ title, summary, rows })`), the runtime captures the argument and ends the session.

The sink is declared in the ambient DTS as:

```ts
declare const submitReport: (report: { title: string; summary: string; rows: object[] }) => void;
```

No import, no definition — just call it when the work is done. The agent must call the sink to end a session cleanly; if `maxCycles` is reached without a sink call, the session ends with a timeout.

---

## 7. Functions

Host functions are TypeScript files in `functions/`. They run in Node.js (outside the sandbox) and are bridged into QuickJS as globals.

### Writing a function

```ts
// functions/fetchData.ts

export interface DataRow {
  id: string;
  category: string;
  value: number;
  timestamp: string;
}

export interface FetchDataOptions {
  limit?: number;
  since?: string;   // ISO date string
}

export async function fetchData(
  endpoint: string,
  opts: FetchDataOptions = {},
): Promise<DataRow[]> {
  const url = new URL(endpoint, process.env.API_BASE_URL);
  if (opts.limit) url.searchParams.set("limit", String(opts.limit));
  if (opts.since) url.searchParams.set("since", opts.since);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.API_KEY}` },
  });
  if (!res.ok) throw new Error(`fetchData ${endpoint} → ${res.status}`);
  return res.json() as Promise<DataRow[]>;
}
```

### Key rules for functions

- **Export exactly one named function** with the same name as the file (e.g. `fetchData` in `fetchData.ts`). The DTS overlay is extracted from the export signature.
- **Full type annotations** on parameters and return type — the LLM sees these types and uses them to write type-safe code.
- **Async is fine.** The sandbox awaits the Promise automatically.
- **Throw on error.** The sandbox captures thrown errors and surfaces them to the agent; don't swallow errors silently.
- **Use environment variables** for credentials. Never hardcode secrets.
- **Interfaces exported at the top** of the file are included in the DTS overlay; the LLM can use them in type annotations.

### Registering in index.ts

Add the function to `hostFunctions` in `index.ts`:

```ts
import { fetchData } from "./functions/fetchData.js";

export const hostFunctions: Record<string, (...args: unknown[]) => unknown> = {
  fetchData: (...a) => fetchData(a[0] as string, a[1] as never),
};
```

The `a[1] as never` idiom passes the options object through without TypeScript objecting to the broad `unknown[]` signature. The LLM's code is validated against the real type from the DTS overlay.

---

## 8. Components

Components are React files in `components/view/` (read-only display) or `components/form/` (interactive input). They are optional — many spaces have no components.

### View component

```tsx
// components/view/DataTable.tsx

export interface DataTableProps {
  rows: Array<{ id: string; category: string; value: number }>;
  title?: string;
}

export function DataTable({ rows, title }: DataTableProps) {
  return (
    <div>
      {title && <h2>{title}</h2>}
      <table>
        <thead>
          <tr><th>ID</th><th>Category</th><th>Value</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}><td>{r.id}</td><td>{r.category}</td><td>{r.value}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### Form component

```tsx
// components/form/ConfirmAction.tsx

export interface ConfirmActionProps {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ConfirmActionResult {
  confirmed: boolean;
}

export function ConfirmAction({ message, confirmLabel = "Confirm", cancelLabel = "Cancel" }: ConfirmActionProps) {
  // rendered by the web surface; result submitted via the ask() bridge
  return (
    <form>
      <p>{message}</p>
      <button type="submit" name="confirmed" value="true">{confirmLabel}</button>
      <button type="button" name="confirmed" value="false">{cancelLabel}</button>
    </form>
  );
}
```

The agent calls display/ask with a JSX descriptor:

```ts
// display (no user response needed)
display(<DataTable rows={groups} title="Sales by category" />);
await inspect();

// ask (waits for user to submit the form)
const answer = await ask(<ConfirmAction message="Overwrite existing report?" />) as ConfirmActionResult;
await inspect(answer);
```

Component type signatures are extracted into the DTS overlay automatically — the LLM sees the prop types.

---

## 9. Knowledge

Knowledge is structured domain documentation injected into the system prompt when an agent needs it. It follows a three-level hierarchy: **domain → field → option**.

### Directory structure

```
knowledge/
└── strategy/
    ├── config.json           # domain metadata
    └── mode/
        ├── config.json       # field metadata
        ├── broad.md          # option: broad search
        ├── deep.md           # option: deep research
        └── news.md           # option: news search
```

### config.json (domain)

```json
{
  "label": "Strategy",
  "icon": "🎯",
  "color": "#3498db"
}
```

`label`, `icon`, and `color` are UI metadata. Only `label` is used in prompt formatting.

### config.json (field)

```json
{
  "type": "select",
  "variableName": "strategyMode",
  "default": "broad"
}
```

- `type: "select"` means one option is active at a time (the common case).
- `variableName` is the name of the sandbox variable that will hold the selected option's content.
- `default` is the option slug loaded when no explicit selection is made.

### option.md

```markdown
---
title: Broad Search
description: Wide coverage — many sources, diverse perspectives, high recall
---

## When to use

Use **broad** mode when the question is open-ended, you want diverse sources, or you are unsure which providers are best for the topic.

## Configuration

- Providers: Brave, Google CSE, DuckDuckGo (widest coverage)
- `topK`: 8–12 per provider
- `freshness`: "all" unless the topic is time-sensitive
- Avoid narrow semantic search (Exa neural) — too focused for broad discovery

## Tradeoffs

Higher recall means more noise. Budget extra triage time to discard low-quality results.
Expect 20–40% of URLs to be duplicates or low-signal pages.
```

### Declaring knowledge in agent config

There are two ways to declare a field in `config.json`:

**`true` — dynamic field.** The field is enabled; the agent loads specific options at runtime based on context. No content is injected at session start.

```json
{
  "knowledge": {
    "strategy": { "mode": true },
    "provider": { "api": true }
  }
}
```

**Array of slugs — pre-loaded options.** The listed options are injected into the system prompt at session start. The agent has their content from cycle 1 without any explicit call.

```json
{
  "knowledge": {
    "cuisine": { "style": ["italian", "french"] },
    "dietary": { "restriction": ["vegan", "gluten_free"] }
  }
}
```

You can mix both forms across fields of the same agent:

```json
{
  "knowledge": {
    "cuisine":   { "style": ["italian", "french"] },
    "technique": { "method": true },
    "dietary":   { "restriction": true }
  }
}
```

`cuisine/style` is pre-loaded with two specific options; `technique/method` and `dietary/restriction` are enabled but loaded on demand.

### Loading a knowledge option at runtime

When a field is declared `true`, the agent loads the relevant option once the context makes the choice clear:

```ts
Space.current().loadKnowledge("technique", "method", "braising");
await inspect();
// __knowledge.technique.method now contains the braising option body
```

---

## 10. Cross-space delegation

Agents can spawn sub-sessions in other spaces using `Space.load()`:

```ts
const research = Space.load("research");
research.loadAgent("searcher");
await inspect();
// next cycle: research.agents.searcher is available with typed methods
```

The `name` passed to `Space.load()` must match the `"name"` field in the target space's `package.json`.

For the target space to be available, it must be passed on the CLI too:

```bash
llm-repl --space ./spaces/my-space --space ./spaces/research
```

The `delegate()` global provides a lower-level alternative for fully autonomous sub-session execution:

```ts
const result = await delegate({
  space: "/abs/path/to/other-space",
  agent: "searcher",
  flow: "search",
  task: "Search for recent papers on transformer efficiency improvements. Return top 5 URLs.",
}) as { output: string; status: "ok" | "error" };
await inspect(result);
```

---

## 11. Running a space

```bash
# Default: first agent, first flow
llm-repl --space ./spaces/my-space

# Named agent and flow
llm-repl --space ./spaces/my-space --agent analyst --flow data_report

# Multiple spaces (enables Space.load() across spaces)
llm-repl --space ./spaces/my-space --space ./spaces/research

# Limit cycles (overrides flow's maxCycles)
llm-repl --space ./spaces/my-space --cycles 4

# Select model
llm-repl --space ./spaces/my-space --model M
```

The `--agent` value must match a directory name under `agents/`. The `--flow` value must match a directory name under `flows/`.

---

## 12. Agent coding patterns

These patterns belong in `instruct.md` bodies as documented examples. They teach the agent how to use the runtime correctly.

### Tasklist declaration

The `tasklist()` global must be called once with the flow slug and the literal DAG. The harness block in the system prompt provides the DAG literal — the agent fills in `{ /* DAG from harness */ }` with it.

```ts
const __flow = tasklist("my_flow", {
  fetch:     { description: "...", outputSchema: { ... } },
  aggregate: { description: "...", dependsOn: ["fetch"], outputSchema: { ... } },
  submit:    { description: "...", dependsOn: ["aggregate"] },
});
```

After declaration, progress tasks with `start` / `finish`:

```ts
__flow.start("fetch");
const rows = await fetchData("/api/records") as DataRow[];
__flow.finish("fetch", { rows, fetchedAt: new Date().toISOString() });
```

### Fork model-size hints

Embed a model-size hint as the first token of the fork instruction. The router reads it to select the appropriate LLM tier:

| Hint | Model class | When to use |
|------|------------|-------------|
| `[model:XS]` | Classification | Boolean decisions, routing, yes/no judgements |
| `[model:S]` | Fast code gen | Single lookups, short-answer extraction, formatting |
| `[model:M]` | Multi-step code | Moderate reasoning, data transformation, 2–4 step tasks |
| `[model:L]` | Full coverage | Complex reasoning, long sessions, spec coverage |
| `[model:M_R]` | M + reasoning | Error recovery, replanning, uncertainty resolution |
| `[model:L_R]` | L + reasoning | Deep planning, fork orchestration, architectural decisions |

```ts
const summaryFork = fork<string>({
  instruction: "[model:S] Summarise this text in one sentence: " + excerpt,
  tokenBudget: 1000,
});

const analysisFork = fork<AnalysisResult>({
  instruction: "[model:M] Analyse the following dataset and identify the top 3 trends. Return AnalysisResult.",
  tokenBudget: 5000,
});

await inspect(summaryFork, analysisFork);
```

### Parallel forks for parallel tasks

One fork per independent item; collect all with a single `inspect()`:

```ts
const readerForks = topUrls.map((url, i) =>
  fork<string | null>({
    instruction: `[model:S] Extract the main article text from ${url}. Return the text as a string, or null if not an article.`,
    tokenBudget: 4000,
  })
);
await inspect(...readerForks);
// next cycle: readerForks[0], readerForks[1], ... each hold their result
```

### Checkpoint before destructive changes

```ts
checkpoint("before-overwrite");
Space.current().write("reports/latest.json", JSON.stringify(report, null, 2));
await inspect();
```

To undo: `rollback("before-overwrite")`.

### Pin persistent state

`pin()` ensures a variable survives context compaction (when the reconstructed context grows too large):

```ts
const inventory: Record<string, number> = {};
pin("inventory");
await inspect(inventory);
```

On subsequent sessions, `inventory` is restored from the pin before the first cycle.

### Writing artifacts to the space

Agents can save files into the session's space directory:

```ts
// Save structured data
Space.current().write("output/report.json", JSON.stringify(report, null, 2));

// Save markdown
Space.current().write("output/summary.md", markdownText);

await inspect();
```

Files written this way are persisted in `session-{id}/space/` and survive across sessions.

### Error handling in tasks

If a task fails, mark it and yield:

```ts
__flow.start("fetch");
let rows: DataRow[];
try {
  rows = await fetchData("/api/records") as DataRow[];
} catch (e) {
  // Surface the error in the next cycle's context without crashing
  await inspect({ fetchError: String(e) });
  // The agent in cycle 2 will see fetchError and decide whether to retry or abort
}
__flow.finish("fetch", { rows: rows!, fetchedAt: new Date().toISOString() });
```

---

## 13. Minimal-space checklist

### Absolute minimum (one agent, one flow, no functions)

```
my-space/
├── package.json          # name, type: module
├── tsconfig.json
├── index.ts              # export const hostFunctions = {};
├── agents/
│   └── assistant/
│       ├── instruct.md   # title + body
│       └── config.json   # { "knowledge": {}, "functions": [], "components": [] }
└── flows/
    └── assist/
        ├── index.md      # title, defaultAgent, maxCycles, sink, at least one task
        └── 1.Assist.md   # cycle 1 instructions
```

### Full-featured space

```
my-space/
├── package.json
├── tsconfig.json
├── index.ts                          # all host functions bridged
├── README.md
├── agents/
│   ├── primary/
│   │   ├── instruct.md
│   │   └── config.json
│   └── specialist/
│       ├── instruct.md
│       └── config.json
├── flows/
│   └── main_flow/
│       ├── index.md                  # full DAG with 6–10 tasks
│       ├── 1.PlanAndFetch.md
│       ├── 2.ProcessAndAnalyse.md
│       └── 3.ReportAndSubmit.md
├── functions/
│   ├── fetchData.ts
│   └── aggregateRows.ts
├── components/
│   ├── view/
│   │   └── DataTable.tsx
│   └── form/
│       └── ConfirmAction.tsx
└── knowledge/
    └── strategy/
        ├── config.json
        └── mode/
            ├── config.json
            ├── broad.md
            └── deep.md
```

### Pre-flight checklist

Before running a new space for the first time:

- [ ] `package.json` has a unique `"name"` and `"type": "module"`
- [ ] `index.ts` exports `hostFunctions` (can be empty `{}` if no host functions)
- [ ] Every function in `hostFunctions` has a corresponding `.ts` file in `functions/`
- [ ] Every flow slug in agent `actions[].flow` matches a directory under `flows/`
- [ ] Every `flows/<slug>/index.md` has a `sink` block with `name`, `signature`, and `description`
- [ ] Every task listed in `flows/<slug>/index.md` has a `description`; tasks with dependencies list them in `dependsOn`
- [ ] `outputSchema` uses JSON Schema types (`string`, `number`, `boolean`, `object`, `array`) only — no TypeScript types
- [ ] Step files are numbered from `1`; no gaps in the sequence
- [ ] `agents/<slug>/config.json` lists only function names that exist in `hostFunctions`
- [ ] Knowledge `config.json` files exist at both the domain and field level
- [ ] `tsconfig.json` is in place (run `pnpm typecheck` to verify the space typechecks)
