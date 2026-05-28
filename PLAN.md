# REPL v2 — Implementation Plan (from scratch)

## Context

We are building an **LLM agent runtime** in which a language model drives a program by
*writing TypeScript*. The model streams TS statements; the host evaluates them one at a
time inside a sandbox. Certain built-in calls (e.g. asking the user a question, running a
task graph) suspend execution, hand control to the host, and resume the model on the next
turn with the resolved values injected back into context.

This is a clean-room rewrite. Implement everything described here in an **empty repo** — do
not assume any prior code. The goal is a *small, legible* runtime: no git-backed state, no
model router, no memory-compaction layer beyond a simple rolling summary.

The reference behaviour is captured concretely in the **Annotated Walkthrough** (§14). When
in doubt about a contract, that section is authoritative.

---

## 1. Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict), ESM, Node ≥ 20 |
| Sandbox | `quickjs-emscripten` (async WASM module) |
| Typecheck / parsing | `typescript` compiler API (`ts.createSourceFile`, `ts.createProgram`, `ts.transpileDeclaration`) |
| LLM streaming | Vercel AI SDK (`ai` package) — `streamText()` |
| YAML frontmatter | `yaml` (npm) — real parser (frontmatter has nested lists/objects) |
| Terminal UI | `ink` + `ink-text-input` (React-based) |
| Web transport | `ws` (WebSocket) |
| Web UI | `react` |
| Build | `tsup` per package |
| Tests | `vitest`; Playwright optional for web |

## 2. Repo layout — three packages

```
packages/
  core/   (@repl/core)   — runtime; no renderer, no provider, embeddable
    src/
      sandbox/    quickjs.ts host-bridge.ts boundary.ts jsx-runtime.ts trace.ts
      eval/       turn-loop.ts yield.ts error-rewind.ts
      typecheck/  tsc.ts overlay-dts.ts library-dts.ts
      globals/    ask.ts display.ts inspect.ts serialize.ts load-knowledge.ts sleep.ts
      spaces/     load.ts frontmatter.ts agent.ts tasklist-load.ts knowledge.ts components.ts
      tasklist/   dag.ts orchestrator.ts condition-dsl.ts schema.ts
      fork/       fork.ts
      delegate/   delegate.ts registry.ts
      context/    history.ts system-block.ts summarize.ts variables.ts
      session/    session.ts snapshot.ts types.ts
      index.ts
  cli/    (@repl/cli)   — providers, Ink terminal renderer, WS server, bin
    src/
      providers/  resolve.ts aliases.ts
      stream/     stream.ts            (streamText wrapper + abort)
      render/     ink-renderer.tsx html-to-terminal.ts
      rpc/        server.ts events.ts
      cli/        bin.ts args.ts
      index.ts
  ui/     (@repl/ui)    — React web component surface + client hook
    src/
      components/ (built-in view/form primitives)
      client/     rpc-client.ts useReplSession.ts
      index.ts
```

`core` is renderer/provider-agnostic: it emits **events** and accepts a **RenderHost**
interface (injected by `cli`). It never imports `ink`, `ws`, or `ai`.

---

## 3. Glossary / mental model

- **Turn**: one LLM generation. The model streams TS; the host evaluates statements as they
  arrive. A turn ends when a *value-yielding await* fires, an error caps out, or the model
  stops producing statements.
- **Value-yielding global**: one of `ask`, `inspect`, `loadKnowledge`, `sleep`, `tasklist`,
  `fork`, `delegate`. Awaiting one **aborts the LLM stream** and hands control to the host.
- **Void/host call**: any space function (e.g. `addIngredient`). Runs **inline**, even when
  `await`-ed — does **not** end the turn.
- **VARIABLES block**: a synthetic `user` message the host appends after a yield, carrying the
  resolved values so the next turn sees them.
- **Space**: a directory bundling `agents/ tasklists/ functions/ components/ knowledge/`.
- **Session**: a persistent QuickJS VM + message history for one agent. Forks and delegations
  spawn child sessions with their own VM.

### The turn loop (the heart of the system)

