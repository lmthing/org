# LLM-REPL (spec v4.3)

## Concept

An LLM writes TypeScript into a persistent QuickJS sandbox. Global functions are syscalls that yield to an orchestrator, which reconstructs context and resumes generation. Code is type-checked by tsc before execution. History is stored in git (committed at yield points) and trace.jsonl (per-statement).

- **Sandbox** = QuickJS isolate (separate engine, no host heap access) · **Context window** = stack · **`.d.ts`** = instruction surface · **Git** = yield-point history · **Trace** = statement-level log · **Render surface** = JSX shown to user via `display()`/`ask()`

System prompt: _"Write TypeScript into a live REPL. Semicolons required. Use `await` for async operations — always annotate the awaited type: `const x = await expr as MyType`. Downstream statements are type-checked speculatively using your annotation and execute when the Promise resolves. End each completion with inspect() to commit state and get a fresh context. Use display() to show progress, ask() to get user input. Use tasklist() to track structured work. Types define the API. Comments are traced as reasoning. Use checkpoint() before risky operations. Function and class declarations are automatically captured into the session space and available immediately as globals; React components with a submit prop become form components, others become view components. They appear as TypeScript interfaces in the system prompt after the next inspect(). Re-declaring an existing function is a contract error — read it first with Space.current().read(), then update with .patch() or .write()."_

---

## Architecture

```mermaid
graph TB
    User(["User"])

    subgraph Boot["① Session Boot"]
        SpaceFiles[("Space file tree<br/>agents · flows · functions<br/>components · knowledge")]
        Loader["Space Loader<br/>pure function"]
        SpaceFiles --> Loader
        Loader --> SessionCfg["SessionConfig + overlay<br/>system prompt · generated .d.ts<br/>preloaded scope · hostFns · components"]
    end

    subgraph Loop["② Execution Loop"]
        direction TB
        LLM["LLM<br/>token stream"]
        Parser["Boundary Detector<br/>TypeScript scanner<br/>comments → reasoning trace"]
        TSC["tsc strict<br/>type check + inference<br/>3 retries on error"]
        QJS["QuickJS Context<br/>per-statement eval<br/>interrupt timeout · heap cap"]

        LLM -->|tokens| Parser
        Parser -->|statement| TSC
        TSC -->|transpiled JS| QJS
        TSC -.->|type errors as comments| LLM
        QJS -.->|runtime errors · inferred types| LLM
    end

    subgraph Yield["③ Yield via inspect"]
        direction TB
        Settle["Await passed Promises only<br/>fetch · fs · ask · fork<br/>timeout: soft cap (per-promise logical timeout governs)"]
        Commit["Git commit<br/>+ scope snapshot"]
        Reconstruct["Context Reconstruction<br/>__scope · __errors · __tasks<br/>__currentStep · __display · __git"]
        Settle --> Commit --> Reconstruct
    end

    QJS -->|inspect call| Yield
    Reconstruct -->|new completion| LLM

    subgraph Host["④ Host Bridges — globals across WASM ↔ Node"]
        direction LR
        Display["display JSX<br/>non-blocking"]
        Ask["ask JSX → Promise&lt;T&gt;<br/>submit resolves"]
        Fetch["fetch url<br/>allowlist"]
        FS["fs methods<br/>/session/id/files/"]
        Fork["fork opts<br/>new QuickJS on branch"]
        Tasks["tasks / actions<br/>flow task graphs"]
    end

    QJS <-->|injected handles| Host

    subgraph Render["⑤ Render Surface"]
        Ink["Ink — terminal"]
        React["React — browser"]
        Components["Built-in + space components<br/>TextInput · Table · ProgressBar · …"]
        Ink --- Components
        React --- Components
    end

    Display -->|descriptor tree| Render
    Ask -->|descriptor + submit handle| Render
    Render -->|user submit| Ask
    Render <-->|view / input| User

    subgraph IO["External"]
        Net[("Network<br/>allowlisted domains")]
        Disk[("Sandboxed FS<br/>/session/id/files/")]
    end
    Fetch <--> Net
    FS <--> Disk

    subgraph State["⑥ Persistent State — per session"]
        direction LR
        SessionTs[("session.ts<br/>virtual source")]
        ScopeJson[("scope.json<br/>derived lossy view")]
        HeapBin[("heap.bin<br/>scope snapshot")]
        Meta[("meta.json<br/>budget · tasks · errors")]
        TraceLog[("trace.jsonl<br/>per-statement events")]
        Git[("git tags<br/>inspect-N · cp-label<br/>fork-id")]
    end

    Commit --> SessionTs
    Commit --> ScopeJson
    Commit --> HeapBin
    Commit --> Meta
    Commit --> Git
    QJS -.->|every statement| TraceLog

    subgraph Forking["⑦ Fork — parallel completion"]
        ForkBranch["fork/id git branch"]
        ChildQJS["Fresh QuickJS<br/>scope re-seeded<br/>plus instruction"]
        ForkBranch --> ChildQJS
        ChildQJS -->|resolve(result)| ForkResolve["Promise resolves on parent<br/>awaited if passed to inspect()"]
    end

    Fork --> Forking
    ForkResolve -.-> QJS

    SessionCfg -->|system prompt| LLM
    SessionCfg -->|.d.ts overlay| TSC
    SessionCfg -->|host fns + preloaded scope| QJS
    SessionCfg -->|component registry| Render

    classDef sandbox fill:#fef3c7,stroke:#f59e0b
    classDef llm fill:#dbeafe,stroke:#3b82f6
    classDef state fill:#f3e8ff,stroke:#a855f7
    classDef io fill:#fee2e2,stroke:#ef4444

    class QJS,ChildQJS sandbox
    class LLM llm
    class SessionTs,ScopeJson,HeapBin,Meta,TraceLog,Git state
    class Net,Disk,User io
```

**Reading the diagram:**

1. **Session Boot** — A space (file tree of agents, tasklists, functions, components, knowledge) is compiled by the pure `loadSpace()` function into a `SessionConfig` overlay: the system prompt comes from the agent's `instruct.md` plus a manifest of all visible spaces, an extra `.d.ts` is generated from `functions/`/`components/`/`actions`, scope is preloaded with compacted `__knowledge`, host functions are registered, and the renderer's component registry is populated. An empty **session space** is also created at `session-{id}/space/` and included in the manifest — the model can populate it at any time via `Space.current()`.

2. **Execution Loop** — The LLM streams tokens; the boundary detector uses the TypeScript scanner to split complete statements. Function and class declarations are intercepted before execution: they are written into the session space (`functions/{name}.ts` or `components/view|form/{Name}.tsx`) and wired as host-bridged globals immediately — they do not appear in `session.ts`. React components are classified by whether their props type includes a `submit` field (form) or not (view). All other statements are routed to tsc (strict, with type inference feedback), transpiled, and evaluated in the QuickJS context. Statements are appended to `session.ts` only after successful execution. Type errors, runtime errors, and tsc inferred types loop back to the LLM as comments. When a statement contains a top-level `await`, the runtime enters speculative mode: subsequent statements are type-checked as they stream but buffered rather than executed. When the awaited Promise resolves, buffered statements execute in order. If a buffered statement errors, remaining buffered statements are discarded and the error is injected as a comment.

3. **Yield** — `inspect()` aborts the LLM stream immediately on execution, then awaits only the Promises explicitly passed as arguments. `inspect()`'s `timeout` is a soft cap: when it elapses, generation resumes with settled Promises resolved and unsettled ones still pending — no forced rejection. Each Promise carries its own logical timeout (`ask`: 5 min default; `fetch`: governed by `AbortSignal`). After awaiting, the new state is committed to git, `scope.json` is derived, `heap.bin` is marshaled, and context reconstruction runs (priority-ordered sections, truncated to fit the configured budget). The reconstruction is sent as a single `role: "user"` message, replacing the previous one. A new LLM completion starts with this fresh context.

4. **Host Bridges** — `display`, `ask`, `fetch`, `fs.*`, `fork`, `tasks`/`actions` are injected as host function handles. Calls cross the WASM boundary as marshaled arguments. JSX from `display()`/`ask()` becomes a descriptor tree; `ask()`'s `submit` is a bridged callback that resolves a QuickJS Promise.

5. **Render Surface** — Ink (terminal CLI) or React (browser). Both runtimes share the built-in component set plus any space-provided components. Fork `display()` calls render into a fork-scoped slot keyed by fork id, separate from the parent's main surface.

6. **Persistent State** — Each session is a git repo. `session.ts` contains only value-producing statements — function and class declarations are intercepted by the boundary detector and written directly into the session space, never appearing here. `heap.bin` is the scope snapshot (marshaled plain values), `scope.json` is the lossy derived view (same data as `__scope`, serialised as JSON), `meta.json` tracks budget/tasks/pins/errors, `trace.jsonl` logs every statement.

7. **Fork** — `fork()` spawns a fresh QuickJS context on a git branch with scope re-seeded from `heap.bin` (minus `exclude`). Session space functions are re-injected as host-bridged globals. The child runs autonomously and calls `resolve(result)` to terminate the fork and resolve the parent's `Promise<ForkResult<T>>`. Fork token usage counts against the parent session's `tokensRemaining`.

---

## API (`llm-repl.d.ts`)

