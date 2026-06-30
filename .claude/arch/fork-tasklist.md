# Architecture: Fork + Tasklist Orchestration

## Files

- `libs/core/src/fork/fork.ts` — `ForkEngine`, isolated child session execution
- `libs/core/src/tasklist/dag.ts` — DAG loading and validation
- `libs/core/src/tasklist/orchestrator.ts` — parallel fork scheduling
- `libs/core/src/tasklist/condition-dsl.ts` — condition expression evaluator
- `libs/core/src/tasklist/schema.ts` — output shape validator

## Fork Protocol

`fork(opts)` is a value-yielding global. The host creates a **fresh VM** for the child:

```typescript
interface ForkGlobalOpts {
  instruction: string;
  output: Record<string, string>;          // required: { field: type } schema
  seed?: Record<string, unknown>;          // JSON-serializable scope vars to pass in
  timeout?: number;                        // ms
  taskId?: string;                         // set by orchestrator for trace labelling
  upstreamOutputs?: Record<string, unknown>; // set by orchestrator; passed as seed context
}
```

The child session runs with:
- Its own QuickJS VM (no shared state with parent)
- Parent history up to the fork point + a synthetic task message (instruction + output schema + upstream inputs)
- A `currentTask` global injected with `resolve(value)` and `reject(err)` methods
- `currentTask.resolve(value)` validates `value` against `output` schema, ends the child stream, settles the fork promise

Only JSON-serializable values cross the boundary. Functions and class instances cannot be passed. The parent receives the goal output as VARIABLES.

`ForkEngine` enforces `maxConcurrentForks` (default 4). Timeout → reject.

## Tasklist Orchestration

`tasklist(name)` is a value-yielding global that runs a full DAG:

```
1. Load DAG from space.tasklists[name]
2. Find ready tasks: deps all done AND condition passes (or no condition)
3. Spawn each ready task as a fork (parallel, within concurrency cap)
4. For dependent tasks: pass upstream outputs as seed vars AND "Inputs:" summary in instruction
5. On fork resolve: mark task done, store output, find newly-ready tasks
6. On optional task failure: mark skipped, continue
7. On required task failure: abort tasklist, reject
8. When goal task resolves: settle tasklist() promise with goal output → VARIABLES in parent
```

The model never writes fork/tasklist orchestration code. The model only sees individual fork task turns (its own separate VM) and, in the parent, the final VARIABLES block.

## DAG Validation

`dag.ts` builds `{ [id]: TaskNode }` from sorted `.md` files:

```typescript
interface TaskNode {
  id: string;
  instruction: string;         // from .md body
  output?: Record<string, string>;  // from frontmatter
  dependsOn?: string[];
  condition?: string;          // condition-DSL expression
  optional?: boolean;
  goal?: boolean;              // exactly one must be true
}
```

Validation:
- Exactly one `goal: true` task required
- No cycles in `dependsOn` graph
- All `dependsOn` IDs resolve to sibling tasks

## Condition DSL

Evaluated against `{ [taskId]: output }` accumulated results.

Grammar:
```
expr     := clause (('AND'|'OR') clause)*
clause   := dotted.path op literal
op       := '==' | '!=' | '>' | '<' | '>=' | '<='
literal  := string | number | boolean | null
path     := identifier ('.' identifier | '[' number ']')*
```

Examples:
- `boil_water.water_ready == true`
- `sauce.spice_level > 2 AND sauce.done == true`
- `garnish.optional == true OR combine.score >= 8`

No `eval()` — it's a hand-written recursive descent parser + evaluator.

## Output Schema Validation

`schema.ts` validates `currentTask.resolve(value)` against the task's `output` spec:

```yaml
output:
  water_ready: boolean
  temperature: number
```

Supported types: `string`, `number`, `boolean`, `object`, `array`. Type mismatch → reject with descriptive error so the LLM sees the validation failure and can retry.

## Invariants / gotchas

- **Fork VMs have `loadKnowledge`** injected alongside `inspect`, `sleep`, and `display` (plus `registerSpace` for write-capable roles). Tasks inside a tasklist fork can call `await loadKnowledge(...)`. The fork's `processYield` explicitly handles `loadKnowledge` by calling `loadKnowledgeFile` directly — without this, `undefined` would win the race against the async file read and bind `k = undefined` in the VM.
- **Fork VMs do NOT get `ask`** — a fork runs headless/autonomous (no interactive user). `ask` is neither injected nor declared in the fork DTS (`LIBRARY_DTS_NO_ASK`), so a stray `await ask(...)` fails typecheck immediately instead of blocking on stdin / binding `undefined`. The fork prompt tells the model to work from its seed/inputs and narrate via `// comments`.
- **Forks are guaranteed to return a usable value (anti-"model stupidity").** If the model finishes a fork without calling `currentTask.resolve()`, `fork.ts` runs up to 2 *forced* resolve-only turns (tools forbidden, a FRESH `maxEpisodes:4` budget so a prior breach can't block them); if it still won't resolve, `salvageOutput(schema)` returns a schema-valid placeholder (`[]`/`0`/`false`/`{}`/a `(unavailable…)` string) so the parent/tasklist proceeds instead of hard-failing. **Hard limits stay hard:** a `BudgetExceededError` propagates (the budget is a cost ceiling), and a fork given an explicit `timeout` rejects on non-completion (no salvage). Orchestrator/delegate forks set no timeout, so they always salvage.
- **The fork system prompt advertises the host primitives** `execShell`, `fetch`, `readFileRaw`, `writeFileRaw`, `loadKnowledge` (not just sleep/display/inspect) and states there is no Node/Bun/Deno runtime — without this, coding forks burned every retry trying `child_process`/`Bun`/`Deno`. Complementary safety net: `sandboxApiHint()` (`eval/error-rewind.ts`) detects a failure that reached for an unavailable API and injects a one-line redirect (e.g. → `execShell(cmd)`) into the error block.
- **`registerSpace(dir)` inside a (write-capable) fork is visible to the parent.** `registerSpace` is a value-yielding global that loads a space into a `dynamicSpaces` map on `Session`; the `Session` shares this same `Map` reference with its `ForkEngine`, so a `registerSpace()` call inside a fork is visible to subsequent parent `delegate()` calls. Re-registering the same dir overwrites the prior entry (idempotent re-scaffolding). Read-only fork roles (`explore`/`plan`) do **not** get `registerSpace` injected — it mutates shared session state, so it is withheld like the other write capabilities.
- **JSX runtime is mirrored into fork/delegate VMs** (`fork.ts` mirrors `session.injectJSXRuntime`), so a fork emitting JSX doesn't throw "React is not defined".
