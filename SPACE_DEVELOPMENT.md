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
canDelegateTo: [<space-ref>/<agent-slug>, ...]  # delegate access
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
  node packages/cli/dist/cli/bin.js --space ./fixtures/<space-slug> --agent <agent-slug> --repl
  ```

- **Observability Interface (Web UI)**
  Boot a web-based inspector to trace agent thought processes, executions, forks, and variable states:
  ```bash
  node packages/cli/dist/cli/bin.js --space ./fixtures/<space-slug> --web 3000
  ```

- **Mock Mode (Testing without LLM Keys)**
  Use `--mock` to use a hardcoded TypeScript output instead of hitting the live OpenAI / Claude APIs:
  ```bash
  node packages/cli/dist/cli/bin.js --space ./fixtures/<space-slug> --mock ./fixtures/mock.mjs
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
node packages/cli/dist/cli/bin.js --space ./hello-world --agent greeter --repl
```