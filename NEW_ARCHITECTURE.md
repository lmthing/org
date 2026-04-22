# LLM-REPL (concise spec v4)

## Concept

An LLM writes TypeScript into a persistent QuickJS sandbox. Global functions are syscalls that yield to an orchestrator, which reconstructs context and resumes generation. Code is type-checked by tsc's language service before execution. Every executed statement is committed to a git worktree — giving the session a full, replayable history.

- **Sandbox** = QuickJS isolate (persistent heap across the session, hermetically isolated from Node.js)
- **Context window** = stack
- **`.d.ts`** = the instruction surface (no prompt engineering)
- **Snapshot stack** = in-memory per-statement checkpoints of virtual file + serialized scope, enabling O(1) rollback and fork

System prompt: _"Write TypeScript into a live REPL. Call inspect() to examine state. Types define the API. Write code, not commentary."_

---

## API (`llm-repl.d.ts`)

```typescript
// ─── Yield ──────────────────────────────────────────

interface InspectQuery {
  path?: string; // "users[0].address.city"
  slice?: [number, number?]; // [0, 10] or [-5]
  depth?: number; // object nesting, default 2
  filter?: string; // "el.age > 30"
  sample?: number; // N evenly-sampled items
  keys?: boolean; // structure only
  count?: boolean; // length/size only
  search?: string; // regex on strings
}

/**
 * Pauses generation. Always returns __scope (all variables, truncated)
 * + completed forks + tasklist + budget. Pass variables to expand them.
 *
 *   inspect()                              → scope only
 *   inspect(users, config)                 → scope + both expanded
 *   inspect([users, { slice: [0, 5] }])    → scope + queried view
 *
 * Argument names are recovered via source AST. Expressions are
 * labeled with their source (e.g. "users.slice(0, 10)").
 */
declare function inspect(...args: (unknown | [unknown, InspectQuery])[]): never;

// ─── User Interaction ───────────────────────────────

/**
 * Renders JSX to the user and pauses generation until they respond.
 * The component receives an injected `submit(value)` prop to resolve.
 * Returns a serializable value derived from user interaction.
 *
 *   const name = await ask<string>(<TextInput label="Your name?" />);
 *   const pick = await ask<"a"|"b">(<Select options={["a","b"]} />);
 *   const form = await ask<{name:string, age:number}>(<MyForm />);
 *
 * Yield point — behaves like inspect(). Context is reconstructed
 * with the user's response injected as __askResult.
 */
declare function ask<T = string>(
  ui: JSX.Element,
  opts?: {
    timeout?: number; // ms, default none
    fallback?: T; // return instead of throwing on timeout
  },
): Promise<T>;

/**
 * Renders JSX to the user. Does NOT pause generation.
 * Fire-and-forget — use for progress, status, rich output.
 *
 *   display(<ProgressBar value={0.6} />);
 *   display(<Table data={users.slice(0, 10)} />);
 *   display(<Chart data={timeSeries} />);
 *
 * When `id` is set, subsequent calls with the same id update in place.
 */
declare function display(
  ui: JSX.Element,
  opts?: {
    id?: string; // stable id → update in place
    mode?: "replace" | "append"; // default "replace" when id is set
  },
): void;

// ─── Built-in UI Components ─────────────────────────
// Work in both Ink (terminal) and browser React runtimes.

declare const TextInput: FC<{ label?: string; placeholder?: string }>;
declare const Select: FC<{ options: string[]; label?: string; multi?: boolean }>;
declare const Confirm: FC<{ message: string }>;
declare const Table: FC<{ data: Record<string, unknown>[] }>;
declare const ProgressBar: FC<{ value: number; label?: string }>;
declare const Markdown: FC<{ children: string }>;
declare const CodeBlock: FC<{ language?: string; children: string }>;

// Custom components receive `submit` injected by the harness:
interface AskProps<T> {
  submit: (value: T) => void;
}

// ─── Reasoning / Budget ─────────────────────────────

declare function think(reasoning: string): void; // no-op, traced
declare function budget(): Budget; // sync, no yield

// ─── Parallelism ────────────────────────────────────

declare function fork<T>(opts: {
  instruction: string;
  inject?: string[];
  tokenBudget?: number;
}): Promise<ForkResult<T>>;

// ─── Tasks ──────────────────────────────────────────

interface Task {
  id: string; // unique, stable across updates
  description: string;
  status: "pending" | "running" | "done" | "failed" | "blocked";
  dependsOn?: string[]; // task ids — all must be "done" before this starts
  inject?: string[]; // variable names from parent scope to copy in
  tokenBudget?: number; // per-task budget, default from global
}

/**
 * Declares or replaces the full task graph.
 * Each task runs as an independent completion with its own scope and context.
 * The orchestrator schedules tasks whose dependencies are satisfied in parallel.
 *
 *   tasklist("pipeline-1", [
 *     { id: "fetch",     description: "Fetch raw data",    status: "pending" },
 *     { id: "validate",  description: "Validate schema",   status: "pending", dependsOn: ["fetch"],    inject: ["rawData"] },
 *     { id: "transform", description: "Transform records", status: "pending", dependsOn: ["fetch"],    inject: ["rawData"] },
 *     { id: "load",      description: "Write to DB",       status: "pending", dependsOn: ["validate", "transform"], inject: ["validData", "transformed"] },
 *   ]);
 *
 * Calling tasklist() again with the same id updates the graph.
 * Calling with a new id creates a separate pipeline.
 */
declare function tasklist(id: string, tasks: Task[]): void;

// ─── Memory Management ──────────────────────────────

declare function pin(name: string, opts?: { maxTokens?: number }): void;
declare function unpin(name: string): void;
declare function decay(name: string, strategy: "schema" | "summary" | "sample" | "hash"): void;

// ─── Error Recovery ─────────────────────────────────

declare function rollback(n: number): number; // rewind statements + scope
```