```
loop per turn:
  1. assemble context  -> system prompt + message history (§ context)
  2. stream tokens from the model
  3. feed tokens to BoundaryDetector -> complete statements
  4. for each complete statement:
       a. typecheck (incremental tsc, cached overlay + accumulated source)
          - on type error: error-rewind (do NOT append), end turn, retry
       b. evalCode(statement) in the VM
          - void/sync host calls resolve inline (executePendingJobs)
          - if a value-yielding global was invoked -> set pendingYield
       c. if pendingYield:
            - abort the LLM stream
            - process the yield(s) (§ globals): produce resolved value(s)
            - resolve the VM promise(s), executePendingJobs -> statement binds vars in scope
            - append VARIABLES block to history
            - break (turn ends)
          else: append statement to accumulated source, continue
       d. on runtime throw: error-rewind, end turn, retry
  5. if model produced statements but no pendingYield and no error -> agent is done
     (session/turn loop ends; §13 session end)
```

---

## 4. Phase 0 — scaffold

- pnpm workspace, three packages, shared root `tsconfig.base.json` (strict, ES2022,
  NodeNext, `jsx: react-jsx`).
- `tsup` build configs; `vitest` config at root.
- `core` exports a `Session` class and a `RenderHost` interface; `cli` provides a concrete
  `RenderHost` (Ink) and provider streaming; `ui` is the browser surface.

---

## 5. Phase 1 — sandbox (core/sandbox)

**`quickjs.ts`** — `createVM(opts)`:
- `newQuickJSAsyncWASMModule()` (singleton), `module.newRuntime()`, `runtime.newContext()`.
- Set memory limit + an `interruptHandler` that trips after `maxStatementMs` (per-statement
  CPU guard). Expose `evalStatement(code): Promise<EvalResult>`, `getScope()`, `setVar()`,
  `dispose()`.
- `evalStatement` calls `ctx.evalCode(code)` and drives `runtime.executePendingJobs()` until
  the resulting promise settles **or** a `pendingYield` is observed.

**`host-bridge.ts`** — marshalling:
- `marshalToQuickJS(ctx, value)`: primitives, arrays, objects, functions. For functions, wrap
  with `ctx.newFunction`. When a wrapped function returns a host `Promise`, create
  `ctx.newPromise()`, return its `.handle`, and on settle call `deferred.resolve/reject` +
  `ctx.runtime.executePendingJobs()`.
- `marshalToHost(ctx, handle)`: `ctx.dump(handle)`.
- `injectGlobal(ctx, name, fn)`: attach wrapped function to `ctx.global`.

**`boundary.ts`** — `BoundaryDetector`:
- `feed(chunk): string[]` accumulates a buffer and returns complete top-level statements.
- Detection: `ts.createSourceFile('_b.tsx', buf, ESNext, false, TSX)`. A leading statement is
  complete when (a) more than one statement parsed (first is complete), or (b) a single
  statement that ends in `;`/`}` **and** has no synthetic/missing tokens (walk for
  `NodeFlags.ThisNodeHasError` and zero-width tokens). Handles template literals, JSX, arrows,
  destructuring. `flush()` returns trailing partial text; `reset()` clears.

**`jsx-runtime.ts`** — inject a virtual JSX factory into the VM so JSX the model writes
produces plain descriptor objects `{ type, props, children }` (NOT React). Captured to host
via `marshalToHost`.

**`trace.ts`** — append-only JSONL writer `{ ts, type, ... }`; used for debugging/tests
(`session_start`, `statement`, `yield`, `error`, `turn_end`).

Tests: feed partial chunks → assert statement boundaries; await of a host promise resolves
inline; interrupt handler trips on infinite sync loop.

---

## 6. Phase 2 — typecheck + DTS (core/typecheck)

**`tsc.ts`** — `runTsc({ sessionContext, statement, ambientDts })`:
- Build a virtual `CompilerHost` over an in-memory `session.tsx` = `ambientDts` + accumulated
  `sessionContext` + the new `statement`, and a `lib.d.ts`. `ts.createProgram` with
  `strict, module: ESNext, jsx: ReactJSX, skipLibCheck: true`.
- Collect syntactic + semantic diagnostics; filter to the statement's line range; format with
  `ts.flattenDiagnosticMessageText`. Return `{ ok, diagnostics: [{line, col, code, message}] }`.
- "Incremental": cache the ambient+context program; only the trailing statement changes.