```typescript
// ─── Yield ──────────────────────────────────────────

interface InspectQuery {
  path?: string; // "users[0].address.city"
  slice?: [number, number?]; // [0, 10] or [-5]
  depth?: number; // object nesting, default 2
  /**
   * Restricted expression evaluated per element with `el` bound to each item.
   * Allowed: property access, comparison operators (==, !=, <, >, <=, >=),
   * boolean operators (&&, ||, !), and literal values. Arbitrary code rejected.
   * e.g. "el.age > 30 && el.active == true".
   * Only valid on arrays/Sets; ignored otherwise.
   */
  filter?: string;
  sample?: number; // N evenly-sampled items
  keys?: boolean; // structure only
  count?: boolean; // length/size only
  /** Regex string matched against each element's string representation. */
  search?: string;
}

interface InspectOptions {
  /**
   * Soft cap in ms; default 30000. When elapsed, inspect() proceeds with
   * whatever Promises have settled — unsettled ones remain pending.
   * Per-promise logical timeouts (ask: 5 min, fetch: AbortSignal) govern
   * actual Promise rejection independently of this cap.
   */
  timeout?: number;
}

interface InspectBuilder {
  options(opts: InspectOptions): never;
}

/**
 * Aborts the LLM stream immediately when called. Awaits any Promises passed
 * as arguments (only those — other in-scope Promises remain pending). Resolved
 * values replace their Promise variables in scope for the next cycle. Rejected
 * Promises surface as SessionErrors. The timeout option is a soft cap: when it
 * elapses, generation resumes with settled Promises resolved and unsettled ones
 * shown as pending. Promises not passed appear as pending in the next context.
 *
 * Pass variables to expand them, or [var, query] tuples for queried views.
 * Names recovered via source AST; expressions labeled with their source.
 * Chain .options() to set a per-call soft timeout (default 30 s).
 *
 *   inspect()                                          → scope snapshot, no awaiting
 *   inspect(users, config)                             → scope + both expanded
 *   inspect([users, { slice: [0, 5] }])                → scope + queried view
 *   inspect([users, { filter: "el.age>30", sample: 10 }])
 *   inspect(name, data).options({ timeout: 10000 })    → soft cap 10 s
 */
declare function inspect(...args: (unknown | [unknown, InspectQuery])[]): InspectBuilder;

// ─── Render Surface ─────────────────────────────────

/** Renders JSX to the user. Does NOT yield. Fire-and-forget — progress,
 *  status, rich output. Stable `id` updates in place; default mode is
 *  "replace" when id is set, "append" otherwise. */
declare function display(
  ui: JSX.Element,
  opts?: { id?: string; mode?: "replace" | "append" },
): void;

/** Renders JSX immediately and returns a Promise that resolves with whatever
 *  value the user passes to submit(). Non-blocking — execution continues.
 *  Store the Promise or await it directly. If awaited, downstream statements
 *  are buffered speculatively and execute when the user submits. If stored
 *  without await, inspect() shows it as pending until submitted.
 *  Only when askEnabled. 5-min default logical timeout → TimeoutError unless fallback.
 *  Pending ask Promises are resolved with their fallback value on session end;
 *  if no fallback, they reject with SessionEnded.
 *
 *   const name = ask<string>(<TextInput label="Your name?" />);
 *   const pick = ask<"a"|"b">(<Select options={["a","b"]} />);
 *   inspect(name, pick);   // shows pending until user submits
 *   // next cycle: name and pick hold the submitted values
 */
declare function ask<T = string>(
  ui: JSX.Element,
  opts?: { timeout?: number; fallback?: T },
): Promise<T>;

// ─── Built-in UI Components ─────────────────────────
// Work in both Ink (terminal) and browser React runtimes.
// JSX is transpiled using the automatic JSX transform; _jsx/_jsxs/_Fragment
// are injected into the QuickJS scope — React itself is not required there.

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

// ─── Budget ─────────────────────────────────────────

interface Budget {
  tokensRemaining: number;
  tokensUsed: number;
  inspectCount: number;
  forksActive: number;
  forksCompleted: number;
  /**
   * True when tokensRemaining has dropped to or below the warnAt threshold.
   * Only ever true inside a fork context. When true, the orchestrator also
   * injects a visible warning line into __budget in the context reconstruction:
   *   // ⚠ Budget warning: N tokens remaining — wrap up and resolve() soon.
   */
  nearingLimit: boolean;
  context: {
    used: number;
    max: number;
    scopeTokens: number;
    sourceTokens: number;
    /** Tokens generated past an inspect() boundary before the abort signal propagated. */
    wastedOnAbort: number;
  };
  execution: {
    statementsTotal: number;
    statementsSinceInspect: number;
    heapMB: number;
    heapMaxMB: number;
  };
}
declare function budget(): Budget; // sync, no yield

/**
 * Pause execution for ms milliseconds. Non-blocking — the host timer fires
 * asynchronously; other in-scope Promises continue. Awaitable; downstream
 * statements are type-checked speculatively while sleeping.
 * ms is clamped silently to [0, 60000].
 *
 *   await sleep(1500);
 *   display(<ProgressBar value={50} />);
 *   await sleep(1500);
 *   inspect();
 */
declare function sleep(ms: number): Promise<void>;

// ─── Parallelism ────────────────────────────────────

/**
 * Spawns a parallel completion in a fresh QuickJS context seeded from a
 * serialized snapshot of the parent scope, on a git branch. Returns a
 * Promise immediately — non-blocking. The fork's token usage counts against
 * the parent session's tokensRemaining; tokenBudget is a cap, not an allowance.
 * Fork display() calls render into a fork-scoped slot, not the parent surface.
 * Pass to inspect() to await completion; otherwise each inspect() shows the
 * fork's current state. No nested forks (fork() absent from fork .d.ts).
 * Session space functions are re-injected as host-bridged globals in the fork context.
 * Returns ForkHandle<T> — a Promise extended with inject() for responding to
 * string ask() calls the fork routes to the parent surface.
 */
declare function fork<T>(opts: {
  instruction: string;
  exclude?: string[];   // omit large vars from snapshot
  tokenBudget?: number; // cap (≤ parent tokensRemaining)
  /**
   * Tokens remaining threshold at which the orchestrator injects a budget
   * warning into the fork's next context reconstruction.
   * Default: 20% of tokenBudget, minimum 500 tokens.
   * The fork sees Budget.nearingLimit = true and a visible warning in __budget.
   * It should wrap up its work and call resolve() before being killed.
   */
  warnAt?: number;
}): ForkHandle<T>;

/**
 * Returned by fork(). Extends Promise<ForkResult<T>> with inject() for
 * responding to a string question the fork's ask() routed to the parent surface.
 */
interface ForkHandle<T> extends Promise<ForkResult<T>> {
  /**
   * Respond to the fork's current pending ask() call. Resolves the fork's
   * ask() Promise with the provided string. No-op if the fork has no pending
   * ask(). Callable from the main session only — calling from inside a fork
   * is a kind: "contract" error.
   *
   *   const worker = fork({ instruction: "..." });
   *   inspect(worker);  // next cycle: __fork_asks shows worker's question
   *   worker.inject("Yes, proceed");
   *   inspect(worker);  // fork's ask() resolves; fork continues
   */
  inject(answer: string): void;
}

// ─── Checkpoints & Rollback ─────────────────────────

/** Named savepoint → git tag `cp-{label}` + scope snapshot (marshaled plain values). No yield. */
declare function checkpoint(label: string): void;

/**
 * Rewind by label or N statements. Restores heap.bin snapshot — no
 * re-execution needed since session.ts contains only value-producing statements.
 * Side effects (fetch, fs writes) not undone.
 * Pins set after the target ref are dropped on rollback.
 * Returns number of statements rewound.
 */
declare function rollback(target: string | number): number;

// ─── Memory ─────────────────────────────────────────

/**
 * Pin a variable in context reconstruction — shown full, capped at maxTokens.
 * Pin metadata is scoped to a git ref; pins set after the current HEAD are
 * dropped automatically when rollback moves HEAD before them.
 */
declare function pin(name: string, opts?: { maxTokens?: number }): void;
declare function unpin(name: string): void;

/**
 * Compress a variable's __scope representation. Orchestrator picks strategy
 * (schema|sample|summary|hash). Does NOT touch sandbox heap.
 * Accepts top-level names ("users") or dotted paths into nested scope values
 * ("__knowledge.grading.level"). Dotted-path compaction replaces that subtree
 * in scope.json without affecting the heap value; expand() reverses it.
 */
declare function compact(name: string, maxTokens?: number): void;

/** Reverse compaction from sandbox heap. No yield.
 *  Accepts top-level names or dotted paths. */
declare function expand(name: string): void;

// ─── Knowledge ──────────────────────────────────────
// loadKnowledge is always accessed via a SpaceHandle — see Space.current()
// and Space.load(). There is no standalone top-level loadKnowledge().

// ─── Space Editing ──────────────────────────────────
// Write files into a space's file tree. All mutation methods write files AND
// wire the runtime binding immediately (no inspect() required to call
// functions added via addFunction). loadSpace() still re-runs after inspect()
// to update the system prompt and .d.ts overlay for the next completion.
// All methods return `this` for chaining.

interface SpaceTaskNode {
  description: string;
  dependsOn?: string[];
  instructions?: string; // markdown injected as __currentStep when in_progress
  /**
   * JSON Schema object validated on finish(). The runtime value of the variable
   * named after the step id is validated against this schema at transition time.
   * Example: { type: "object", properties: { name: { type: "string" },
   *   slug: { type: "string" } }, required: ["name", "slug"] }
   */
  outputSchema?: {
    type: "object" | "array" | "string" | "number" | "boolean";
    properties?: Record<string, { type: string; [k: string]: unknown }>;
    items?: { type: string; [k: string]: unknown };
    required?: string[];
    [k: string]: unknown;
  };
}

interface KnowledgeDomainMeta {
  label: string;
  icon?: string;  // emoji
  color?: string; // hex
}

interface KnowledgeFieldConfig {
  type: "select" | "multiSelect" | "text" | "number";
  variableName: string;
  default?: unknown;
}

interface KnowledgeOptionMeta {
  title: string;
  description?: string;
}

interface AgentConfig {
  title: string;
  model?: string;          // overrides SessionConfig model for this agent
  actions?: string[];      // tasklist names this agent can invoke
  knowledge?: string[];    // "domain/field" selectors
  components?: string[];   // component names (view + form)
  functions?: string[];    // function names
}

/** Returned by any action call. Extends Promise so it can be passed directly
 *  to inspect(). Non-blocking — store the result and pass to inspect() to await. */
interface ActionBuilder extends Promise<TasklistResult> {}

// SpaceHandle — returned by Space.load(); typed per-space in the .d.ts overlay.
// The loader generates a branded type per visible space so handles from different
// spaces cannot be silently interchanged. Generic form shown here.
//
// Everything is lazy: nothing is usable until the corresponding load*() is called
// and inspect() has run to regenerate the .d.ts overlay. After that,
// .agents.{role}, .functions.{name}, and .components.{name} are populated.

interface SpaceHandle {
  // ── Lazy loaders — each takes effect at the next inspect() ──────────────

  /** Make an agent's actions available as .agents.{role}.{action}(knowledge, request). */
  loadAgent(role: string): void;
  /**
   * Make a function or class available as .functions.{name}.
   *
   * - **Plain function**: first call produces the full typed entry immediately.
   * - **Class export**: first call produces a collapsed stub with a hint;
   *   second call with `{ expand: true }` replaces it with the full interface.
   *   Two calls + two inspect() cycles are needed to reach full type coverage.
   *
   *   space.loadFunction('NutritionCalculator');
   *   inspect();
   *   // .functions.NutritionCalculator: /* class, 5 methods —
   *   //   call loadFunction('NutritionCalculator', { expand: true }) to expand */
   *   space.loadFunction('NutritionCalculator', { expand: true });
   *   inspect();
   *   // .functions.NutritionCalculator: { new(config?): NutritionCalculatorInstance; ... }
   */
  loadFunction(name: string, opts?: { expand?: boolean }): void;
  /** Register a component for use with display()/ask() as .components.{name}. */
  loadComponent(name: string): void;
  /** Expand a knowledge option into scope and pin it. Always available — no loadAgent() required. */
  loadKnowledge(domain: string, field: string, option?: string): void;

  // ── Populated after the corresponding load*() + inspect() ───────────────
  /** Agents loaded via loadAgent(). Each entry has methods for the agent's actions. */
  agents:     Record<string, unknown>;
  /** Functions/classes loaded via loadFunction(). */
  functions:  Record<string, unknown>;
  /** Components loaded via loadComponent(). Available in display()/ask() JSX. */
  components: Record<string, unknown>;
}

/**
 * Represents a space's file tree. Three entry points:
 *  - `new Space(name)` — create or overwrite a named persistent space
 *  - `Space.current()` — edit the session-scoped space
 *  - `Space.load(name)` — load a named space to access its knowledge and agents
 *
 * Mutation methods write files AND wire runtime bindings immediately.
 * loadSpace() re-runs after the next inspect() to update the system prompt
 * and .d.ts overlay for the following completion.
 *
 * Space.load() returns a typed SpaceHandle — to use a freshly built space's
 * agents, call inspect() first so the .d.ts overlay is updated, then
 * Space.load(name) in the next cycle.
 *
 * If loadSpace() throws during the post-inspect reload (e.g. malformed config
 * file), the prior SessionConfig is kept and a space_reload_failed error is
 * injected into the next context. The session continues; the model can correct
 * the file and try again.
 *
 *   // Build a space
 *   new Space('analyst')
 *     .addAgent('Analyst', '...', { title: 'Analyst', actions: ['report'] })
 *     .addTaskList('report', { ... });
 *   inspect();
 *   // next cycle: actions.report() is available via .d.ts overlay
 *
 *   // Use an existing space — load what you need, then inspect() to get the typed interface
 *   const wiki = Space.load('wiki');
 *   wiki.loadAgent('Editor');
 *   inspect();
 *   // next cycle: wiki.agents.Editor is typed with its action methods
 *   wiki.loadKnowledge('articles', 'recent');
 *   const draft = wiki.agents.Editor.draft_article(
 *     { articles: { topic: 'climate' } },
 *     'Focus on policy developments since 2024, keep it under 500 words',
 *     { context: { recentData, userPrefs } },
 *   );
 *   inspect(draft);
 */
declare class Space {
  constructor(name: string);

  /**
   * Returns a handle to the session-scoped space — auto-created at boot, lives
   * inside the session's git repo, not shared or published. Use it to build
   * reusable functions, components, agents, etc. available for the rest of the
   * session. The session space is always listed first in the space manifest.
   */
  static current(): Space;

  /** Load a named space listed in the space manifest. Returns a handle for
   *  accessing its knowledge and invoking its agents' tasklist actions.
   *  The space's functions and components are NOT merged into the current
   *  session scope — only knowledge loading and agent actions are exposed.
   *  Note: inspect() is required after new Space()/mutation before a newly
   *  built space is accessible via Space.load(). */
  static load(name: string): SpaceHandle;

  /**
   * functions/{name}.ts — exported function becomes a host-bridged global +
   * declare function immediately (same completion, no inspect() required).
   * The .d.ts overlay and system prompt update after the next inspect().
   */
  addFunction(name: string, code: string): this;

  /** components/view/{name}.tsx — available to display(). */
  addViewComponent(name: string, code: string): this;

  /** components/form/{name}.tsx — available to ask(). */
  addFormComponent(name: string, code: string): this;

  /** tasklists/tasklist_{name}/ — becomes actions.{name}() after next inspect(). */
  addTaskList(name: string, dag: Record<string, SpaceTaskNode>): this;

  /** knowledge/{domain}/config.json — domain label, icon, color. */
  addKnowledgeDomain(domain: string, meta: KnowledgeDomainMeta): this;

  /** knowledge/{domain}/{field}/config.json — field type, variableName, default. */
  addKnowledgeField(domain: string, field: string, config: KnowledgeFieldConfig): this;

  /** knowledge/{domain}/{field}/{option}.md — selectable option with guidance body. */
  addKnowledgeOption(domain: string, field: string, option: string, content: string, meta?: KnowledgeOptionMeta): this;

  /** agents/agent-{role}/ (instruct.md + config.json).
   *  instruct is the system prompt body; frontmatter derived from config. */
  addAgent(role: string, instruct: string, config: AgentConfig): this;

  /** Expand a knowledge option from this space into scope and pin it.
   *  Use compact("__knowledge.{domain}.{field}") to release. */
  loadKnowledge(domain: string, field: string, option?: string): void;

  /**
   * Read a file's content by path relative to the space root. Synchronous.
   * Throws if the path does not exist.
   * Required before patch() or write() on an existing file.
   *
   *   const src = Space.current().read('functions/normalise.ts');
   */
  read(path: string): string;

  /**
   * Apply a unified diff to an existing file. The file must have been read
   * first in the same cycle. Wires the updated binding immediately for
   * functions and components (no inspect() required).
   *
   *   Space.current().patch('functions/normalise.ts', `
   *   --- a/functions/normalise.ts
   *   +++ b/functions/normalise.ts
   *   @@ -1,3 +1,3 @@
   *    export function normalise(s: string) {
   *   -  return s.trim().toLowerCase();
   *   +  return s.trim().toLowerCase().replace(/\s+/g, '-');
   *    }
   *   `);
   */
  patch(path: string, diff: string): this;

  /**
   * List files and subdirectories at path relative to the space root.
   * Returns bare names (not full paths). Defaults to the space root.
   * Useful for discovering what already exists before adding or editing.
   *
   *   Space.current().list('functions')  // → ['normalise.tsx', 'slugify.tsx']
   *   Space.current().list()             // → ['functions', 'components', 'knowledge', ...]
   */
  list(path?: string): string[];

  /**
   * Write raw content to any path relative to the space root. Creates
   * intermediate directories as needed. Use for files not covered by the
   * typed addX methods (e.g. a data file, a README, a custom config).
   * For functions and components, prefer addFunction/addViewComponent —
   * they also wire the runtime binding immediately.
   */
  write(path: string, content: string): this;

  /** Remove a file or directory by path relative to the space root. */
  remove(path: string): this;
}

// ─── Tasks ──────────────────────────────────────────

interface TaskNode {
  description: string;
  dependsOn?: string[]; // ids within this tasklist
  /**
   * If true, a failure does not block dependents — they become eligible as if
   * this task had succeeded. The task is marked "failed"; the DAG continues.
   * finish() on an optional task still validates outputSchema if set.
   */
  optional?: boolean;
  /**
   * Restricted expression evaluated against current scope when start() is
   * called. Same operator set as InspectQuery.filter but `el` is not bound —
   * use scope variable names directly: "confirmed == true" or "items.length > 0".
   * Allowed: property access, ==, !=, <, >, <=, >=, &&, ||, !, literals.
   * If the expression evaluates to falsy the task transitions to "skipped"
   * automatically — treated as done for dependency resolution. start() is a no-op.
   */
  condition?: string;
}

type TaskDag = Record<string, TaskNode>;

type TaskStatus = "pending" | "in_progress" | "done" | "blocked" | "failed" | "skipped";

/**
 * Handle returned by tasklist(). Manual tasklist — tasks must be started
 * explicitly via start(id). For action-driven tasklists see ActionTasklistHandle.
 */
interface TasklistHandle {
  start(id: string): void;
  finish(id: string): void;
  block(id: string, reason?: string): void;
  fail(id: string, error?: string): void;
  progress(id: string, value: number): void; // 0–100, shown in __tasks
}

/**
 * Handle returned by actions.{name}(). First eligible task is started
 * automatically. Subsequent tasks require explicit start() after dependsOn
 * tasks are done.
 */
interface ActionTasklistHandle extends TasklistHandle {}

/** Registers a named task DAG and returns a handle for advancing each node.
 *  Multiple tasklists can be active simultaneously. Tasks whose dependsOn
 *  are all done automatically become eligible (status stays pending until
 *  start() is called). The tasklist id scopes the DAG in __tasks.
 *
 *  Orchestrator enforces the dependency graph:
 *  - start() on a task whose dependsOn are not all done → contract error injected
 *    as a comment (kind: "contract"); call is ignored, scope is not dirtied.
 *  - inspect() with unfinished tasklists → orchestrator injects a nudge into the
 *    next context listing each unfinished tasklist, its pending/in_progress nodes,
 *    and their dependency state.
 *
 *   const r = tasklist('research', {
 *     gather:    { description: 'Gather sources' },
 *     analyze:   { description: 'Analyse data',   dependsOn: ['gather'] },
 *     summarize: { description: 'Write summary',  dependsOn: ['analyze'] },
 *   });
 *   r.start('gather');
 *   r.finish('gather');   // 'analyze' becomes eligible
 *   r.start('analyze');
 */
declare function tasklist(id: string, dag: TaskDag): TasklistHandle;

// ─── I/O ────────────────────────────────────────────

/**
 * Sandboxed. Domain allowlist enforced. Rejects with PermissionError.
 * The Response body is pre-buffered by the host up to maxFetchResponseBytes —
 * .text(), .json(), and .bytes() resolve from the in-memory buffer.
 * No streaming body. Use AbortSignal.timeout(ms) in init for per-request timeout.
 */
declare function fetch(url: string, init?: RequestInit): Promise<Response>;

/**
 * Scoped to /session/{id}/files/. No host access.
 * readFile returns Uint8Array for binary reads, string for text.
 */
declare const fs: {
  readFile(path: string, encoding: "utf-8" | "utf8"): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readDir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  rm(path: string): Promise<void>;
  stat(path: string): Promise<{ size: number; mtime: string }>;
};

/**
 * Whitelisted npm packages pre-loaded in sandbox.
 * Ambient module declarations for each entry in SessionConfig.availableModules
 * are generated at session boot and appended to the .d.ts overlay, so tsc
 * sees correct types for require('lodash'), require('date-fns'), etc.
 * TypeScript import statements (import x from 'y') are transpiled to require()
 * calls by tsc's CommonJS output — ES module semantics are not available.
 */
declare function require(module: string): unknown;

// ─── Fork Resolution ────────────────────────────────

/**
 * Available in fork contexts only. Terminates the fork and resolves the
 * parent's Promise<ForkResult<T>> with the given value.
 * Not available in the main session.
 */
declare function resolve<T>(value: T): never;
```