---

## Pipeline

```
LLM tokens → boundary detector → tsc diagnostics → sandbox execution
                                                       ↓
                                  yield call OR async error
                                                       ↓
                                   context reconstruction → resume
```

**Statement boundary**: brace/paren/bracket depth tracking + string/comment state. Yield calls (`inspect`, awaited `ask`, awaited `fork`) trigger interception.

**Type errors**: not executed, not appended to virtual file. Error injected as a comment, retry budget = 3, then auto-rollback + nudge.

**Async errors**: while the sandbox runs awaited operations in the background, the orchestrator watches for rejections. If one occurs, the error is injected mid-stream as a comment. Successes are silent until the next `inspect()`.

```
// ASYNC ERROR:
// `const data = await fetchData(endpoint)`
// Error: Connection refused
// Handle the error or rollback(1) and retry.
```

**Rollback**: only operation that truncates the virtual file. Side effects can't be undone.

---

## Sandbox: QuickJS

The sandbox uses **QuickJS** (via `quickjs-emscripten`) instead of Node.js `vm.Context`. QuickJS is a separate JS engine compiled to WASM — it shares no heap with the host Node.js process and has no access to Node APIs unless explicitly bridged.

### Why QuickJS over vm.Context

| Property | `vm.Context` (old) | QuickJS (new) |
|---|---|---|
| Isolation | Same V8 process — prototype pollution, shared globals | Separate engine — no shared heap |
| Globals leakage | Must block each dangerous global explicitly | Nothing available unless injected |
| Memory limits | Node.js process limit only | Per-VM memory limit at engine level |
| Determinism | Non-deterministic (GC, JIT, timers shared) | Deterministic under interrupt handler |
| Serialization | Not possible | Heap can be snapshotted via handle marshaling |
| TypeScript | tsc API in host, execute transpiled JS | tsc API in host, execute transpiled JS |

### Lifecycle

```
getQuickJS()                          → QuickJSWASMModule (once at startup)
    ↓
module.newContext({ maxStackSizeMb })  → QuickJSContext   (one per session)
    ↓
context.evalCode(transpiled_js)        → QuickJSHandle    (per statement)
    ↓
handle.dispose() + context.dispose()  (at session end)
```

The `QuickJSWASMModule` is a singleton loaded once. Each session gets its own `QuickJSContext` with a fresh heap.