**`overlay-dts.ts`** — `buildOverlay(space, agent)`:
- For each `functions/*.ts` and `components/{view,form}/*.tsx` **in scope for the agent**,
  `ts.transpileDeclaration(source, {declaration:true, emitDeclarationOnly:true, jsx})`.
- `rewriteToAmbient`: strip imports; `export declare function` → `declare function`;
  `export interface` → `declare interface`; drop bare `export { ... }`.

**`library-dts.ts`** — a constant `.d.ts` declaring the always-injected globals with exact
signatures: `ask`, `display`, `inspect`, `loadKnowledge`, `sleep`, `tasklist`, `fork`,
`delegate`, and (inside tasklist forks only) `currentTask`. The full ambient overlay =
`LIBRARY_DTS + overlay`.

---

## 7. Phase 3 — value-yielding globals + serialization (core/globals, core/eval)

**`eval/yield.ts`** — the yield protocol:
- A module-level `pendingYields: YieldRequest[]` on the VM session. Each value-yielding global,
  when invoked in the VM, pushes a `YieldRequest { kind, args, deferred }` and returns
  `deferred.handle` (an unresolved VM promise). It does **not** resolve during the statement.
- After `evalStatement`, the turn loop checks `pendingYields`. If non-empty → abort stream,
  process each request, resolve its VM promise, `executePendingJobs`, then read back the
  statement's bound variables and emit VARIABLES.
- Void host functions never push a YieldRequest → they resolve inline.

**`globals/serialize.ts`** — capped JSON serializer (shared by inspect + VARIABLES):
- Depth cap + byte cap. Over-cap values → placeholder string
  `"[… N items|chars, truncated — inspect([var, { ... }]) to expand]"`.
- Renders strings (head + length), arrays (head slice + count), objects (key-limited), bytes.

**`globals/inspect.ts`** — `inspect(...vars | [var, query])`:
- Plain arg `inspect(v)`: serialize `v`. Query form `inspect([v, query])` where `query` is an
  object: `{ path?, slice?, depth?, filter?, sample?, keys?, count?, search? }`.
  - `path`: dotted path with array indices (`"contents.0"`, `"a.b"`).
  - `slice [start,end]`, `sample n`, `keys` (object keys only), `count` (length), `search term`
    (filter array of objects/strings), `filter "expr"` (small predicate over array items),
    `depth n`.
- Emits a VARIABLES block keyed by the arg's source text / path.

**`globals/load-knowledge.ts`** — `loadKnowledge(...path): Promise<unknown>`:
- Resolve `knowledge/<domain>/<field>/<option>.md` (or a field/domain node). Return parsed
  body (frontmatter + markdown, or structured value). Result injected as VARIABLES.

**`globals/sleep.ts`** — `sleep(duration)`:
- Parse a duration string (`"2min"`, `"500ms"`, `"1s"`). End the turn; schedule resume after
  the delay (configurable: real wall-clock, or a simulated clock injected for tests). Inject
  `VARIABLES(slept: "<duration>")`.

**`globals/display.ts`** — `display(descriptor)`:
- Fire-and-forget: push descriptor to the render surface via `RenderHost.display(desc)`.
  **Not** a yield (returns void). The statement continues.

**`globals/ask.ts`** — `ask(descriptor): Promise<T>`:
- A yield. Validate the descriptor with the JSX sanitizer (block `script/iframe/...`,
  `dangerouslySetInnerHTML`, `javascript:` URLs; only registered form components allowed in
  `ask`). Call `RenderHost.ask(id, desc)`; resolve when the surface submits
  `submitForm(id, value)`. Timeout (default 300s) → reject. Resolved value injected as
  VARIABLES under the bound variable name.

**VARIABLES emission** (`context/variables.ts`):
- After resuming, determine names to show: for `inspect`, the inspected args/paths; for
  `sleep`, `slept`; for the others, parse the statement's LHS binding identifiers (from the
  BoundaryDetector AST) and read them back from VM scope. Serialize via `serialize.ts`.

---

## 8. Phase 4 — spaces (core/spaces)

**`frontmatter.ts`** — split `---\n...\n---\nbody`; parse the YAML block with `yaml`.