---

## Types

```typescript
interface ForkResult<T> {
  status: "resolved" | "rejected";
  result?: T;
  error?: string;
  tokensUsed: number;
}

interface SessionError {
  /** contract: host-bridge rejection (DAG violation, rollback blocked). Scope never dirtied. */
  kind: "type" | "runtime" | "async" | "permission" | "timeout" | "oom" | "contract";
  message: string;
  statement: string;
  cycle: number;
  attempt?: number;
}

interface SessionConfig {
  allowedDomains: string[];
  maxFetchResponseBytes: number; // 1MB
  maxFileSystemBytes: number;    // 10MB
  fsEnabled: boolean;            // true
  askEnabled: boolean;           // true
  askTimeoutMs: number;          // 300000
  availableModules: string[];    // ambient .d.ts declarations generated per entry
  baseSnapshot?: string;         // heap.bin path from prior session
  execution: {
    maxStatementMs: number;    // 5000 — governs synchronous CPU only; async Promises are not affected
    maxHeapMB: number;         // 256
    maxSnapshotMB: number;     // 64
    maxSessionTokens: number;
    contextWindowTokens: number;
  };
  contextReconstruction: {
    budgetRatio: number;       // fraction of contextWindowTokens reserved for reconstruction (default 0.5)
    hardCapTokens?: number;    // optional absolute cap
  };
  display: {
    maxEntries: number;  // max __display entries retained in context (default 20)
    maxTokens: number;   // max tokens for __display block (default 2000)
  };
  typeChecking: {
    strict: boolean;           // always true
    showInferredTypes: boolean; // true
  };
  speculative: {
    /**
     * Maximum tokens the speculative buffer may accumulate before the LLM
     * stream is aborted. The buffer is held as-is and generation stops.
     * Once the pending Promise settles, the buffer flushes and a new
     * completion starts — the reconstructed context includes the buffered
     * statements as a __speculative_pending block so the model can continue.
     * Default: 2000. A speculative_buffer_overflow event is traced when hit.
     */
    maxTokens: number; // default 2000
  };
  /**
   * Host-registered statement hooks. Executed on the host side — never inside
   * QuickJS. See Developer Hooks section for phase semantics and action types.
   */
  hooks?: SessionHook[];
}

interface TasklistResult {
  /** "completed" = all tasks done; distinct from TaskStatus "done" which is per-task. */
  status: "completed" | "blocked" | "failed";
  /** Keyed by step id. Value is the runtime value of the variable named after
   *  the step id at the time finish(stepId) was called, after JSON Schema
   *  validation passed. */
  outputs: Record<string, unknown>;
}
```

