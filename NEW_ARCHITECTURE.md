# LLM-REPL (concise spec v4)

## Concept

An LLM writes TypeScript into a persistent QuickJS sandbox. Global functions are syscalls that yield to an orchestrator, which reconstructs context and resumes generation. Code is type-checked by tsc's language service before execution. Every executed statement is committed to a git worktree — giving the session a full, replayable history.

- **Sandbox** = QuickJS isolate (persistent heap across the session, hermetically isolated from Node.js)
- **Context window** = stack
- **`.d.ts`** = the instruction surface (no prompt engineering)
- **Worktree** = append-only git history of `session.ts`, one commit per executed statement

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

## Git Worktree Checkpointing

Every statement executed in the sandbox is committed to a dedicated git worktree. This gives each session a full, replayable, diff-inspectable history.

### Session worktree

At session start, a temporary git repo is initialized:

```
{tmpDir}/sessions/{sessionId}/
  .git/
  session.ts        ← append-only; every committed statement
```

The `session.ts` file is the virtual file used for tsc type-checking. After each statement executes successfully, the harness:

1. Appends the statement to `session.ts`
2. Runs `git add session.ts`
3. Commits: `git commit -m "stmt {n}: {first_60_chars}"`

Failed statements (type errors, runtime errors) are **not committed** — the virtual file stays at the last successful state.

### Commit anatomy

| Commit message | Trigger |
|---|---|
| `init: session {id}` | Session start (empty `session.ts`) |
| `stmt {n}: {summary}` | Successful statement execution |
| `inspect {n}` | `inspect()` yield — tagged `inspect-{n}` |
| `ask {n}` | `ask()` yield — tagged `ask-{n}` |
| `rollback {n}` | `rollback(k)` call — resets to `HEAD~k` |

### Tags

```
inspect-1, inspect-2, ...   ← yield points (context reconstruction boundaries)
ask-1, ask-2, ...           ← ask() yield points
fork-{id}                   ← branch tip for each fork() call
snapshot-{name}             ← test harness snapshots (see Testing)
```

### Rollback

`rollback(k)` resets the worktree and the QuickJS scope together:

```
rollback(2)
  → git reset --hard HEAD~2    (truncate virtual file)
  → restore QuickJS scope from checkpoint stored at HEAD~2
```

Scope checkpoints are stored as JSON alongside each commit (not in the worktree — in an out-of-tree map keyed by commit SHA):

```typescript
// After each stmt commit
const sha = execSync('git rev-parse HEAD')
scopeCheckpoints.set(sha, sandbox.dumpScope())

// On rollback(k)
const targetSha = execSync(`git rev-parse HEAD~${k}`)
sandbox.restoreScope(scopeCheckpoints.get(targetSha))
```

### Fork branches

Each `fork()` call creates a branch in the same worktree:

```
main: stmt 1 → stmt 2 → inspect-1
                              ↓ fork-a1b2 branch
                          fork stmt 1 → fork stmt 2
```

Fork branches are merged back (squash) into main as a single `fork-result` commit when the fork resolves.

### Session cleanup

Worktrees are ephemeral by default — deleted when the session ends. To persist for debugging or test replay:

```typescript
runAgent({ keepWorktree: true })  // worktree survives; path logged at exit
```

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

The test system is **code-first**: tests are TypeScript files that drive sessions programmatically. Snapshots are git states, not serialized text files — comparing a snapshot means diffing `session.ts` against a tagged commit in the worktree.

### Test harness

```typescript
import { defineTest, type TestHarness } from '@lmthing/repl/testing'

defineTest('basic arithmetic', async (h: TestHarness) => {
  const s = await h.session()

  await s.execute(`const x = 1 + 1`)
  s.assertScope({ x: 2 })

  await s.execute(`const y = x * 3`)
  s.assertScope({ y: 6 })

  s.assertCommits(2)          // 2 stmt commits in worktree
  s.snapshot('after-math')    // git tag snapshot-after-math at HEAD
})
```

### `TestHarness`

```typescript
interface TestHarness {
  /** Create an isolated session with its own QuickJS context + git worktree. */
  session(opts?: Partial<SessionConfig>): Promise<TestSession>
}
```

### `TestSession`

```typescript
interface TestSession {
  /** Execute a TypeScript statement. Commits to worktree on success. */
  execute(code: string): Promise<ExecuteResult>

  /** Trigger an inspect() yield and return the reconstructed context. */
  inspect(): Promise<InspectSnapshot>

  /** Assert that named scope variables match expected values (deep equal). */
  assertScope(expected: Partial<Record<string, unknown>>): void

  /** Assert the number of stmt commits in the worktree. */
  assertCommits(n: number): void

  /** Assert that git log matches a predicate. */
  assertGitLog(predicate: (commits: GitCommit[]) => boolean): void

  /** Assert that session.ts content matches a string or regex. */
  assertSessionFile(expected: string | RegExp): void

  /**
   * Tag HEAD as `snapshot-{name}`. On re-run, compare current session.ts
   * against the tagged state. Fails if diff is non-empty (unless --update-snapshots).
   */
  snapshot(name: string): void

  /** Restore the worktree to a named snapshot and return a new session continuing from there. */
  replayFrom(snapshotName: string): Promise<TestSession>

  /** Get the path to this session's git worktree. */
  getWorktreePath(): string

  /** Get raw QuickJS scope dump. */
  dumpScope(): Record<string, unknown>
}
```