### Injecting globals

Host-side objects (callbacks, catalog functions, structured data) cross the QuickJS boundary via handle marshaling:

```typescript
// Inject a function global
const stopHandle = context.newFunction('stop', (valueHandle) => {
  const value = context.dump(valueHandle)  // QuickJS → JS
  onStop(value)
  return context.undefined
})
context.setProp(context.global, 'stop', stopHandle)
stopHandle.dispose()

// Inject a data value
const configHandle = context.evalCode(JSON.stringify(config))
context.setProp(context.global, '__config', configHandle.value)
configHandle.dispose()
```

All handles must be disposed. The `Scope` utility from `quickjs-emscripten` tracks handles for bulk disposal.

### Async operations

`QuickJSAsyncContext` is used for sessions that require async globals (`ask`, `fork`, catalog functions):

```typescript
const context = module.newAsyncContext()
await context.evalCodeAsync(transpiled_js)
```

The host event loop drives QuickJS async via `context.executePendingJobs()` called after each statement.

### Memory and CPU limits

```typescript
const runtime = module.newRuntime()
runtime.setMemoryLimit(64 * 1024 * 1024)      // 64 MB per session
runtime.setMaxStackSize(2 * 1024 * 1024)       // 2 MB stack
runtime.setInterruptHandler(() => {
  return Date.now() - startMs > timeoutMs       // true → throw InterruptError
})
```

### TypeScript compilation

TypeScript is compiled to JavaScript in the host (Node.js) using the TypeScript compiler API — identical to the current flow. The resulting `.js` is sent to `context.evalCode()`. QuickJS sees only plain JavaScript.

### Scope extraction

QuickJS doesn't expose a global enumeration API. The sandbox tracks declared names via the same AST-based approach used today (extract declarations before execution), then reads values back via `context.getProp(context.global, name)` and `context.dump(handle)`.

---

## Snapshot Stack

REPL state after each statement has two parts: the **virtual file** (accumulated `session.ts` text) and the **sandbox heap** (live QuickJS variable values). The harness keeps both as an in-memory append-only stack — one entry per successfully executed statement. Rollback and fork are O(1) pointer operations; no subprocesses, no disk I/O in the hot path.

Git is *not* used for per-statement REPL state. It is reserved for **file writes** (the ` ```path ``` ` four-backtick blocks that persist space files and knowledge markdown), where commit history and diffs have real value — see PLAN.md Phase 5.

### Snapshot shape

```typescript
interface Snapshot {
  stmtN: number             // monotonic statement index
  statement: string         // the source statement that produced this state
  codeWindow: string        // accumulated session.ts at this point
  scope: SerializedScope    // JSON-serialized QuickJS heap (declared names → values)
  yieldKind?: 'inspect' | 'ask' | 'fork' | 'task'  // marks yield points
  parent?: number           // for fork snapshots: index in the parent stack
  timestamp: number
}

interface SerializedScope {
  primitives: Record<string, unknown>      // JSON-safe values
  references: Record<string, RefHandle>    // non-serializable values (functions, class instances) kept as QuickJS handles
  types: Record<string, string>            // type descriptors for the scope table
}
```

### Per-statement checkpoint

After a statement executes successfully:

```typescript
snapshots.push({
  stmtN: ++n,
  statement: code,
  codeWindow: codeLines.join('\n'),
  scope: sandbox.dumpScope(),
  timestamp: Date.now(),
})
```

Failed statements (type errors, runtime errors) do not append. The virtual file stays at the last successful state, which is what tsc sees for the next type-check.

### Rollback

```typescript
rollback(2)
  → const target = snapshots[snapshots.length - 1 - 2]
  → sandbox.restoreScope(target.scope)
  → codeLines.length = target.codeWindow lines
  → snapshots.splice(-2)
```

Pure pointer arithmetic plus one scope restore. No subprocess overhead.

### Fork

Each `fork()` creates an independent QuickJS context (heaps cannot be shared) seeded from a snapshot:

```typescript
const parent = snapshots[snapshots.length - 1]
const forkCtx = module.newAsyncContext()
forkCtx.loadScope(parent.scope)          // restore declared vars into the new heap
const forkStack: Snapshot[] = [{ ...parent, parent: parent.stmtN }]
```