---

## Sandbox: QuickJS

The sandbox uses **QuickJS** (via `quickjs-emscripten`) — a separate JS engine compiled to WASM. It shares no heap with the host Node.js process and has no access to Node APIs unless explicitly bridged.

### Why QuickJS over `vm.Context`

| Property         | `vm.Context`                                          | QuickJS                                       |
| ---------------- | ----------------------------------------------------- | --------------------------------------------- |
| Isolation        | Same V8 process — prototype pollution, shared globals | Separate engine — no shared heap              |
| Globals leakage  | Must block each dangerous global explicitly           | Nothing available unless injected             |
| Memory limits    | Node.js process limit only                            | Per-VM memory limit at engine level           |
| Determinism      | Non-deterministic (shared GC, JIT, timers)            | Deterministic under interrupt handler         |
| Serialization    | Not possible                                          | State serializable via handle marshaling      |
| TypeScript       | tsc in host, execute transpiled JS                    | tsc in host, execute transpiled JS            |

### Lifecycle

```
getQuickJS()                            → QuickJSWASMModule  (once at startup)
    ↓
module.newContext({ maxStackSizeMb })   → QuickJSContext    (one per session)
    ↓
inject globals via host function handles (inspect, display, ask, fork, …)
inject JSX runtime handles (_jsx, _jsxs, _Fragment) for JSX transpilation
    ↓
per statement:
  transpile (host tsc, CommonJS output, import → require(), top-level await preserved)
  IF no pending speculative buffer:
    eval via context.evalCodeAsync()
    IF statement contains top-level await:
      Promise is running; enter speculative mode — subsequent statements buffered
    IF successful (no await): append to session.ts, marshal result back
    IF timeout/OOM: do NOT append; inject error comment; on OOM restore from last inspect commit
  IF speculative buffer active:
    tsc type-check using annotated types from prior await expressions
    push to speculative buffer (do not eval yet)
    type error → inject comment, discard buffer, resume normal execution
  WHEN awaited Promise resolves:
    check structural assignability: actual resolved value vs annotated type
    IF mismatch:
      do NOT append the await statement (discard it from session.ts)
      discard speculative buffer entirely
      auto-inject: inspect(__resolved) using the actual value bound to __resolved
      this triggers a yield → context reconstruction includes:
        - __resolved expanded (the actual value the LLM can inspect)
        - __speculative_nudge (discarded buffer shown as comments + re-annotate prompt)
    IF compatible:
      bind resolved value to variable; append await statement to session.ts
      flush buffer: eval each statement in order
        success → append to session.ts
        error   → inject error comment, discard remaining buffer, resume normal execution
    ↓
on inspect():   (fires as a buffered or normal statement)
                marshal scope values → scope snapshot · derive scope.json · git commit
                NOTE: function/class declarations never reach this path — intercepted by boundary detector → session space
    ↓
session end:    resolve pending ask() Promises with fallback or SessionEnded
                context.dispose()
```

### Host bridge

- Globals are injected as host function handles. Calls cross the WASM boundary as serialized arguments.
- JSX returned from `display()`/`ask()` is marshaled out as a plain descriptor tree (element type + props), then re-hydrated by the host renderer (Ink for terminal, React for browser). Functions in props (event handlers) become opaque handles the host can invoke.
- `fetch` response bodies are pre-buffered by the host up to `maxFetchResponseBytes`. The sandbox receives a descriptor object with `.text()`, `.json()`, `.bytes()` methods that resolve synchronously from the buffer — no stream marshaling.
- `fetch`, `fs`, `require` are host-implemented and bridged in. The sandbox never sees Node primitives directly.
- Statement timeouts use QuickJS's interrupt handler — deterministic, no thread tricks. Timeouts govern synchronous CPU execution only; async Promises have their own per-handle logical timeouts.

---

## Pipeline

```
LLM tokens → boundary detector → tsc diagnostics → QuickJS execution
    (TypeScript scanner)          (strict, always)    (timeout + heap cap)
                                       ↓
                      inspect() call → generation terminates
                                       ↓
                       git commit → context reconstruction → new completion
```

**Async model**: async operations are written with `await`. The model annotates the expected type on every `await` so downstream statements can be type-checked speculatively:

```typescript
const users = await fetch('/api/users').then(r => r.json()) as User[];
const names = users.map(u => u.name);   // type-checked with users: User[], buffered
display(<Table data={users} />);        // buffered
inspect();                              // buffered — fires after the await resolves
```

For parallel operations, use `Promise.all` with a single `await`:

```typescript
const [users, products] = await Promise.all([
  fetch('/api/users').then(r => r.json()),
  fetch('/api/products').then(r => r.json()),
]) as [User[], Product[]];
```

`inspect()` is still the commit-and-refresh yield point. It fires as a buffered statement after all preceding awaits in the same completion have settled, then triggers a git commit and a fresh context.

**Speculative execution**: when a statement containing a top-level `await` is encountered:
1. The async operation is initiated immediately.
2. The runtime enters speculative mode — subsequent statements are type-checked as they stream (using the annotated awaited type) and pushed into a speculative buffer. They are not executed yet.
3. A type error in a buffered statement is injected as a comment and the buffer is discarded; execution resumes normally.
4. If the buffer reaches `speculative.maxTokens`, the LLM stream is aborted. The buffer is held as-is until the Promise settles. A `speculative_buffer_overflow` event is traced. Once the Promise resolves, the buffer flushes and a new completion starts — the reconstructed context includes a `__speculative_pending` block showing the buffered statements so the model can continue naturally.
5. When the Promise resolves, the runtime performs a structural assignability check between the actual resolved value and the annotated type.
6. **If the annotation is wrong** (resolved value is not structurally assignable to the annotated type): the await statement is NOT appended to `session.ts`; the speculative buffer is discarded; the orchestrator auto-injects `inspect(__resolved)` using the actual value. This triggers a yield — the LLM gets a fresh context with the actual resolved value expanded in `__scope` and a `__speculative_nudge` block containing the discarded buffer lines (as comments) and a prompt to re-annotate. The LLM rewrites the await with the correct type and continues.
7. **If the annotation is correct**: the awaited variable is bound, the await statement is appended to `session.ts`, and the buffer flushes. Each successful buffered statement is appended; a buffered runtime error discards the remaining buffer and injects the error.
8. Nested awaits inside the buffer stack — each creates a new buffer layer that flushes when its Promise resolves. A mismatch at any nested level rolls back to that await's statement, discards all outer buffer layers above it, and yields with the same nudge mechanism.

**Type annotation convention**:
```typescript
const data = await fetch(url).then(r => r.json()) as User[];          // annotate fetch results
const text = await fs.readFile('data.csv', 'utf-8');                  // no annotation needed — signature is typed
const result = await somePromise as { id: number; name: string };     // inline shape
const x = await unknownSource as unknown;                              // disables downstream speculative type checking; never use `as any`
```

**Four-backtick file blocks**: before the TypeScript scanner runs, the stream accumulator scans for four-backtick fence openings (` ```` `). These are intercepted as file operations — not sent to tsc or QuickJS, and never appended to `session.ts`.

- **Write block**: ` ````path/to/file ` … ` ```` ` — creates or overwrites `/session/{id}/files/{path}`. Path must be relative with no `..` traversal.
- **Diff block**: ` ````diff path/to/file ` … ` ```` ` — applies a unified diff to `/session/{id}/files/{path}`. The file must have been read via `fs.readFile()` earlier in the current cycle (tracked by a per-cycle **read ledger**); attempting a diff without a prior read is a `kind: "contract"` error — the block is discarded and no write occurs.
- Both operations write to the same sandboxed FS as `fs.*` (`/session/{id}/files/`).
- Committed at the next `inspect()` or `checkpoint()`.
- Trace events: `file_write` (path · bytes) and `file_diff` (path · hunks applied).

**Boundary detection**: the TypeScript scanner (`ts.createScanner()`) tokenizes the stream incrementally. Statement boundaries are detected at depth-0 semicolons using scanner state — correctly handles JSX, generics (`foo<T>()`), type assertions, regex literals, and comments inside strings. At each boundary, the AST node type determines routing: function declarations (`function`, `const = () =>`, `class`) are written to the session space and wired as host-bridged globals immediately — never sent to tsc/QuickJS. React components (functions returning JSX) are further classified: props type includes a `submit` field → form component (`components/form/`), otherwise → view component (`components/view/`). **Re-declaration is blocked**: if the declared name already exists in the session space, a `kind: "contract"` error is injected (`// error: 'name' is already declared — use Space.current().read('functions/name.ts') then .patch() or .write() to update it`) and the declaration is discarded. All other statements proceed to tsc and QuickJS. `inspect()` calls are intercepted when the statement executes in QuickJS (possibly from the speculative buffer). The LLM stream is aborted immediately when `inspect()` executes — any tokens buffered after the boundary are discarded.