**`load.ts`** — `loadSpace(dir): Space`:
- `agents/<slug>/instruct.md` (frontmatter: `title`, `actions[] {id,label,description,tasklist}`,
  `dependencies[] "space/agent"`) + `config.json` (`knowledge`, `functions[]`, `components[]`).
- `tasklists/<slug>/` → sorted numbered `.md` files → task nodes (§9).
- `functions/*.ts` → source strings; transpiled + imported on demand into the VM (rewrite ESM
  `import` → host `require` registry; eval in VM to bind the global). Only functions listed in
  the active agent's `config.json.functions` are injected.
- `components/view/*.tsx` (web-only) and `components/form/*.tsx` (must export a web variant and
  an `*.ink.tsx` terminal variant).
- `knowledge/<domain>/config.json`, `<field>/config.json` (`type`, `variableName`, `default`),
  `<option>.md`. Build the tree; values loaded lazily by `loadKnowledge`.
- Validate: ≥1 agent; every `action.tasklist` resolves to a tasklist dir; every
  `config.functions` entry has a file; dependency strings are `space/agent`.

---

## 9. Phase 5 — provider streaming + system block + turn loop wiring

**cli/providers** — `resolveModel("provider:modelId")` (lazy-load `@ai-sdk/*`); aliases via
`process.env["LM_MODEL_" + ALIAS]`. One model alias per session (no router); forks/delegates
inherit unless overridden.

**cli/stream/stream.ts** — wrap `streamText({ model, system, prompt })`; iterate
`stream.textStream`; expose an `abort()` (AbortController) the turn loop calls on yield/error.

**core/context/system-block.ts** — generate the `system` content at session start:
- Always-injected globals summary; the active agent's `instruct.md` **body**; its actions
  (`id → tasklist — description`); scoped functions/knowledge-tree/components; **direct**
  dependency agents with their action summaries (deeper deps lazy).

**core/context/history.ts** — message log of `{role, content}` blocks: the system block, user
turns, assistant turns (the accumulated TS source per turn), and synthetic `user` VARIABLES /
ERROR blocks. The per-turn prompt = system + serialized history.

**core/eval/turn-loop.ts** — implement §3 exactly. Wire BoundaryDetector → tsc → evalStatement
→ yield handling → VARIABLES. Abort the provider stream when a yield fires.

**core/eval/error-rewind.ts** — on type error or runtime throw:
- Do **not** append the failing statement to accumulated source (rewind to last successful
  line). Append an `ERROR (attempt k of 3)` user block: the failing line commented out + the
  diagnostic/throw message. Abort stream; the next turn regenerates from there. After 3
  attempts on the same line, end the turn and surface the error to the user (top-level) or
  reject to the caller (fork/delegate).

---

## 10. Phase 6 — context summarization + persistence (core/context, core/session)

**`summarize.ts`** — when the assembled prompt nears the model's context window, collapse the
oldest assistant/VARIABLES blocks into one compact summary block (an LLM call with a fixed
"summarize prior state" prompt, or a deterministic digest of variable names + outcomes). Keep
recent turns verbatim.

**`session/snapshot.ts`** — every N turns, serialize JSON-serializable VM scope + message
history to disk (`<sessionDir>/snapshot.json`). `resume(dir)`: recreate the VM, re-inject saved
scope vars, restore history. (Closures/functions in scope are not preserved — acceptable; scope
holds data.) This is the only persistence; **no git**.

---

## 11. Phase 7 — tasklist + fork (core/tasklist, core/fork)

**`tasklist/dag.ts`** — load a tasklist dir into `{ [id]: TaskNode }` where
`TaskNode { id, instruction(body), output(schema), dependsOn?, condition?, optional?, goal? }`.
Sort files by numeric prefix for display. Validate DAG (no cycles; exactly one `goal: true`).

**`tasklist/schema.ts`** — tiny JSON-schema-ish validator for task `output` objects
(`{ field: "string"|"number"|"boolean"|"object"|"array" }`). Reject resolve() with wrong shape.

**`tasklist/condition-dsl.ts`** — parse + evaluate the restricted DSL:
`<dotted.path> <op> <literal>` joined by `AND`/`OR`; ops `== != > < >= <=`. Evaluate against
the accumulated outputs object `{ taskId: output }`. No raw JS eval.