Fork result is injected back into the parent's scope as `forkResult_{id}`, and a single synthetic snapshot records the merge point. Fork stacks are discarded after the fork resolves.

### Scope serialization

JSON handles primitives, arrays, plain objects. Non-serializable values (functions, class instances, closures) are kept as live `QuickJSHandle`s in the `references` map — they survive rollback because the QuickJS context is the same; fork restoration requires the caller to declare which references can cross the context boundary (via `inject:` in the fork spec).

### Yield-point snapshots

The stack entries produced at `inspect()`, `ask()`, and task completions are flagged with `yieldKind`. The context reconstruction layer reads these to rebuild the `__scope` / `__askResult` / `__taskResult_*` blocks without rescanning the full stack.

### Optional git export

For post-mortem debugging, the snapshot stack can be flushed to a git worktree on demand:

```typescript
session.exportToGit(path)   // writes session.ts commits statement-by-statement
```

This is an opt-in debugging aid — not a hot-path operation. Production sessions run entirely in memory.

### Session persistence (optional)

Sessions that need to survive process restarts can serialize the snapshot stack to SQLite or a JSON file:

```typescript
session.persist(path)                       // write stack + last scope
const resumed = await Session.resume(path)  // rebuild from disk
```

Resumption rebuilds the QuickJS context from the last snapshot's `scope`. Live references that can't be serialized are lost — the resumed session starts from the serializable subset of the heap.

---

## Context Reconstruction

When `inspect()` or `ask()` is caught, the orchestrator ends the completion and starts a new one with this user message:

### After `inspect()`

```typescript
// ═══ inspect #3 ═══

const __scope = {
  count: 42,
  config: { apiUrl: "https://api...", batchSize: 50 },
  users: /* Array<{id, name, age}> */ { length: 247 },
  rawData: /* {items, metadata} */ { _size: "48.2kb" },
  forkResult_a1b2: { processedCount: 150, errors: 0 },
};

// ── users (slice [0, 3] of 247) ────────────────────
const __users = [
  { id: 1, name: "Alice", age: 32 },
  { id: 2, name: "Bob", age: 28 },
  { id: 3, name: "Carol", age: 45 },
];

// ── forks ──────────────────────────────────────────
const __forks = {
  fork_a1b2: { status: "resolved", result: { processedCount: 150 } },
  fork_c3d4: { status: "pending", instruction: "validate B" },
};

// ── tasks ──────────────────────────────────────────
const __tasks = {
  "pipeline-1": [
    { id: "fetch", status: "done", cycles: 3 },
    { id: "validate", status: "running", cycles: 1, dependsOn: ["fetch"] },
    { id: "transform", status: "running", cycles: 1, dependsOn: ["fetch"] },
    { id: "load", status: "blocked", dependsOn: ["validate", "transform"] },
  ],
};

// ── budget ─────────────────────────────────────────
const __budget = { tokensRemaining: 3200, inspects: 3, forksActive: 1, tasksActive: 2 };

// ── source (last 12 lines) ─────────────────────────
/*
const users = rawData.items.map(transform);
inspect([users, { slice: [0, 3] }]);
*/
```

### After `ask()`

```typescript
// ═══ ask #1 ═══

// ── user response ──────────────────────────────────
const __askResult = { name: "Alice", age: 32 };

// ── scope ──────────────────────────────────────────
const __scope = {
  /* ... same as inspect */
};

// ── tasks, forks, budget, source ... (same sections)
```

### After task completion (parent context)

```typescript
// ═══ task "validate" completed ═══

// ── result ─────────────────────────────────────────
const __taskResult_validate = { valid: true, errors: [] };

// ── tasks ──────────────────────────────────────────
const __tasks = {
  "pipeline-1": [
    { id: "fetch", status: "done" },
    { id: "validate", status: "done", result: { valid: true, errors: [] } },
    { id: "transform", status: "running", cycles: 2 },
    { id: "load", status: "blocked", dependsOn: ["validate", "transform"] },
  ],
};

// ── scope, budget, source ...
```