**Type errors**: not executed, not appended to session.ts. Error injected as comment, 3 retries, then auto-rollback + nudge. tsc strict is always on.

**Type inference feedback**: tsc's inferred types for new variables injected as comments after execution (`// tsc: result inferred as string[]`).

**Runtime errors**: statement was appended + executed (append happens after successful execution), scope may be dirty. Error injected as comment.

**Async errors**: queued, injected at next statement boundary (never mid-expression).

**Timeouts / OOM**: statement is NOT appended (append happens only after successful execution). Timeout: single statement rolled back via interrupt, error injected. OOM: QuickJS context is potentially corrupt — full restore from the last inspect commit, session continues. Model sees `kind: "oom"` error.

**Tasklist enforcement**: the orchestrator intercepts `TasklistHandle` method calls at the host bridge. `start(id)` is validated against the DAG — if any `dependsOn` node is not `done` or `skipped`, the call is rejected (kind: "contract", not "runtime") and an error comment is injected (`// error: cannot start 'analyze' — 'gather' is still in_progress`). The call is dropped; scope is not dirtied. `start(id)` on a task whose `condition` expression evaluates to falsy silently transitions the task to `"skipped"` and returns — no error injected, and all dependents become eligible. `fail(id)` on a task with `optional: true` marks it `"failed"` and immediately unblocks all dependents (they transition from `"pending"` to eligible). On any `inspect()` with one or more tasklists that have nodes not yet `done`, `failed`, or `skipped`, the orchestrator appends a nudge block to the next context reconstruction.

**Reasoning**: `think()` does not exist. The TypeScript scanner identifies comment tokens in LLM output and logs them as `reasoning` events in trace. String literals containing comment-like sequences are not logged as reasoning. Zero overhead.

---

## Developer Hooks

Host developers register hooks in `SessionConfig.hooks` to intercept statements at defined points in the execution pipeline. Hooks run on the **host side** (never inside QuickJS) and can observe, transform, or discard statements before or after they execute.

### Pipeline position

```
LLM tokens → stream accumulator → [file-block intercept]
    → boundary detector → [before-tsc hook]
    → tsc               → [before-execute hook]
    → QuickJS           → [after-execute hook]

boundary detector → session space write → [on-function-capture hook]
```

### Types

```typescript
type HookPhase =
  | 'before-tsc'          // after boundary detection, before type-checking; transform allowed
  | 'before-execute'      // tsc passed, transpiled JS ready, before QuickJS eval
  | 'after-execute'       // after successful QuickJS execution
  | 'on-function-capture'; // boundary detector routed a declaration to session space

interface HookContext {
  source: string;        // original TypeScript source of the statement
  phase: HookPhase;
  transpiled?: string;   // available in before-execute and after-execute
  result?: unknown;      // QuickJS eval result; available in after-execute
  // on-function-capture only:
  name?: string;
  kind?: 'function' | 'class' | 'view_component' | 'form_component';
}

type HookAction =
  | { action: 'continue' }
  /** Run host-side logic concurrently; never blocks statement execution. */
  | { action: 'side_effect'; fn: () => void | Promise<void> }
  /** Rewrite TypeScript source before tsc. Only valid in before-tsc phase;
   *  returned in any other phase it is treated as 'continue' and a
   *  hook_phase_mismatch event is traced. */
  | { action: 'transform'; code: string }
  /** Discard statement; inject message as a comment into the next LLM context.
   *  Treated as a kind: "contract" error — scope is not dirtied. */
  | { action: 'interrupt'; message: string }
  /** Discard statement silently — not appended, no error injected. */
  | { action: 'skip' };

interface SessionHook {
  id: string;
  phase: HookPhase;
  /** Optional predicate evaluated on the host. Handler called only when match returns true. */
  match?: (ctx: HookContext) => boolean;
  handler: (ctx: HookContext) => HookAction | Promise<HookAction>;
  /** Disable this hook after N consecutive failures (throw or timeout). Default: 3. */
  maxFailures?: number;
}
```

### Behaviour

- `side_effect` actions fire concurrently and never block statement execution. Errors in side-effect callbacks are traced (`hook_side_effect_error`) but do not count as hook failures.
- `transform` is the only action that mutates the statement. The transformed code goes through tsc as if the model had written it; a type error is injected normally.
- `interrupt` and `skip` are terminal — the statement is discarded. Only the first terminal action per phase wins; if multiple hooks would terminate the same statement, only the first is applied and subsequent hooks for that phase are not called.
- `on-function-capture` hooks cannot transform (transform is ignored; a `hook_phase_mismatch` event is traced). They may interrupt or skip — skipping a capture discards the declaration without injecting an error.
- A hook that throws or whose Promise rejects counts as one failure. After `maxFailures` consecutive failures the hook is disabled for the session and a `hook_disabled` event is traced.

---

## Git

### Commit Points (yield points only — not per-statement)

| Event               | Tag           | Committed                      |
| ------------------- | ------------- | ------------------------------ |
| `inspect()`         | `inspect-{n}` | All files + heap.bin (scope snapshot) |
| `checkpoint()`      | `cp-{label}`  | All files + heap.bin (scope snapshot) |
| `fork()` spawn      | —             | Branch `fork/{id}`             |
| Fork resolve/reject | —             | scope.json + meta.json on main |
| `rollback()`        | —             | Reset + new commit             |
| `ask()` call        | —             | traced; Promise shown as pending in next inspect() |
| `ask()` resolve     | —             | traced; resolved value appears in scope at next inspect() |
| Session end         | `session-end` | Final state                    |

Per-statement events live in trace.jsonl (written with O_APPEND + fsync per event; committed at next yield). On host restart, the orchestrator finds the last committed ref and the uncommitted suffix of trace.jsonl is replayed to reconstruct in-flight state.

### Repository

```
session-{id}/
├── session.ts          # virtual source — value-producing statements only, grows during execution, rewindable at yield points
├── scope.json          # derived JSON view (same data as __scope; for reconstruction + diffing, NOT rollback source)
├── heap.bin            # QuickJS state snapshot (rollback source of truth, cap 64MB)
├── meta.json           # budget, tasks, pins, compacts, errors, output
├── trace.jsonl         # per-statement log
├── trace-contexts/     # reconstruction messages per cycle
├── llm-repl.d.ts       # API types
└── space/              # session-scoped space — auto-created on boot, lives in session git repo, not shared
    ├── functions/
    ├── components/
    │   ├── view/
    │   └── form/
    ├── tasklists/
    ├── knowledge/
    └── agents/
```

### `heap.bin` vs `scope.json`

`heap.bin` is a **scope snapshot** — a marshaled binary of all current top-level variable values that QuickJS can serialize across the WASM boundary: primitives, plain objects, arrays, Sets, Maps (with serializable entries). It is the source of truth for rollback.

**What `heap.bin` captures**: all variables whose values are fully representable as JSON-equivalent structures — primitives, plain objects, arrays, Sets, Maps. Exact, round-trip safe, capped at 64MB. Since functions and classes live in the session space (not in `session.ts`), the snapshot captures the complete session state.

**What `heap.bin` does NOT capture**:
- **Host-bridged handles** — the injected globals (`fetch`, `display`, `ask`, session space functions, etc.), open Response objects, QuickJS ↔ host callbacks. These re-bind automatically from the current host environment on restore.
- **Pending promises** — the QuickJS event loop state is not snapshotted. Pending Promises are stored as `undefined` in the snapshot and will not resume on restore. Call `inspect()` before `checkpoint()` to settle all in-flight operations first.

**Restore procedure** (rollback by label, fork seeding):
1. Create a fresh QuickJS context with globals re-injected (including session space functions as host-bridged globals).
2. Deserialize `heap.bin` into the context — scope variables are seeded with their snapshotted values. Done.

If `heap.bin` exceeds 64MB: the commit skips it and emits `snapshot_skipped`. `rollback()` to a point beyond the last valid snapshot is blocked (`RollbackBlockedError`).

`scope.json` is the same values as `heap.bin` expressed as a lossy JSON view — for context reconstruction and git diffs. Always small (truncated representations). Not used for rollback.

---

## Context Reconstruction

Each `inspect()` produces a single `role: "user"` message containing the full reconstruction. The previous reconstruction message is removed — the conversation never accumulates more than one reconstruction message at a time. The conversation structure is always:

```
system:    agent system prompt + generated .d.ts overlay
assistant: TypeScript completion (cycle N)
user:      context reconstruction (cycle N)   ← replaces prior user message
assistant: TypeScript completion (cycle N+1)
...
```

Prior assistant completions are not retained as conversation history — they are represented in the reconstruction via the source tail section (`session.ts` recent lines). This keeps the context window deterministic and bounded.

Built from committed state when `inspect()` fires. Token budget = `contextWindowTokens × contextReconstruction.budgetRatio` (default 0.5).

### Hard-pinned sections (always present, never truncated except under extreme pressure)

- `__budget` — token counts, heap usage, fork status
- `__tasklist_nudge` — unfinished tasklist summary (injected when any tasklist has pending/in_progress nodes at inspect time)
- `__currentStep` — markdown bodies of in-progress tasklist steps (one block per task)
- `__speculative_nudge` — injected only after a speculative type mismatch yield; contains the discarded buffer statements as comments and a re-annotate prompt; present for one cycle only
- `__speculative_pending` — injected only after a speculative buffer overflow; contains the buffered statements verbatim so the model can continue from where the stream was aborted; present for one cycle only
- `__fork_asks` — injected only when at least one active fork has a pending `ask()` call routed to the parent surface; lists each fork's ask UI (rendered in the parent render surface) and the `inject()` call to respond; present as long as any such ask is pending

### Priority-ordered sections (truncated/omitted when over budget)

1. `__scope` — all variables, truncated (omit lowest-frequency vars first)
2. `__errors` — last 3 SessionErrors
3. Expanded variables — per inspect() args (reduce depth, then omit)
4. Source tail — recent session.ts lines
5. `__tasks` — omit with notice
6. `__forks` — fork Promises shown inline in `__scope` with current state (`Promise → pending` / `Promise → resolved` + emitted value / `Promise → rejected` + error / `Promise → asking` when fork has a pending ask routed to the parent surface); omit completed first
7. `__display` — recent display() calls up to `display.maxEntries`/`display.maxTokens`; omit oldest first; stable-id entries deduplicated to latest version
8. `__git` — HEAD, checkpoints, branches
9. Type feedback — tsc inferred types

When `__scope` alone exceeds budget: auto-compact largest non-pinned vars, reduce depth to 1, omit vars not accessed in 3 cycles. Model sees: `// ⚠ Context pressure: {n} variables auto-compacted.`

### Format (TypeScript — matches the model's read/write language)