### Snapshot semantics

A snapshot is a git tag in the session worktree:

```
snapshot-{name} → commit SHA → session.ts content at that point
```

On first run, `snapshot(name)` tags HEAD. On subsequent runs, it diffs `session.ts` at HEAD against `session.ts` at the snapshot tag:

```bash
git diff snapshot-{name} HEAD -- session.ts
```

If the diff is non-empty, the test fails and prints the diff. Pass `--update-snapshots` to move the tag to the current HEAD.

This means snapshots track **the exact code the session accumulated**, not serialized scope values — it's the same code-first approach used throughout the system.

### LLM integration tests

Tests that call real LLMs inject the model output into `session.execute()`:

```typescript
defineTest('[small] stop: called with correct value', async (h) => {
  const s = await h.session({ model: 'small' })
  const code = await h.llm('small', STOP_DOCS, 'Set answer = 42, then call stop(answer).')

  s.snapshot('generated-code')          // snapshot the generated code before execution
  await s.execute(code)
  s.assertScope({ answer: 42 })
  s.snapshot('scope-after')             // snapshot scope state after execution
})
```

`h.llm(size, systemPrompt, userPrompt)` calls the real LLM and returns the generated code string. Tests are skipped when API keys are absent.

### Space tests

Space tests still use `lmthing test --space <path>`, but the test files inside now use `TestHarness` for session-level assertions:

```typescript
// spaces/space-creator/tests/space-creator.test.ts
import { defineTest } from '@lmthing/repl/testing'

defineTest('[small] SpaceArchitect: writes package.json', async (h) => {
  const s = await h.session({ space: 'space-creator', agent: 'SpaceArchitect' })
  await s.sendMessage('Create a space called test-counter')
  s.assertSessionFile(/package\.json/)
  s.snapshot('space-creator-package-json')
})
```

### Test runner

```bash
# Unit tests (fast, no LLM)
pnpm test

# LLM integration tests
pnpm vitest run src/sandbox/globals-llm.test.ts

# Space tests
lmthing test --space org/libs/thing/spaces/space-creator

# Update all snapshots
pnpm vitest run --update-snapshots
```

`--update-snapshots` moves every `snapshot-{name}` git tag to the current HEAD in each session worktree. Snapshot tags are committed to the test fixture repo under `tests/__snapshots__/` (a bare git repo checked into the package).

### Test isolation guarantees

Each `h.session()` call:
1. Creates a fresh `QuickJSContext` — no shared heap with other tests
2. Initializes a new git worktree in a temp directory
3. Cleans up both when the test completes (unless `--keep-worktrees` is passed)

Tests run in parallel by default (Vitest workers). Worktrees are in separate temp dirs so there is no cross-test git state.

### Fixture worktrees

For tests that need a pre-built session state, fixture worktrees are stored as bare git repos in the package:

```
repl/src/sandbox/__fixtures__/
  arithmetic-baseline.git/   ← bare git repo; replayFrom() clones this
  etl-pipeline.git/
```

`h.fixture('arithmetic-baseline')` clones the fixture repo into a fresh temp worktree and returns a `TestSession` positioned at its HEAD. This allows testing rollback, replay, and context reconstruction without running LLMs.

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
16. Worktree persistence policy: keep on crash/timeout for post-mortem debugging? Auto-expire after N days?
17. Scope checkpoint serialization: JSON.stringify loses non-serializable values (functions, class instances) — use a custom serializer or store handles directly in QuickJS?

---

## Glossary

**Sandbox**: persistent QuickJS isolate — a separate JS engine (WASM) with no shared heap with the host Node.js process. **Virtual file**: append-only `session.ts` for tsc type-checking. **Yield point**: global call that pauses generation (`inspect`, `ask`). **Inspect cycle**: generate → execute → inspect → reconstruct → resume. **`__scope`**: debugger-style scope object in every reconstruction. **Async error injection**: runtime errors surfaced mid-stream as comments. **Task DAG**: directed acyclic graph of tasks with dependency edges; the orchestrator parallelizes independent paths. **Ask cycle**: generate → render UI → wait for user → reconstruct with response → resume. **Worktree**: temporary git repository initialized per session; accumulates one commit per executed statement. **Scope checkpoint**: JSON snapshot of the QuickJS scope saved alongside each worktree commit, enabling `rollback()` to restore both the virtual file and the heap state. **Snapshot (test)**: a git tag in a session worktree marking a known-good state; test assertions diff `session.ts` against the tagged commit. **Fixture worktree**: a bare git repo checked into the test package that seeds a pre-built session state for deterministic replay tests.