**Truncation rules** (in `__scope`):

- Primitives: full (strings >100 chars truncated)
- Arrays/Sets/Maps: type comment + length/size
- Objects: type comment with top-level keys
- Functions: signature only
- Pinned: full (capped at maxTokens)
- Decayed: per strategy

**Expanded variables**: assigned to `__`-prefixed consts. Models use real names in code; the prefix is presentation-only.

**Fork results**: injected into the real sandbox scope, appear in `__scope` automatically.

---

## User Interaction

### `ask()` — yield point

`ask()` renders interactive JSX and pauses the LLM until the user responds via `submit()`. The harness:

1. Intercepts the `ask()` call (same as `inspect()`)
2. Renders the JSX component in the active runtime (Ink or browser)
3. Injects `submit` prop into the root component
4. Waits for `submit(value)` or timeout
5. Reconstructs context with `__askResult` containing the returned value

The component contract:

```typescript
// Harness injects submit into the root component
const MyForm = ({ submit }: AskProps<{ name: string; age: number }>) => {
  const [name, setName] = useState("");
  const [age, setAge] = useState(0);
  return (
    <Box flexDirection="column">
      <TextInput label="Name" onChange={setName} />
      <TextInput label="Age" onChange={v => setAge(Number(v))} />
      <Button onPress={() => submit({ name, age })}>Done</Button>
    </Box>
  );
};

const userData = await ask<{ name: string; age: number }>(<MyForm />);
```

### `display()` — non-blocking

`display()` renders JSX without pausing. The harness renders immediately and the LLM continues generating. With a stable `id`, repeated calls update the same UI element:

```typescript
display(<ProgressBar value={0} label="Processing..." />, { id: "progress" });

for (let i = 0; i < items.length; i++) {
  process(items[i]);
  display(<ProgressBar value={i / items.length} />, { id: "progress" });
}

display(<Table data={results} />);   // no id → appended below
```

### Runtime detection

The harness detects terminal vs browser and renders accordingly. Built-in components abstract the difference. Custom JSX should stick to layout primitives (`Box`, `Text`) for portability, or branch explicitly:

```typescript
declare const runtime: "ink" | "browser";
```

---

## Forks

Forked completions get their own minimal context:

```typescript
// ═══ FORK ═══
// {instruction}

const __scope = {
  /* only injected vars */
};
const __budget = { tokensRemaining: 2048 };

// Assign your result to `result` when done.
```

Constraints: no nested forks, no `tasklist()` in forks. Forks can `inspect()`, `think()`, `ask()`, `display()`, `pin/decay`, `rollback`.

---

## Tasks

Tasks are dependency-aware, independently-scoped work units. Unlike forks (which are fire-and-forget parallel calls), tasks form a DAG that the orchestrator manages across inspect cycles.

### Scheduling

The orchestrator maintains a scheduler:

1. When `tasklist()` is called, the DAG is validated (no cycles, all `dependsOn` ids exist)
2. Tasks whose dependencies are all `"done"` are eligible to run
3. Eligible tasks launch as independent completions in parallel
4. Each task completion gets its own scope and context (like a fork, but richer)

### Task context

Each task runs as a separate LLM completion:

```typescript
// ═══ TASK "transform" (pipeline-1) ═══
// Transform records

const __scope = {
  // only variables listed in `inject`
  rawData: /* Array<{id, name, raw}> */ { length: 1200 },
};

const __deps = {
  // results from completed dependencies
  fetch: { recordCount: 1200, source: "api" },
};

const __budget = { tokensRemaining: 4096 };

// Assign your result to `result` when done.
```

### Lifecycle

```
pending → running → done | failed
            ↑         ↓
          blocked ← (dependency failed → cascade)
```

- **pending**: waiting for orchestrator to schedule
- **blocked**: at least one dependency is not yet `"done"`
- **running**: completion in progress
- **done**: `result` assigned, value available to dependents via `__deps`
- **failed**: runtime error or budget exhausted; dependents cascade to `"blocked"` unless they have fallback logic

### Task capabilities