```typescript
// ═══ inspect #3 ═══

const __scope = {
  config: /* pinned */ { apiUrl: "https://api.example.com", batchSize: 50 },
  users: /* Promise<User[]> → resolved */ { length: 247 },
  oldest: { id: 89, name: "Margaret Chen", age: 94, city: "Portland" },
  userName: /* Promise<string> → pending */ undefined,
  report: /* Promise<ForkResult> → resolved */ { status: "resolved", tokensUsed: 412 },
};

const __users = [
  // expanded, depth 2
  { id: 1, name: "Alice", age: 32, city: "Portland" },
  { id: 2, name: "Bob", age: 28, city: "Seattle" },
];

const __errors: SessionError[] = [
  {
    kind: "type",
    message: "Property 'nme' does not exist on 'User'",
    statement: "users.map(u => u.nme)",
    cycle: 2,
    attempt: 1,
  },
];

const __budget: Budget = {
  /* ... */
};
const __tasks: Task[] = [
  /* ... */
];
const __forks = { fork_g7h8: { status: "resolved", tokensUsed: 620 } };
// ── git: HEAD inspect-3 (a1b2c3d), cp: before-transform ──
/* ... source tail ... */
```

When a speculative type mismatch yield fires, the context also contains:

```typescript
// ─── __resolved (actual value — annotated as User[], got:) ───
const __resolved = { error: "Unauthorized", code: 401 };

// ─── __speculative_nudge ─────────────────────────────────────
// Speculative type mismatch: await was annotated as User[] but resolved to
// { error: string; code: number }. The await statement was not committed.
// Discarded buffer (re-write after correcting the annotation):
//   const names = users.map(u => u.name);
//   display(<Table data={users} />);
//   inspect();
// Re-annotate the await with the actual type and continue.
```

### Scope truncation

| Type                    | Representation                         |
| ----------------------- | -------------------------------------- |
| Primitives              | Full                                   |
| Strings ≤100 chars      | Full                                   |
| Strings >100 chars      | `{ length, preview }`                  |
| Arrays/Sets/Maps        | Type comment + length/size             |
| Objects ≤5 keys         | Full (values truncated at depth)       |
| Objects >5 keys         | Type comment + `{ _keys: N }`          |
| Functions               | Signature from tsc                     |
| Pinned                  | Full, capped at maxTokens              |
| Compacted               | Orchestrator strategy                  |
| `Promise` — resolved    | `/* Promise<T> → resolved */` + value  |
| `Promise` — rejected    | `/* Promise<T> → rejected */` + error  |
| `Promise` — pending     | `/* Promise<T> → pending */`           |
| `Promise` — asking      | `/* Promise<T> → asking */` (fork has a pending ask routed to parent surface) |

### Decay Tiers

Applied as base defaults before priority-ordered truncation; tiers narrow the reconstruction further as the session grows. Session age is measured by `inspectCount` (total `inspect()` calls so far). A variable's **cycle distance** is `inspectCount − lastAccessed`, where `lastAccessed` is the cycle at which the variable was last passed to `inspect()` or appeared in a type-inference feedback line.

| Section | Early (inspectCount 0–5) | Mid (6–15) | Late (16+) |
| --- | --- | --- | --- |
| Source tail (session.ts lines) | 100 lines | 50 lines | 20 lines |
| `__scope` depth | Per truncation table | Depth 1 for vars with cycle distance ≥ 3 | Depth 1 for all non-pinned vars |
| `__scope` auto-compact threshold | Cycle distance ≥ 10 | Cycle distance ≥ 6 | Cycle distance ≥ 3 |
| `__errors` retained | Last 3 (full) | Last 2 (message + statement) | Last 1 (message only) |
| `__display` maxEntries | As configured | Half of configured, min 5 | Quarter of configured, min 3 |
| Completed/skipped tasks in `__tasks` | Shown for 3 cycles after close | Hidden | Hidden |

Tiers apply globally; `pin()` overrides per-variable (always full, never decayed) and `compact()` overrides with explicit compression regardless of tier.

---

## Forks

**Isolation**: a fresh QuickJS context seeded by deserializing the parent's `heap.bin`. Session space functions are re-injected as host-bridged globals. `exclude` removes variables from the snapshot before seeding. The child runs on its own git branch.

**No nesting**: `fork()` absent from fork `.d.ts`. tsc enforces at compile time.

**Fork can use**: inspect, checkpoint, rollback, pin, compact, expand, resolve, fetch, fs, require, budget, tasklist, ask (string only — see below).

**Fork cannot use**: fork.

**Fork ask()**: a fork may call `ask()` with two restrictions: (1) the return type is always `Promise<string>` — the fork `.d.ts` replaces the generic `ask<T>` with `declare function ask(ui: JSX.Element, opts?: { timeout?: number; fallback?: string }): Promise<string>`; (2) the UI does **not** render in the fork's display slot — it renders in the **parent session's render surface**, labelled with the fork id. The fork's `ask()` Promise stays pending until the parent calls `forkHandle.inject(answer)` or the 5-minute logical timeout fires (uses fallback if provided, otherwise rejects with `TimeoutError`). The parent sees the pending question in `__fork_asks` in the next reconstruction — a hard-pinned section listing each fork-sourced pending ask with its rendered UI. The parent responds with `myFork.inject("answer string")`, which resolves the fork's `ask()` Promise. The fork can pass its ask Promise to `inspect()` to pause until the answer arrives, or continue working and await it later.

**Lifecycle**: spawn (git branch) → execute → `resolve(result)` → Promise resolves. `resolve<T>(value: T): never` — it terminates the fork. Awaited if passed to `inspect()`; otherwise visible as `Promise → resolved` in `__scope` on the next cycle without blocking. Branches preserved for forensics, cleaned at session end.

**Budget**: fork token usage counts against the parent session's `tokensRemaining` in real time. `tokenBudget` is a per-fork cap, capped internally at `min(tokenBudget, parent.tokensRemaining)`. When `tokensRemaining` drops to or below `warnAt` (default: 20% of `tokenBudget`, minimum 500 tokens), the orchestrator sets `Budget.nearingLimit = true` and injects `// ⚠ Budget warning: N tokens remaining — wrap up and resolve() soon.` into the fork's next `__budget` block. The fork should finalize its work and call `resolve()`. If the fork exhausts its cap without resolving, it is killed with a `BudgetExceeded` rejection and `ForkResult.status = "rejected"`.

**Display**: fork `display()` calls render into a fork-scoped render slot keyed by fork id. The host renderer presents fork output separately (e.g. a collapsible section, a sub-panel). Multiple parallel forks do not interleave on the parent's main surface.

**Concurrency**: multiple forks run in parallel. Pass a fork Promise to `inspect()` to block until it completes. If not passed, each inspect() cycle shows the fork's current state (`Promise → pending`, `Promise → resolved`, or `Promise → rejected`) without blocking generation.

---

## Rollback

**By label** (preferred): `rollback("before-transform")` → restore scope snapshot from `cp-before-transform` git tag. Fresh QuickJS context: deserialize `heap.bin`, re-inject session space functions as host-bridged globals. Pins set after the target ref are dropped.

**By count**: `rollback(3)` → walk `trace.jsonl` back 3 executed statements, truncate `session.ts` accordingly. Restore from the nearest prior checkpoint snapshot via the same procedure.

Side effects (fetch, fs writes) are not undone by rollback. `session.ts` contains only value-producing statements — there are no function definitions to re-execute.

---

## `display()` and `ask()`

`display()` renders JSX to the user without yielding — used for progress, tables, charts, status. Stable `id` updates the element in place; otherwise it appends. Each call is logged in trace and a truncated record retained as `__display` in context (bounded by `display.maxEntries` and `display.maxTokens`).

On `rollback()`, a `display_invalidate` event is emitted with the cutoff statement index. The renderer drops all display elements first written after that index. Stable-id elements written before the cutoff retain their last pre-cutoff state.

`ask()` renders JSX immediately and returns a Promise — non-blocking. The host injects `submit` as a prop; when the user calls `submit(value)`, the Promise resolves with that value. The model stores the Promise and calls `inspect()` to check its state. When resolved, the variable holds the submitted value in the next cycle.

**Timeout**: `ask()` carries a 5-minute logical timeout independent of `inspect()`'s soft cap. Passing an ask Promise to `inspect()` without setting `.options({ timeout: 300000 })` does not force early rejection — the `inspect()` soft cap elapses and the ask Promise remains pending, shown as `Promise → pending` in the next cycle.

**Session end**: all pending ask Promises are resolved with their `fallback` value on session end. If no fallback was provided, they reject with `SessionEnded`. The renderer dismounts all open ask elements.

`askEnabled` defaults to `true`. Set to `false` for non-interactive batch sessions; `ask` is then absent from the `.d.ts`.