**`fork/fork.ts`** — `ForkEngine.fork<T>({ instruction, output, seed, timeout }): Promise<T>`:
- Create a **fresh VM** seeded with JSON-serializable copies of the given parent scope vars.
- Run a child turn loop with: history up to the fork point + a task `user` message
  (instruction + output schema + any upstream inputs). Inject a VM global
  `currentTask.resolve(value)` that validates against `output`, ends the child stream, and
  settles the fork promise. Only JSON-serializable values cross back; **no scope merge**.
- Timeout → reject. Concurrency capped (`maxConcurrentForks`, default 8).

**`tasklist/orchestrator.ts`** — `tasklist(name)` (a yield):
- Load DAG; enter tasklist mode. Repeatedly: find tasks whose deps are all `done` and whose
  `condition` (if any) passes; spawn each as a `fork` (parallel, within the cap). For a
  dependent task, pass upstream outputs **both** as namespaced `__task_<id>` seed vars **and**
  as an "Inputs:" summary in its task message. `optional` task failure → mark skipped, don't
  block; required failure → abort the tasklist, reject. When the `goal` task resolves, settle
  the `tasklist()` promise with its output → VARIABLES in the parent → parent resumes.

The LLM never writes fork orchestration — the host does it (the model only sees individual
fork task turns and, in the parent, the final goal VARIABLES).

---

## 12. Phase 8 — delegate (core/delegate)

**`registry.ts`** — resolve `"space/agent"` to a loaded space+agent. **Eager-load direct
dependencies** of the session's agent at startup; resolve deeper levels lazily on first
`delegate`. Detect dependency **cycles** and reject.

**`delegate.ts`** — `delegate(target, queryOrAction, opts?)` (a yield), two forms:
- Mode 1: `delegate("space/agent", { query, context, output })` — child picks one of its
  actions, runs that action's tasklist, and its goal output is **coerced to `output`**.
- Mode 2: `delegate("space/agent", "action_id", { query, context })` — run that action's
  tasklist; result = its goal output.
- The child is a fresh session (own VM + system block for *its* space/agent). It receives
  **only** the passed `context` (no parent history). Runs to completion (its goal). Result
  injected into the parent as VARIABLES.
- Enforce **caps across the whole tree**: max delegation depth (default 5), shared
  `maxConcurrentForks`, optional total token budget. Exceeding any → reject with an error the
  parent LLM sees.

`fork` and `delegate` are **separate implementations** (do not unify into one engine).

---

## 13. Phase 9 — Ink terminal renderer (cli/render) + session end

**`ink-renderer.tsx`** — a `RenderHost` implementation:
- `display(desc)`: render the descriptor tree to Ink components (`p/span/Markdown` → `<Text>`,
  `h1..3` → bold, `Card/Alert` → bordered `<Box>`, `Code` → gray, `Button/Badge` → colored).
- `ask(id, desc)`: render an interactive form (`ink-text-input`, selects) for `form`
  components; resolve via the submitted value.
- `html-to-terminal.ts`: for `view` components (web-only), convert their HTML/descriptor output
  to terminal text.

**Session end (§ no sink)**: the turn loop ends a session when a turn produces statements but
**no pending yield and no error** — nothing to resume, so the agent is done. Top-level: print
final `display` output. Delegated/fork: the result is the invoked action's tasklist goal output
(mode 1: coerced to the requested schema).

---

## 14. Phase 10 — web surface (cli/rpc + ui)

**cli/rpc/server.ts** — `ws` server exposing the session: client → `sendMessage`,
`submitForm(id, value)`, `cancelAsk(id)`; server → events `snapshot`, `display`, `ask_start`,
`ask_end`, `variables`, `error`, `done`. The `RenderHost` for web emits these events instead of
drawing to a terminal; `submitForm` resolves the same `ask` promise.

**ui** — React `useReplSession(url)` hook (WebSocket); a blocks reducer renders the event stream;
built-in `view`/`form` web components mirror the terminal primitives. Form submit posts back
`submitForm`. Shares the **same descriptor + event contract** as the terminal so both surfaces
are interchangeable.

---

## 15. The annotated walkthrough (authoritative behaviour)

Build two fixture spaces and make this transcript work end-to-end in the terminal:

