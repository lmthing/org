---
name: create-space
description: This skill should be used when the user asks to "create a space", "add a space", "build a new space", "scaffold a space", "make a space for X", or asks about how to structure agents, flows, functions, knowledge, or components in the LMThing runtime. Also triggers when the user asks to "add an agent", "create a flow", "add a host function", or "set up knowledge" within this project.
version: 0.1.0
---

# Create Space

A space is a self-contained directory that packages agents, flows, functions, UI components, and domain knowledge for one problem area. The `llm-repl` CLI loads it via `--space <path>`.

For the complete spec, see `references/creating_spaces.md`. This SKILL.md contains the essential workflow; consult the reference for field-level details.

## Minimal structure

```
spaces/<name>/
├── package.json
├── tsconfig.json
├── index.ts              # export const hostFunctions = { ... }
├── agents/
│   └── <slug>/
│       ├── instruct.md   # YAML frontmatter (title, actions) + system prompt body
│       └── config.json   # { knowledge, functions, components }
└── flows/
    └── <slug>/
        ├── index.md      # YAML frontmatter (title, defaultAgent, maxCycles, sink, tasks)
        └── 1.<Name>.md   # Cycle 1 instructions with code scaffold
```

Optional additions: `functions/`, `components/view/`, `components/form/`, `knowledge/`.

## Step-by-step creation workflow

### 1. Determine the space name and purpose

Ask or infer from the user:
- Space name (lowercase, hyphenated) — becomes the `"name"` in `package.json` and the directory name under `spaces/`
- What problem the space solves
- What host functions (if any) are needed
- Whether agents need knowledge domains

### 2. Create the directory and boilerplate files

```bash
mkdir -p spaces/<name>/{agents/<agent-slug>,flows/<flow-slug>,functions,components/view,components/form,knowledge}
```

**`package.json`** — set `"name"` to a unique identifier, `"type": "module"`.

**`tsconfig.json`** — use `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`, `jsx: react-jsx`.

**`index.ts`** — export `hostFunctions` mapping function names to their implementations:
```ts
import { myFn } from "./functions/myFn.js";
export const hostFunctions: Record<string, (...args: unknown[]) => unknown> = {
  myFn: (...a) => myFn(a[0] as string, a[1] as never),
};
```
If no host functions: `export const hostFunctions = {};`

### 3. Write the agent

**`agents/<slug>/instruct.md`** frontmatter:
```yaml
---
title: Human-readable name
actions:
  - id: <action-id>
    label: Button label
    description: Tooltip text
    flow: <flow-slug>     # must match a flows/ directory
---
```
Body: role description, capabilities (list host functions by name), fork patterns with model-size hints, rules.

**`agents/<slug>/config.json`**:
```json
{
  "knowledge": { "<domain>": { "<field>": true | ["opt1", "opt2"] } },
  "functions": ["FunctionName"],
  "components": ["ComponentName"]
}
```
Use `true` for fields loaded dynamically at runtime; use an array to pre-load specific options at session start.

### 4. Write the flow

**`flows/<slug>/index.md`** frontmatter:
```yaml
---
title: Flow Title
description: One-sentence description
defaultAgent: <agent-slug>
maxCycles: 6
sink:
  name: submitResult
  signature: "(result: ResultType) => void"
  description: Submit the final result and end the session
tasks:
  <taskId>:
    description: What to accomplish
    outputSchema:
      type: object
      required: [field1]
      properties:
        field1: { type: string }
  <taskId2>:
    description: Second task
    dependsOn: [<taskId>]
---
```
Task IDs must be valid JS identifiers (underscores, not hyphens). `outputSchema` uses JSON Schema types only — no TypeScript types.

**`flows/<slug>/1.<Name>.md`** — cycle instructions:
```markdown
---
step: 1
name: PhaseName
agent: <agent-slug>
tasks: [task1, task2]
---

# Phase 1

Declare the tasklist, then run tasks.

\```ts
const __flow = tasklist("<flow-slug>", { /* DAG from harness */ });

__flow.start("task1");
const result = await myFn(arg) as ResultType;
__flow.finish("task1", { field1: result.value });

await inspect(result);
\```
```

### 5. Write host functions (if needed)

One file per function in `functions/`. Export exactly one named function matching the filename. Include typed interfaces at the top — they appear in the DTS overlay.

```ts
// functions/myFn.ts
export interface MyFnResult { value: string; }
export async function myFn(input: string): Promise<MyFnResult> {
  // implementation
}
```

### 6. Add to pnpm workspace

Add the space to `pnpm-workspace.yaml` if it needs to be a proper workspace package. Most spaces don't need this unless they're consumed by other packages.

### 7. Pre-flight checklist

- [ ] `package.json` has unique `"name"` and `"type": "module"`
- [ ] `index.ts` exports `hostFunctions`
- [ ] Every `actions[].flow` matches a `flows/` directory
- [ ] Every flow `index.md` has a `sink` with `name`, `signature`, `description`
- [ ] Every task has a `description`; dependent tasks list `dependsOn`
- [ ] `outputSchema` uses JSON Schema types only
- [ ] Step files numbered from `1`, no gaps
- [ ] `agents/<slug>/config.json` only lists functions that exist in `hostFunctions`
- [ ] Knowledge `config.json` files exist at domain and field level (if using knowledge)
- [ ] Run `pnpm typecheck` from the space directory

## Running the space

```bash
llm-repl --space ./spaces/<name>
llm-repl --space ./spaces/<name> --agent <agent-slug> --flow <flow-slug>
llm-repl --space ./spaces/<name> --space ./spaces/research   # cross-space delegation
```

## Key agent coding patterns

**Tasklist declaration** — call `tasklist()` once with the flow slug and the literal DAG:
```ts
const __flow = tasklist("my_flow", { fetch: { ... }, aggregate: { dependsOn: ["fetch"], ... } });
__flow.start("fetch");
const rows = await fetchData("/api/records") as Row[];
__flow.finish("fetch", { rows, fetchedAt: new Date().toISOString() });
await inspect(rows);
```

**Fork model-size hints** — embed `[model:XS/S/M/L/M_R/L_R]` as the first token:
```ts
const fork1 = fork<string>({ instruction: "[model:S] Summarise: " + text, tokenBudget: 1000 });
await inspect(fork1);
```

**Sink call** — call the sink global to end the session cleanly:
```ts
submitResult({ title: "...", summary: "..." });
```

## Additional resources

- **`references/creating_spaces.md`** — full spec: all frontmatter fields, knowledge hierarchy, cross-space delegation, complete examples