**Fork-context ask()**: within a fork, `ask()` is restricted to `Promise<string>` — the fork `.d.ts` replaces the generic form. The UI renders in the parent surface (not the fork slot). See [Forks — Fork ask()](#forks) and `ForkHandle.inject()` for the full protocol.

Multiple `ask()` calls can be in flight simultaneously. There is no `__askResponse` in context — resolved ask Promises are shown in `__scope` like any other resolved Promise.

Both surfaces render in Ink (terminal CLI) or React (browser). Built-in components (`TextInput`, `Select`, `Confirm`, `Table`, `ProgressBar`, `Markdown`, `CodeBlock`) work in both runtimes. JSX is marshaled across the QuickJS boundary as a descriptor tree — sandbox code cannot pass arbitrary functions through, but `AskProps<T>.submit` is bridged.

---

## Base Snapshots

`SessionConfig.baseSnapshot` provides a `heap.bin` scope snapshot from a prior session's checkpoint. On boot: the restore procedure runs (deserialize `heap.bin`, re-inject session space functions). The new session's `session.ts` starts empty — new code appends after the restored state. Use case: library sessions (pre-load heavy computations), iterative workflows (continue from a known state).

---

## Spaces

A **Space** is a declarative session configuration — a file tree that the loader compiles into a `SessionConfig` overlay. The REPL primitive doesn't know about spaces; it only sees the resulting system prompt, generated `.d.ts`, preloaded scope, and host-function table.

### Session Space

Every session automatically gets an empty **session space** at `session-{id}/space/`. It is a full space — the same file tree layout, the same loader, the same reload-on-inspect cycle — but it is **session-scoped**: it lives inside the session's git repo and is not shared or published beyond this session.

`Space.current()` returns a handle to the session space. The model uses it for programmatic space editing, but in practice functions and components are captured automatically by the boundary detector — the model just writes TypeScript naturally.

The session space is always listed first in the space manifest injected into the system prompt.

```ts
// Declare a function — boundary detector captures it into session-space/functions/normalise.ts
// and wires it as a host-bridged global immediately. No Space.current() call needed.
function normalise(s: string) { return s.trim().toLowerCase(); }
normalise("  Hello  "); // callable immediately in this completion
inspect();
// after inspect(): normalise appears as a TypeScript interface in the system prompt

// To update an existing function: read first, then patch or write.
const src = Space.current().read('functions/normalise.ts');
Space.current().patch('functions/normalise.ts', `
--- a/functions/normalise.ts
+++ b/functions/normalise.ts
@@ -1,3 +1,3 @@
 export function normalise(s: string) {
-  return s.trim().toLowerCase();
+  return s.trim().toLowerCase().replace(/\\s+/g, '-');
 }
`);
// updated binding is live immediately

// Declare a view component — auto-captured into session-space/components/view/UserCard.tsx
const UserCard: FC<{ name: string; email: string }> = ({ name, email }) => (
  <Box><Text>{name}</Text><Text dim>{email}</Text></Box>
);
display(<UserCard name="Alice" email="alice@example.com" />);

// Declare a form component — submit prop detected → session-space/components/form/ConfirmDelete.tsx
const ConfirmDelete: FC<{ item: string; submit: (confirmed: boolean) => void }> = ({ item, submit }) => (
  <Box><Text>Delete {item}?</Text><Button onPress={() => submit(true)}>Yes</Button></Box>
);
const confirmed = ask<boolean>(<ConfirmDelete item="report.csv" />);
inspect(confirmed);
```

### Layout

```
{space-slug}/
├── package.json
├── agents/
│   └── agent-{role}/
│       ├── instruct.md       # frontmatter: title, model, actions[] · body = system prompt
│       └── config.json       # access list: knowledge[], components[], functions[], actions[]
├── tasklists/
│   └── tasklist_{action}/
│       ├── index.md          # overview + ordered step list
│       └── {N}.{name}.md     # frontmatter: id, dependsOn[], outputSchema · body = step instructions
├── functions/{name}.ts      # plain TS exports → host-bridged globals (immediate)
├── components/
│   ├── view/{Name}.tsx       # for display()
│   └── form/{Name}.tsx       # for ask()
└── knowledge/{domain}/
    ├── config.json           # section: label, icon, color
    └── {field}/
        ├── config.json       # type, default, variableName
        └── {option}.md       # frontmatter: title, description · body = guidance
```

### Loader

```ts
loadSpace(path: string, agentId: string): {
  systemPrompt: string;        // agent's instruct.md body + space manifest (all spaces + files)
  generatedDts: string;        // appended after llm-repl.d.ts
  preloadedScope: object;      // __knowledge, ambient config
  hostFunctions: Record<string, Function>;  // injected into QuickJS as handles
  componentRegistry: Record<string, FC>;    // available to display()/ask()
  tasklistMap: Record<string, TasklistDefinition>;  // for actions
} → SessionConfig
```

Pure function. No side effects, no LLM. Output feeds straight into session boot. After each `inspect()`, the orchestrator re-runs `loadSpace()` against the current file tree — if any space files changed (via the save methods), the new system prompt and `.d.ts` overlay take effect for the next completion. Unchanged sessions pay no cost; the loader is fast and stateless.

If `loadSpace()` throws during a post-inspect reload (e.g. malformed JSON in a config file written by the model), the prior `SessionConfig` is kept, a `space_reload_failed` error (kind: "contract") is injected into the next context identifying the offending file, and the session continues. The model corrects the file and the reload retries at the next inspect.

When the `.d.ts` overlay is updated and a binding that was previously declared is removed (e.g. a function deleted from a space), a `binding_orphaned` event is traced for each affected name. The orphaned name appears in `__scope` with `/* orphaned: removed from .d.ts */`. The runtime value still exists in the QuickJS heap; calling it succeeds but produces a tsc error.

The generated `systemPrompt` appends a **space manifest** after the agent's `instruct.md` body: a structured listing of every space visible to the session (name, agents, tasklists, functions, component names, knowledge domain/field names). This gives the model a complete picture of what exists — what it can invoke, extend, or build upon — without expanding knowledge option bodies (those remain lazy via `loadKnowledge()`). Functions are listed by name and signature; **classes are listed by name with a method count** (`DataProcessor (class, 8 methods)`) — this keeps the manifest compact and signals that `loadFunction(name, { expand: true })` is needed to get the full interface.

### What each artifact becomes

| Artifact | Becomes |
| --- | --- |
| `instruct.md` body | System prompt (+ space manifest appended by loader) |
| `instruct.md` frontmatter `model` | Overrides `SessionConfig` model |
| `agent/config.json` access lists | Filter — only listed entries reach `.d.ts` and renderer |
| `functions/{fn}.ts` (function export) | Host-bridged global (immediate) + `declare function fn(...)` in next .d.ts overlay |
| `functions/{fn}.ts` (class export) | Available via `space.loadFunction(name)` → collapsed stub in `.functions.{name}` with hint; `space.loadFunction(name, { expand: true })` → full class interface. Two `loadFunction` calls + two `inspect()` cycles needed. |
| `components/view/{C}.tsx` | `declare const C: FC<...>`; registered with renderer for `display()` |
| `components/form/{C}.tsx` | Same, available to `ask()` |
| `knowledge/{d}/{f}/{o}.md` | `__knowledge.{d}.{f}` in scope, compacted to schema by default |
| `tasklists/tasklist_{a}/` | Entry in `tasklistMap`, callable via `actions.{a}()` after next inspect |
| Any path | `Space.read(path)` → raw content · `Space.list(path?)` → file names · `Space.write(path, content)` → raw write |

### Loading spaces

`Space.load(name)` gives the model access to any space listed in the manifest. The loader generates a **branded `SpaceHandle` type per visible space** in the `.d.ts` overlay, so handles from different spaces have distinct types and cannot be silently interchanged. Two capabilities are exposed:

- **Knowledge** — `handle.loadKnowledge(domain, field, option?)` expands a knowledge option from the target space into scope. Always available without loading an agent first.
- **Agent actions** — call `handle.loadAgent(role)` then `inspect()`, then invoke `handle.agents.{role}.{action}(knowledge, request)`.

**Accessing a space just built with `new Space()`** requires `inspect()` first — the `.d.ts` overlay is updated before the following completion starts, at which point `Space.load(name)` returns the typed handle.

```ts
const wiki = Space.load('wiki');
wiki.loadAgent('Editor');
inspect();
// next cycle: wiki.agents.Editor is typed
wiki.loadKnowledge('articles', 'recent');
const draft = wiki.agents.Editor.draft_article(
  { articles: { topic: 'climate' } },
  'Focus on policy developments since 2024, keep it under 500 words',
  { context: { recentData, userPrefs } },
);
inspect(draft);
// next cycle: draft holds TasklistResult with step outputs
```

### Agent actions

Actions are methods on a loaded agent handle — `space.agents.{role}.{action}(knowledge, request, opts?)`. They are *the agent's capabilities*, not commands parsed from user input.

Each action takes three arguments:

1. **`knowledge`** — typed object whose shape is auto-generated from the agent's knowledge access list in `config.json`. Each `"domain/field"` entry becomes an optional nested key. Value types come from the field's `config.json` type and the option filenames present under `knowledge/{domain}/{field}/`. Supplied values are pre-loaded (expanded + pinned) before the tasklist starts; steps that would have gathered that input via `ask()` can skip it.
2. **`request`** — natural language instruction injected into the agent's context before the first tasklist step.
3. **`opts?`** — optional `{ context?: Record<string, unknown> }` — extra scope vars serialised into the fork before the action starts.

| Knowledge field type | Generated TypeScript type                             |
| -------------------- | ----------------------------------------------------- |
| `select`             | `'option-a' \| 'option-b' \| …` (union of filenames) |
| `multiSelect`        | `Array<'option-a' \| 'option-b' \| …>`                |
| `text`               | `string`                                              |
| `number`             | `number`                                              |

All action calls return an `ActionBuilder` (extends `Promise<TasklistResult>`), non-blocking. Pass to `inspect()` to await.

The active agent's own actions are also available as a typed global `actions` object (declared in the `.d.ts` overlay) using the same `(knowledge, request, opts?)` signature — these are a convenience alias for calling `Space.current()` agent methods without going through the handle.

```ts
// Generated into .d.ts overlay — active agent's own actions as globals
// (same signature as handle.agents.{role}.{action})
declare const actions: {
  create_space(
    knowledge: {
      'space-structure'?: {
        naming?: 'kebab-case' | 'snake-case' | 'camel-case';
        layout?: 'flat' | 'nested' | 'modular';
      };
      'agent-design'?: {
        role?: 'specialist' | 'generalist' | 'coordinator';
      };
    },
    request: string,
    opts?: { context?: Record<string, unknown> },
  ): ActionBuilder;
  design_knowledge(
    knowledge: {
      'knowledge-design'?: {
        structure?: 'flat' | 'hierarchical';
        domains?: Array<'content' | 'behaviour' | 'context'>;
      };
    },
    request: string,
    opts?: { context?: Record<string, unknown> },
  ): ActionBuilder;
  // select → union of option filenames · multiSelect → Array<union> · text → string · number → number
};
```

Calling `const result = actions.create_space(knowledge, request)` (non-blocking, store as Promise):

1. Loader resolves `tasklist_create_space/` → ordered list of steps with `outputSchema` and bodies.
2. `knowledge` fields pre-load matching knowledge options (expand + pin) into scope.
3. `request` is injected as a context message before the first step.
4. Materializes a `tasklist('tasklist_create_space', { ...dag })` (one node per step, `dependsOn` from frontmatter). Returns an `ActionTasklistHandle`; first eligible task starts automatically.
5. Returns a Promise immediately. The model calls `inspect(result)` to see tasklist progress.
6. Each inspect() shows current task statuses. The model advances tasks by calling `handle.finish(stepId)`.
7. When all tasks are `done` (or any is `failed`), the Promise resolves with `TasklistResult`.

**Task completion contract**: the model marks tasks done via `handle.finish(stepId)`. The orchestrator validates the step's `outputSchema` (JSON Schema object) against the runtime value of the variable named after the step id in scope at the time of the call. Validation failure → `kind: "contract"` error comment, task stays `in_progress`. The validated runtime value is stored as `TasklistResult.outputs[stepId]`.

**Actions vs manual tasklist**: `ActionTasklistHandle` auto-starts the first eligible task on creation. Manual `tasklist()` returns `TasklistHandle` — no auto-start. The distinction is reflected in the type and trace events (`action_invoke` vs `tasklist_register`).

### Tasklists: per-step context injection

Each step is *both* a task and a context fragment.

- **As a task**: lives in `__tasks`, has `id`, `description` (from step frontmatter), `status`, `dependsOn`. Output validated against `outputSchema` when transitioning to `done`.
- **As a fragment**: when a task moves to `in_progress`, that step's markdown body is appended to the next context reconstruction as `__currentStep`. It stays in context as long as the task is in-progress and is dropped when it closes. Multiple parallel in-progress steps each contribute a `__currentStep` block, labeled by task id. `__currentStep` is hard-pinned and never truncated, only omitted under extreme pressure.

### Knowledge: preload + lazy expand

- All knowledge listed in the agent's `config.json` is preloaded as `__knowledge.{domain}.{field}` — compacted to **schema** strategy by default. The model sees option titles and field shapes, not full bodies.
- `Space.current().loadKnowledge(domain, field, option?)` or `Space.load(name).loadKnowledge(...)` expands the requested slice into scope and pins it. There is no standalone top-level `loadKnowledge()` — knowledge is always accessed through a SpaceHandle.
- `compact("__knowledge.{domain}.{field}")` targets the subtree in `scope.json` without touching the heap value; only the reconstruction view is compressed. `expand("__knowledge.{domain}.{field}")` reverses this from the heap.

This keeps cold context cheap and lets the model pull rich guidance only when relevant.

### Multi-agent

Two modes:

- **Spawn** (preferred): `fork({ instruction: agentInstruct, exclude: [...] })`. The child gets its own `.d.ts` overlay (the target agent's filter) applied at fork-seed time. True isolation — parent and child scopes don't collide. Results flow back via `ForkResult`. Use when the delegated agent produces a discrete output.
- **New session**: for a full agent switch where the next agent takes over the conversation, start a new session with `baseSnapshot` pointing to the current checkpoint. The new agent boots with shared scope values but its own `session.ts`, type environment, and `.d.ts` overlay.

The space loader re-runs after every `inspect()` when space files have changed; nothing in the REPL primitive changes.

### Slash actions are agent capabilities, not user input

Critical: the orchestrator does **not** intercept user input looking for `/cmd`. User messages enter the session as normal context. The agent — reading its conversation — decides whether to call `actions.cmd()`. This means:

- Slash UI affordances in the chat surface (e.g. autocomplete) are *suggestions to the user*, but the user typing `/create_space` still flows through the LLM as text.
- The model, seeing `/create_space` in the latest user message, calls `actions.create_space()` itself.
- This keeps the spec primitive intact: the only entry point is the LLM writing TypeScript.

---

## Contracts

Invariants that implementors must maintain. Violations in any direction produce inconsistent session state.

| Contract | Rule |
| --- | --- |
| Append timing | Statements are appended to `session.ts` only after successful QuickJS execution — not before, not on type error, not on timeout/OOM. |
| Function auto-routing | Function and class declarations are intercepted by the boundary detector before tsc/QuickJS and written into the session space. They never appear in `session.ts`. React components are classified by whether props include a `submit` field: yes → form component, no → view component. |
| No re-declaration | Declaring a function or class whose name already exists in the session space is a `kind: "contract"` error. The declaration is discarded. Update via `Space.current().read()` then `.patch()` or `.write()`. |
| Commit atomicity | All files (`session.ts`, `scope.json`, `heap.bin`, `meta.json`) are committed in the same git operation at yield points. Partial commits are not valid state. |
| Statement/trace alignment | Every `execute` event in `trace.jsonl` corresponds exactly to a statement in `session.ts`. Rolling back N statements removes N trace entries and the same N lines from `session.ts`. |
| Pin ref-scoping | Pin metadata is stored with the git ref at which `pin()` was called. Rollback past that ref removes the pin. |
| Fork budget | Fork token usage debits the parent's `tokensRemaining` in real time. A fork cannot consume tokens beyond `min(fork.tokenBudget, parent.tokensRemaining)` at spawn time. |
| Contract errors | Host-bridge rejections (DAG violations, rollback blocks) use `kind: "contract"`. They never dirty scope. |
| Display after rollback | `display_invalidate(cutoffIndex)` is emitted on any rollback. Renderer drops elements first written after `cutoffIndex`. |
| Speculative append | Buffered statements are appended to `session.ts` only when they execute successfully after the await resolves — not when they are type-checked into the buffer. |
| Speculative type annotation | A `as Type` annotation on an `await` expression is used by tsc for downstream type-checking. On resolve, the actual value is structurally checked against the annotation. A mismatch rolls back the await statement, discards the buffer, and yields with `__speculative_nudge` and the actual value expanded. The LLM rewrites the annotation in the next cycle. |
| sleep cap | `sleep(ms)` clamps `ms` to `[0, 60000]` silently. No error is injected for out-of-range values. |
| Optional task failure | `fail(id)` on a task with `optional: true` marks it `"failed"` and immediately makes all dependent tasks eligible. |
| Conditional task skip | `start(id)` on a task whose `condition` evaluates to falsy transitions it to `"skipped"` (treated as done for DAG resolution) and returns without error. |
| File block read-before-diff | A four-backtick diff block targeting a file not read via `fs.readFile()` in the current cycle is a `kind: "contract"` error. The block is discarded; no write occurs. |
| Hook transform phase | A `transform` action returned from a hook in any phase other than `before-tsc` is treated as `continue`; a `hook_phase_mismatch` event is traced. |
| Hook terminal priority | Only the first terminal action (`interrupt` or `skip`) per phase wins. Subsequent hooks for that phase are not called once a terminal action is decided. |
| Fork inject type | `inject(answer)` accepts only a string value. Passing a non-string is a `kind: "contract"` error on the host bridge; the fork's pending ask() is not resolved. |
| Fork inject no-op | `inject()` when the fork has no pending ask() is silently ignored — no error, no trace event. |
| Class stub in .functions | `loadFunction(name)` on a class populates `.functions.{name}` with a collapsed stub and a .d.ts hint comment. Using methods on the stub produces a tsc error: `// error: 'DataProcessor' is a collapsed class — call loadFunction('DataProcessor', { expand: true }) then inspect() to expand`. Call `loadFunction(name, { expand: true })` + `inspect()` to replace the stub with the full interface. |
| loadFunction idempotent | `loadFunction(name)` when the function is already loaded, or `loadFunction(name, { expand: true })` when already fully expanded, is a no-op; no event is traced. |

---

## Layers

| Layer | Adds                                    | Eval focus                           |
| ----- | --------------------------------------- | ------------------------------------ |
| 0     | Sandbox + boundary detector + trace     | Error rate                           |
| 1     | tsc (strict) + retries + type inference | Self-correction rate                 |
| 2     | inspect, budget, \_\_errors             | Inspect frequency, budget tracking   |
| 3     | checkpoint, rollback                    | Checkpoint quality, rollback success |
| 4     | fork + resolve                          | Speedup, fork success rate           |
| 5     | pin, compact, expand                    | Context utilization                  |
| 6     | tasklist                                | Task completion, DAG scheduling      |
| 7     | fetch, fs, require                      | E2E completion                       |
| 8     | display, ask (JSX)                      | Render correctness, clarification quality |
| 9     | Base snapshots                          | Cross-session reuse                  |
| 10    | Spaces (actions, tasklists, knowledge, agent .d.ts overlay, Space class) | Action success rate, tasklist completion, knowledge expansion accuracy, space authoring |

**Model thresholds**: 1–3B → L0–1 · 7–14B → L0–3 · 30–70B → L0–6 · Frontier → all.

---

## Eval

**Core**: task completion, token efficiency, error rate, recovery rate.

**Inspect**: frequency, dead-code-after-inspect (should be 0), expansion efficiency, inspect-to-action ratio.

**Recovery**: checkpoint-vs-count rollback ratio, rollback success rate, type retry efficiency.

**Memory**: context utilization, proactive-vs-auto compact ratio, pin accuracy, snapshot skip rate.

**Forks**: utilization, success rate, token efficiency, exclude accuracy, budget overrun rate.

**Planning**: task completion, staleness, reasoning density, ask efficiency.

**Git-derived**: yield density, scope diff between inspects, branch count, rollback ratio, contract error rate.

**Test tiers**: 1 pure code → 2 +inspect → 3 +type inference → 4 +checkpoint/rollback → 5 +fork → 6 +compact → 7 +tasks+I/O → 8 +ask → 9 +base snapshot.

---

## Trace (`trace.jsonl`)

One JSON line per event. Append-only, never summarized. Written with O_APPEND + fsync per event. Full reconstructions in `trace-contexts/cycle-{n}.ts`.

Events: `session_start`, `space_load`, `space_reload` (after inspect when space files changed), `space_reload_failed` (path · error), `agent_activate`, `completion_start/end`, `reasoning`, `statement_received`, `function_captured` (name · kind: function|class|view_component|form_component · path in session space), `function_redeclare_blocked` (name · existing path · contract error injected), `type_check_pass/fail`, `type_inferred`, `execute`, `runtime_error`, `contract_violation` (host-bridge rejection · kind), `promise_resolve`, `promise_reject`, `timeout`, `oom`, `inspect`, `inspect_settle` (promises awaited at inspect time), `checkpoint`, `rollback`, `snapshot_skipped`, `fork_spawn/resolve/reject`, `fork_budget_warning` (tokensRemaining · warnAt threshold), `fork_resolve` (fork terminated via resolve()), `compact`, `expand`, `pin/unpin`, `auto_compact`, `tasklist_register`, `tasklist_update` (id · node · old_status → new_status), `action_invoke`, `action_resolve`, `tasklist_step_enter/exit`, `knowledge_expand`, `space_file_read` (path), `space_file_write` (method · path), `space_file_remove` (path), `space_file_list` (path · count), `display`, `display_invalidate` (cutoffIndex on rollback), `ask`, `ask_resolve`, `ask_timeout`, `ask_cancelled` (session end, no fallback), `binding_orphaned` (name · removed from .d.ts overlay), `speculative_buffer_start` (await encountered · annotated type), `speculative_type_check_pass/fail` (per buffered statement), `speculative_buffer_overflow` (maxTokens hit · tokens accumulated · LLM stream paused), `speculative_execute` (buffered statement executed after await resolved), `speculative_type_mismatch` (resolved type incompatible with annotation · triggers rollback + yield · actual value logged), `speculative_aborted` (buffered statement errored · remaining buffer size), `context_reconstruct`, `budget_check`, `session_end`, `sleep` (ms · resolved after delay), `file_write` (path · bytes), `file_diff` (path · hunks applied), `file_diff_no_read` (path · contract error injected), `task_skip` (tasklist id · task id · condition expression), `hook_execute` (id · phase · action returned), `hook_side_effect_error` (id · error message), `hook_disabled` (id · consecutive failures), `hook_phase_mismatch` (id · action · phase), `fork_ask` (fork id · ui descriptor), `fork_ask_inject` (fork id), `fork_ask_timeout` (fork id), `function_load` (name · space · kind: function|class), `function_load_expand` (name · space · method count).