Tasks can use: `inspect()`, `think()`, `ask()`, `display()`, `pin/decay`, `rollback`, `budget()`.

Tasks cannot use: `tasklist()` (no nested DAGs), `fork()` (use task dependencies instead).

### Updating the graph

Calling `tasklist()` again with the same id replaces the full graph. Running/done tasks are preserved if their id and description match; otherwise they are cancelled and restarted. This allows the parent to adapt the plan based on intermediate results:

```typescript
// Initial plan
tasklist("etl", [
  { id: "fetch", description: "Fetch from API", status: "pending" },
  { id: "process", description: "Process records", status: "pending", dependsOn: ["fetch"] },
]);

inspect(); // wait for fetch to complete

// Adapt: split processing based on what we learned
tasklist("etl", [
  { id: "fetch", description: "Fetch from API", status: "done" }, // preserved
  {
    id: "validate",
    description: "Validate schema",
    status: "pending",
    dependsOn: ["fetch"],
    inject: ["rawData"],
  },
  {
    id: "transform",
    description: "Transform records",
    status: "pending",
    dependsOn: ["fetch"],
    inject: ["rawData"],
  },
  {
    id: "load",
    description: "Load into DB",
    status: "pending",
    dependsOn: ["validate", "transform"],
  },
]);
```

---

## Implementation Layers

| Layer | Adds                                                      | Eval focus                                                      |
| ----- | --------------------------------------------------------- | --------------------------------------------------------------- |
| **0** | Bare REPL: sandbox + boundary detector                    | Syntax/runtime error rate                                       |
| **1** | tsc in the loop + error recovery                          | Type error self-correction rate                                 |
| **2** | `inspect()`, `think()`, `budget()`, async error injection | Inspect frequency, query usage, dead-code-after-inspect         |
| **3** | `rollback()`                                              | Self-correction on tricky tasks                                 |
| **4** | `fork()`                                                  | Parallel task speedup                                           |
| **5** | `pin/unpin/decay`                                         | Large-data task completion                                      |
| **6** | `tasklist()`                                              | DAG scheduling, dependency resolution, parallel task throughput |
| **7** | `ask()`, `display()`                                      | User interaction quality, ask frequency, UI appropriateness     |

**Hypothesis**: harness-enforced features (inspect, fork, types) work at smaller model sizes than meta-cognitive features (pin/decay, budget management, task planning). User interaction (ask/display) should work at small sizes for built-in components, larger for custom JSX.

---

## Eval Metrics

Task completion rate · token efficiency · type/runtime error rate · error recovery rate · inspect frequency · **dead code after inspect** · **InspectQuery usage** · fork utilization · context utilization · think ratio · rollback frequency · pin/decay accuracy · task staleness · **DAG parallelism efficiency** · **task dependency accuracy** · **ask frequency** · **ask-to-display ratio** · **UI component appropriateness**.

**Test tiers**: pure code (1) → inspect required (2) → think + queries (3) → fork (4) → pin/decay (5) → tasklist DAG pipelines (6) → interactive user tasks (7).

**Model ladder**: small (1-3B) · medium (7-14B) · large (30-70B) · frontier. Find the capability threshold per feature.

---

## Trace

Every event logged at statement granularity. Never summarized. Full context reconstruction messages preserved for replay. Event types include `unit_queued`, `type_check_pass/fail`, `execute`, `runtime_error`, `async_error_injected`, `inspect`, `fork_spawn/resolve/reject`, `task_schedule/start/complete/fail/cascade`, `ask_render/submit/timeout`, `display_render/update`, `context_reconstruct`, `completion_start/end`.

---

## Testing

The test system is **code-first**: tests are TypeScript files that drive sessions programmatically. Snapshots are JSON files committed to the package (Vitest convention) — a snapshot captures the serialized state of interest (scope, code window, message array, generated LLM output) at a named point.

### Test harness

```typescript
import { defineTest, type TestHarness } from '@lmthing/repl/testing'

defineTest('basic arithmetic', async (h: TestHarness) => {
  const s = await h.session()

  await s.execute(`const x = 1 + 1`)
  s.assertScope({ x: 2 })

  await s.execute(`const y = x * 3`)
  s.assertScope({ y: 6 })

  s.assertStmtCount(2)             // 2 snapshots on the stack
  s.matchSnapshot('after-math')    // compares full state bundle vs __snapshots__/
})
```