- Space `cooking`, agent `chef`: functions `addIngredient/putPotOnHeat/getPotTemperature/
  checkPot`; form components `SaltinessSlider/ConfirmDish`; view `PotStatus`; tasklist
  `make_pasta` = `boil_water`,`make_sauce` (no deps) → `cook_pasta`(deps boil_water) →
  `drain_pasta` → `combine`(goal, deps cook_pasta+make_sauce) → `garnish`(optional, condition).
  Agent action `cook_pasta → make_pasta`. Dependency `sommelier/pairing`.
- Space `sommelier`, agent `pairing`: actions `suggest_pairing`, `check_cellar`.

Behaviours to reproduce exactly:
1. System block lists globals + chef `instruct.md` body + actions + scoped fns/knowledge +
   direct dep `sommelier/pairing` actions.
2. `const approach = await ask(<ConfirmDish/>)` → stream aborts → `VARIABLES(approach: {...})`.
3. `const dish = await tasklist("make_pasta")` → host forks `boil_water` + `make_sauce` in
   parallel; LLM never writes the fork code.
4. In a fork: `Promise.all([loadKnowledge(...), loadKnowledge(...), ask(...)])` → one abort →
   one VARIABLES block with all three.
5. `addIngredient(...); putPotOnHeat(...); await sleep("2min")` → void calls inline; `sleep`
   ends the turn; `VARIABLES(slept)`.
6. Poll: `getPotTemperature` + `await inspect(temp)` → turn ends; `await sleep("1min")`;
   re-check; `currentTask.resolve({...})`.
7. Dependent `cook_pasta` fork sees `__task_boil_water` in scope **and** an "Inputs:" summary.
8. A typo statement → ERROR block (failing line commented + tsc message), prior successful
   statement retained; regenerate; 3-strike cap.
9. `inspect(log)` truncates a big array → re-query with `inspect([log, { path, slice }])`.
10. Goal resolves → `VARIABLES(dish: {...})` in the parent.
11. `delegate("sommelier/pairing", { query, context, output })` (mode 1) and
    `delegate("sommelier/pairing", "check_cellar", {...})` (mode 2) → child runs with only the
    passed context; result injected as VARIABLES.
12. Final `display(<PotStatus/>)` with no yield → session ends.

---

## 16. Critical files to implement first (dependency order)

1. `core/sandbox/{quickjs,host-bridge,boundary}.ts` — without these nothing runs.
2. `core/eval/yield.ts` + `core/eval/turn-loop.ts` — the loop and yield protocol.
3. `core/typecheck/{tsc,library-dts,overlay-dts}.ts`.
4. `core/globals/*` + `core/context/variables.ts`.
5. `core/spaces/*`.
6. `cli/providers/*` + `cli/stream/stream.ts` + `core/context/system-block.ts` → first
   end-to-end ask loop in the terminal.
7. `core/tasklist/*` + `core/fork/fork.ts`.
8. `core/delegate/*`.
9. `cli/render/*` (Ink) → finish terminal surface.
10. `cli/rpc/*` + `ui/*` → web surface.

---

## 17. Verification

- **Unit (vitest)** co-located per module: BoundaryDetector statement splitting; host-bridge
  async marshalling; tsc diagnostics + 3-strike rewind; serialize truncation + each `inspect`
  query op; condition-DSL evaluator; DAG validation + ordering; fork JSON boundary + timeout;
  delegate cap + cycle detection.
- **Yield protocol** test: a statement with a void `await` runs inline (no turn end); a
  statement with `await ask(...)` ends the turn and emits VARIABLES.
- **End-to-end (terminal)**: run the `cooking` space with a `MockLanguageModel` that emits the
  §15 statements; assert the full transcript (VARIABLES, ERROR rewind, tasklist forks, delegate,
  session end). Provide a mock clock so `sleep` is instant in tests.
- **Web**: a WS integration test (or Playwright) that drives the same mock session: `ask_start`
  → `submitForm` → `ask_end`; `display` events render.
- **Build/typecheck**: `pnpm -r build` and `pnpm -r typecheck` clean; `pnpm -r test` green.
- **Manual smoke**: `repl --space ./fixtures/cooking "make pasta and suggest a wine"` against a
  real model alias; confirm the agent confirms, runs the tasklist, delegates, and ends.
