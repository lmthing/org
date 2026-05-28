# Architecture: Fork + Tasklist Orchestration

## Files

- `packages/core/src/fork/fork.ts` — `ForkEngine`, isolated child session execution
- `packages/core/src/tasklist/dag.ts` — DAG loading and validation
- `packages/core/src/tasklist/orchestrator.ts` — parallel fork scheduling
- `packages/core/src/tasklist/condition-dsl.ts` — condition expression evaluator
- `packages/core/src/tasklist/schema.ts` — output shape validator

## Fork Protocol

`fork(opts)` is a value-yielding global. The host creates a **fresh VM** for the child:

```typescript
interface ForkGlobalOpts {
  instruction: string;
  output?: Record<string, string>;  // { field: type } schema
  seed?: Record<string, unknown>;   // JSON-serializable scope vars to pass in
  timeout?: number;                 // ms, default varies
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