### `TestHarness`

```typescript
interface TestHarness {
  /** Create an isolated session with its own QuickJS context and snapshot stack. */
  session(opts?: Partial<SessionConfig>): Promise<TestSession>

  /** Load a pre-built session state from a JSON fixture (replay tests). */
  fixture(name: string): Promise<TestSession>

  /** Real-LLM helper; skipped when API keys are absent. */
  llm(size: 'small' | 'large', systemPrompt: string, userPrompt: string): Promise<string>
}
```

### `TestSession`

```typescript
interface TestSession {
  /** Execute a TypeScript statement. Pushes a snapshot on success. */
  execute(code: string): Promise<ExecuteResult>

  /** Trigger an inspect() yield and return the reconstructed context. */
  inspect(): Promise<InspectSnapshot>

  /** Deep-equal assertion against named scope variables. */
  assertScope(expected: Partial<Record<string, unknown>>): void

  /** Snapshot-stack size assertion. */
  assertStmtCount(n: number): void

  /** Virtual-file content assertion. */
  assertCodeWindow(expected: string | RegExp): void

  /**
   * Compare the full state bundle { scope, codeWindow, messages } against
   * __snapshots__/{testFile}.snap. Writes on first run; fails on mismatch;
   * updates when --update-snapshots is passed. Vitest serializer.
   */
  matchSnapshot(name: string): void

  /** Restore the session to a named snapshot from disk, return a fresh session from there. */
  replayFrom(snapshotName: string): Promise<TestSession>

  /** Rollback K statements in-session (exercises the snapshot stack). */
  rollback(k: number): void

  /** Raw scope dump — useful for ad-hoc assertions. */
  dumpScope(): Record<string, unknown>

  /** Export the snapshot stack to a git worktree for post-mortem inspection (opt-in). */
  exportToGit(path: string): Promise<void>
}
```

### Snapshot semantics

Snapshots are Vitest-style: stored as serialized state bundles in `__snapshots__/*.snap` files next to the test. On first run the file is written; on subsequent runs the current state is compared to the file.

The state bundle is always the same shape, so a single `matchSnapshot(name)` captures everything a reviewer needs:

```typescript
interface SnapshotBundle {
  scope: Record<string, unknown>      // post-execution scope
  codeWindow: string                  // accumulated session.ts
  messages?: Message[]                // session.getMessages() for multi-turn tests
  generatedCode?: string              // for LLM tests, the last generated code block
  stmtCount: number
}
```

Diffs are readable text (the Vitest default serializer). `--update-snapshots` rewrites the `.snap` files.

### LLM integration tests

```typescript
defineTest('[small] stop: called with correct value', async (h) => {
  const s = await h.session({ model: 'small' })
  const code = await h.llm('small', STOP_DOCS, 'Set answer = 42, then call stop(answer).')

  await s.execute(code)
  s.assertScope({ answer: 42 })
  s.matchSnapshot('stop-correct-value')   // captures { generatedCode, scope, codeWindow }
})
```

Each model size produces its own snapshot entry (Vitest uses the test name, so `[small]` / `[large]` prefixes live in separate entries). Tests skip automatically when API keys are absent.

### Space tests

Space tests still run via `lmthing test --space <path>`:

```typescript
// spaces/space-creator/tests/space-creator.test.ts
import { defineTest } from '@lmthing/repl/testing'

defineTest('[small] SpaceArchitect: writes package.json', async (h) => {
  const s = await h.session({ space: 'space-creator', agent: 'SpaceArchitect' })
  await s.sendMessage('Create a space called test-counter')
  s.assertCodeWindow(/package\.json/)
  s.matchSnapshot('space-creator-package-json')
})
```

### Test runner

```bash
pnpm test                                                    # unit, fast, no LLM
pnpm vitest run src/sandbox/globals-llm.test.ts              # LLM integration
lmthing test --space org/libs/thing/spaces/space-creator     # space tests
pnpm vitest run --update-snapshots                           # refresh .snap files
```

### Fixtures

Pre-built session states are stored as JSON under `__fixtures__/`:

```
repl/src/sandbox/__fixtures__/
  arithmetic-baseline.json   ← SnapshotBundle + full stack
  etl-pipeline.json
```

`h.fixture('arithmetic-baseline')` loads the file, rebuilds a QuickJS context seeded from the fixture's final scope, and primes the snapshot stack. Rollback, replay, and context reconstruction can be tested without running LLMs.

### Test isolation

Each `h.session()` call creates a fresh `QuickJSContext` and a fresh in-memory snapshot stack. No shared state between tests. Vitest workers run in parallel; since everything is in-memory the only shared resource is the `QuickJSWASMModule` singleton, which is read-only after initialization.

### Debugging failed tests

Failing tests can export their final state for inspection:

```typescript
defineTest('etl pipeline', async (h) => {
  const s = await h.session()
  try {
    // ...
  } catch (e) {
    await s.exportToGit('./debug/etl-failure')   // writes a browsable git history
    throw e
  }
})
```

This is the bridge between the fast in-memory default and the richer debugging affordance git provides — opt in only when a test actually fails.

---

## Open Questions

1. Statement boundary granularity for semicolon-less code
2. Model-size-adaptive scope truncation depth
3. Decay summary generator (same LLM / smaller LLM / template)
4. Allow nested forks (depth 2) for frontier models?
5. Inspect frequency: prompt-guided vs self-discovered
6. Type strictness: adaptive to model size?
7. Sandbox escape: hermetic vs permission system
8. `InspectQuery.filter` safety (it's eval) — keep or remove?
9. Async error injection timing: immediate vs at statement boundary
10. JSX complexity budget: should the harness limit component depth/size?
11. ask() in tasks: should task-scoped ask() route to the parent session's user, or queue?
12. Task cancellation: cooperative (task checks a signal) vs preemptive (kill completion)?
13. Cross-pipeline dependencies: allow `dependsOn: ["other-pipeline:task-id"]`?
14. Task result size limits: truncate large results before injecting into `__deps`?
15. QuickJS async: `QuickJSAsyncContext` runs in a separate WASM module (larger binary) — should the sync context be used for pure-code sessions and async context only when needed?
16. Snapshot stack memory cost: a 500-statement session with rich scope may hold many MB of snapshots — cap stack depth, compress older entries, or evict on pressure?
17. Non-serializable scope values (functions, class instances, closures) survive rollback via live QuickJS handles, but can't cross fork contexts or be persisted — is a `@serializable` marker / schema hint needed, or is "best-effort JSON" good enough?
18. Session persistence format: SQLite vs single JSON file — does anyone need to *query* snapshot history, or is flat-file enough?

---

## Glossary

**Sandbox**: persistent QuickJS isolate — a separate JS engine (WASM) with no shared heap with the host Node.js process. **Virtual file**: append-only `session.ts` for tsc type-checking. **Yield point**: global call that pauses generation (`inspect`, `ask`). **Inspect cycle**: generate → execute → inspect → reconstruct → resume. **`__scope`**: debugger-style scope object in every reconstruction. **Async error injection**: runtime errors surfaced mid-stream as comments. **Task DAG**: directed acyclic graph of tasks with dependency edges; the orchestrator parallelizes independent paths. **Ask cycle**: generate → render UI → wait for user → reconstruct with response → resume. **Snapshot stack**: in-memory append-only list of per-statement checkpoints (virtual file + serialized scope); provides O(1) rollback and the substrate for fork. **Serialized scope**: JSON-safe dump of declared variables plus a reference map for non-serializable values (kept as live QuickJS handles). **Snapshot (test)**: a serialized `SnapshotBundle` written to `__snapshots__/*.snap` (Vitest convention); test re-runs diff the current state against the file. **Fixture**: a JSON file in `__fixtures__/` that seeds a `TestSession` with a pre-built snapshot stack for deterministic replay tests. **Export to git**: opt-in debug affordance that flushes the snapshot stack to a browsable git worktree — used on test failure or demand, never on the hot path.
