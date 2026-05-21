# Implementation Plan — `llm-repl` v4.3

## Context

`sdk/org/NEW_ARCHITECTURE.md` (spec v4.3 — currently only on `origin/main` at commit `e17d60f`; the submodule HEAD in this repo is `38e26ce` (v4) and must be advanced as the first step) defines a ground-up redesign of the streaming TypeScript REPL agent.

The current `sdk/org/repl/` + `sdk/org/cli/` implementation uses `vm.Context`, esbuild transpilation, and an in-memory session — it cannot run in the browser, has no per-yield git history, no speculative execution for top-level `await`, no QuickJS isolation, and no orchestration router. The new design replaces the sandbox with **QuickJS WASM**, makes **git central at yield points** (every `inspect()` commits; `heap.bin` is the rollback source), introduces **speculative execution** during top-level `await`, **captures top-level function/class declarations into a per-session space** (never written to `session.ts`), organizes everything into **11 capability layers** (`lib/sandbox` … `lib/spaces`, L0–L10), and adds a **two-point router** (`new_message`, `post_inspect`) that selects role/model/adapter per cycle.

Per user direction:

- **Scope:** Full L0–L10 roadmap, each layer a milestone with deliverables and exit criteria.
- **Repo strategy:** New packages `sdk/org/llm-repl/` and `sdk/org/llm-repl-cli/` alongside existing `repl/` and `cli/`. Existing packages stay running until the new stack reaches parity; consumers migrate per-PR. Final cutover deletes `repl/` and `cli/`.

The spec's "Reuse" section (NEW_ARCHITECTURE.md L200–234) maps which existing modules carry over as-is (spaces loader, knowledge tree + decay tiers, hook registry, provider resolver, JSX sanitizer, RPC server, CLI args, catalog logic), which adapt (statement detector, stream controller, prompt builder, scope generator, agent loop, snapshot), and which are net-new (QuickJS sandbox, tsc-strict pipeline, central git, trace.jsonl, speculative buffer, capture rule, context reconstruction, Ink renderer). This plan honors that mapping — we port carry-overs early in Phase 0 and only rewrite where v4.3 mandates it.

---

## Repository Layout (target)

```
sdk/org/
├── repl/              # existing — kept running until parity, deleted in Phase 13
├── cli/               # existing — kept running until parity, deleted in Phase 13
├── llm-repl/          # NEW — core runtime (no CLI, no renderer)
│   src/
│   ├── lib/{sandbox,typecheck,inspect,checkpoint,fork,memory,
│   │       tasklist,io,render,snapshot,spaces}/
│   ├── session/  context/  hooks/  knowledge/  catalog/  security/
│   └── index.ts
└── llm-repl-cli/      # NEW — CLI binary + browser server
    src/
    └── providers/  router/  cli/  rpc/  ink/  web/
```

Each `lib/<name>/` is self-contained per the spec's discoverability rule (L181–196):

```
index.ts · <name>.test.ts · eval/{dataset.jsonl, grade.ts, prompts/{xs,s,m,m_r,l,l_r}.md}
```

---

## Dependency Shape

```mermaid
graph TD
    P0[Phase 0<br/>Scaffolding + carry-overs] --> L0[L0: sandbox<br/>QuickJS · boundary · capture · trace · file-blocks]
    L0 --> L1[L1: typecheck<br/>tsc strict · retry · speculative · annotation grace]
    L1 --> L2[L2: inspect<br/>inspect() · session assembly · context reconstruction]
    L2 --> L3[L3: checkpoint<br/>checkpoint() · rollback() · settle-on-checkpoint]
    L2 --> L4[L4: fork<br/>fork() · resolve() · parent-routed ask · branch seed]
    L3 --> L5[L5: memory<br/>pin · compact · expand · auto-compact]
    L4 --> L5
    L5 --> L6[L6: tasklist<br/>DAG enforcement · outputSchema · nudge]
    L6 --> L7[L7: io<br/>fetch allowlist · fs sandbox · require]
    L7 --> L8[L8: render<br/>display · ask · descriptors + Ink/web]
    L8 --> L9[L9: snapshot<br/>baseSnapshot reuse · skip path]
    L9 --> L10[L10: spaces<br/>Space class · .d.ts overlay · loader reload]
    L10 --> R[Phase 12: router<br/>ANALYZER · routing rules · context flags]
    R --> CUT[Phase 13: CLI cutover<br/>llm-repl run · WS bridge · consumer migration]
    L8 -.shares.- INK[llm-repl-cli/ink + web<br/>descriptor renderers]
```

The branch on L2 → {L3, L4} is real: checkpoint and fork are independent capabilities once inspect+session exist. They serialise back at L5 because pin/compact references state shapes only stable after both land.

---

## Phasing Principles

1. **Layer-ordered build (L0 → L10).** Each phase compiles + ships its own eval suite before the next starts (spec §"Discoverability").
2. **Vertical green-bar per phase.** Every phase ends with: unit tests pass · `pnpm eval --lib <name> --model <min-class>` runs end-to-end against a real provider · the `trace.jsonl` events specified for that layer are asserted present · eval prompts embed the static REPL system prompt and layer-relevant API types; grader user turns use context reconstruction format.
3. **Carry-overs land first, in `llm-repl/src/`** as plain ports (no behavior change). New stage strings (`before-tsc`, `on-function-capture`) are added to the hook phase enum but unwired until L0/L1 land.
4. **Existing `repl/` and `cli/` are not modified** until Phase 13. Consumers (Studio, Computer, Chat) keep working throughout.

### Eval prerequisites — env setup

The Azure credentials and all model aliases are already configured in `.env` at the repo root. For reference:

```
# Provider credentials
AZURE_API_KEY=<key>
AZURE_RESOURCE_NAME=<resource>

# Model aliases — map eval model classes to deployed provider:modelId
LM_MODEL_XS=azure:claude-haiku-4-5       # 1–3B class
LM_MODEL_S=azure:gpt-4.1-mini            # 7–14B class
LM_MODEL_M=azure:claude-sonnet-4-6       # 30–70B class
LM_MODEL_M_R=azure:DeepSeek-R1-0528      # 30–70B + reasoning
LM_MODEL_L=azure:gpt-5.5                 # frontier class
LM_MODEL_L_R=azure:Kimi-K2.6             # frontier + reasoning
```

The eval runner accepts `--model <ALIAS>` directly — `XS | S | M | M_R | L | L_R` — and resolves to the corresponding `LM_MODEL_<ALIAS>` env var. Any missing alias causes the grader to skip with a warning rather than hard-fail, so partial env setups are safe for iterating on a single layer.

---

## Phase 0 — Submodule bump + scaffolding + carry-overs

**Goal:** new packages compile, share-able pure modules are ported at parity, CI runs.

1. **Bump submodule pointer.** `git -C sdk/org checkout main` (= `e17d60f`) and commit the new submodule SHA in the parent repo on `claude/refine-local-plan-XxZ3d`. Required because the draft plan and every subsequent phase reference v4.3 specifics (router, capture rule, annotation grace, `lib/` layout, full trace event list at NEW_ARCHITECTURE.md L2006) that don't exist on the current submodule HEAD.
2. **Create new workspaces:** `sdk/org/llm-repl/{package.json,tsconfig.json,vitest.config.ts}` and `sdk/org/llm-repl-cli/{package.json,tsconfig.json,vitest.config.ts}`. Add both to `sdk/org/pnpm-workspace.yaml` (currently only lists `cli` and `repl`). Parent `pnpm-workspace.yaml` picks them up automatically via `sdk/org/*`.
3. **Port as-is** (plain copies, no behavior change — match parity tests one-for-one):
   - `repl/src/knowledge/` → `llm-repl/src/knowledge/`
   - `repl/src/context/knowledge-decay.ts`, `stop-decay.ts` → `llm-repl/src/context/`
   - `repl/src/hooks/` → `llm-repl/src/hooks/` — extend `HookPhase` union with `'before-tsc'` and `'on-function-capture'` per spec L1312 but keep them unwired
   - `repl/src/security/jsx-sanitizer.ts` → `llm-repl/src/security/`
   - `cli/src/providers/` → `llm-repl-cli/src/providers/` (Vercel AI SDK v6 stays, env-var alias resolution stays — spec L209)
   - `cli/src/rpc/` + `cli/src/cli/server.ts` → `llm-repl-cli/src/rpc/` (skeleton — message types may extend in Phase 13)
   - `cli/src/cli/args.ts` → `llm-repl-cli/src/cli/args.ts`
   - `cli/src/cli/agent-loader.ts` + `repl/src/spaces/dynamic-loader.ts` → `llm-repl/src/lib/spaces/loader.ts` (skeleton only — full `Space` class lands in L10)
4. **Eval runner stub:** `llm-repl/scripts/eval.ts` — invokes per-lib `grade.ts` based on `--lib <name>` and `--model <ALIAS>` args (`XS | S | M | M_R | L | L_R`). No-op when no `grade.ts` exists yet. Resolves alias to `LM_MODEL_<ALIAS>` env var.
5. **`llm-repl.d.ts` canonical surface** — drop in the API block from spec L375–999 as the authoritative `.d.ts`. Each layer fills in the runtime behind these declarations.

**Exit:** `pnpm -F llm-repl build` and `pnpm -F llm-repl-cli build` succeed; ported module tests pass without modification.

---

## Phase 1 — L0: `lib/sandbox`

**Goal:** QuickJS isolate executing one statement at a time, TypeScript scanner-based boundary detection, the capture rule, four-backtick file blocks, `trace.jsonl`. No tsc yet, no `inspect()`.

Deliverables under `llm-repl/src/lib/sandbox/`:

- `quickjs.ts` — `getQuickJS()` singleton; one `newAsyncContext()` per session with `runtime.setMemoryLimit(SessionConfig.maxHeapMB * 1024 * 1024)`, `setMaxStackSize(maxStackSizeMb)`, interrupt-handler-driven CPU timeouts. `executePendingJobs()` after each statement.
- `boundary.ts` — `ts.createScanner()`-based incremental tokenizer; depth-0 semicolon detection; correct handling of JSX, generics, type assertions, regex, comment-in-string. Adapts `repl/src/parser/statement-detector.ts` + `repl/src/stream/bracket-tracker.ts` from heuristic bracket-matching to scanner-API.
- `capture.ts` — implements the **Capture Rule** exactly as spec §"Capture rule" (L1238–1275):
  - `FunctionDeclaration` / `ClassDeclaration` with identifier name → capture
  - `VariableStatement` requires `NodeFlags.Const` + single declarator + `Identifier` name + initializer kind ∈ {`ArrowFunction`, `FunctionExpression`, `ClassExpression`} → capture
  - **Component classification:** return-type structural assignment to `JSX.Element` → component; props with callable `submit` → form, else view; untyped props default to view
  - **Source fidelity:** verbatim original source written to target file, no AST re-emission
  - **Re-declaration block:** `kind: "contract"` error if name exists in session space
  - Negative cases (each gets a unit test): `let f = () => {}` with hint comment, multi-declarator, destructuring, `CallExpression` init (incl. HOC `memo(...)`), `ObjectLiteralExpression` method shorthand, IIFE
- `file-blocks.ts` — four-backtick fence intercept ahead of the scanner. Adapts existing `repl/src/stream/file-block-applier.ts` and read-ledger from `repl/src/sandbox/read-ledger.ts`. Diff blocks fail with `kind: "contract"` if the target path was not read via `fs.readFile()` in the current cycle (spec contract L1866).
- `trace.ts` — `trace.jsonl` writer with `O_APPEND + fsync` per event (spec L1377, L2004). Replay logic for uncommitted suffix on host restart: find last committed git ref, read suffix, replay events into in-memory state. Event schema is the canonical list at spec L2006.
- `host-bridge.ts` — handle-marshaling pattern for host functions injected as globals. JSX descriptor marshaling (numeric handle IDs for callbacks). Virtual `react/jsx-runtime` module returning host functions that build descriptor trees — React itself never loaded inside QuickJS.
- `require.ts` — host module registry. tsc transformer that rewrites `import x from 'pkg'` → `const x = require('pkg')` pre-emit. Ambient `.d.ts` declarations auto-generated for every entry in `SessionConfig.availableModules`.
- **Eval** `eval/dataset.jsonl` ~30 traces covering capture-rule edges (all positive + negative cases above), file-block writes/diffs (with and without prior read), JSX inside template literals; `eval/grade.ts` LLM-judge scoring **error rate**. Prompts for all six model aliases (`xs.md`, `s.md`, `m.md`, `m_r.md`, `l.md`, `l_r.md`). Each prompt embeds the verbatim static REPL system prompt, layer-0 API declarations, and sandbox-layer contracts (Capture Rule, No-redeclaration, File-block read-before-diff). `grade.ts` formats user turns as context reconstruction (`__budget`, `__scope`, `// User:` task comment).

**Exit:** unit tests cover every Capture Rule clause (positive + negative). `pnpm eval --lib sandbox --model XS` emits a baseline error-rate score. `trace.jsonl` contains `session_start`, `statement_received`, `function_captured`, `function_redeclare_blocked`, `execute`, `file_write`, `file_diff`, `file_diff_no_read`, `runtime_error`, `timeout`, `oom`.

---

## Phase 2 — L1: `lib/typecheck`

**Goal:** tsc strict on every statement, type-inference feedback, 3-retry-on-error loop, speculative execution scaffolding.

Deliverables under `llm-repl/src/lib/typecheck/`:

- `tsc-runner.ts` — tsc strict, in-memory program per statement; target `ES2022`, module `ESNext`, `jsx: "react-jsx"`, top-level await preserved. Returns diagnostics + transpiled JS + inferred types of new bindings.
- `retry.ts` — 3-retry loop. Errors injected as `// tsc: <msg>` comments. Append to `session.ts` only after success (spec contract "Append timing" L1850).
- `speculative.ts` — buffer for statements emitted while a top-level `await` is in flight. Per-statement structural type-check against the annotated awaited type; structural assignability check on `Promise.resolve`. Mismatch path: discard buffer, auto-inject `inspect(__resolved)`, build `__speculative_nudge` with derived shape (spec L1500–1514). Overflow path: `speculative.maxTokens` hit → abort LLM stream, hold buffer, build `__speculative_pending`. Nested buffer stacking for nested `await` (each await opens its own buffer; mismatch only discards the innermost).
- `annotation-grace.ts` — **first-omission grace per session** (spec contract L1861). On the first non-inferable await without `as Type`, disable speculative checking for that buffer; derive a JSON-Schema-ish shape on resolve; inject hint; flip `meta.json.annotation_grace_used = true`. Subsequent omissions are `kind: "type"` errors.
- Trace events added: `type_check_pass/fail`, `type_inferred`, `speculative_buffer_start`, `speculative_type_check_pass/fail`, `speculative_buffer_overflow`, `speculative_execute`, `speculative_type_mismatch`, `speculative_aborted`, `annotation_missing_grace`, `annotation_missing_error`.
- **Eval focus:** self-correction rate. Dataset includes type-error→retry→fix traces and annotation-mismatch traces. Prompts embed the verbatim static REPL system prompt, layer-0/1 API declarations, and typecheck-layer contracts (Speculative annotation, Annotation grace, Mismatch escalation, Append timing). `grade.ts` formats user turns as context reconstruction with `__errors: SessionError[]` for self-correction cases.

**Exit:** type-error retry closes within 3 attempts on the eval set; speculative tests cover correct annotation, wrong annotation (mismatch yield), buffer overflow, nested await.

---

## Phase 3 — L2: `lib/inspect` + Session Assembly

**Goal:** the central yield primitive — `inspect()` aborts the LLM stream, awaits only the Promises passed as args (soft `timeout`), commits to git, derives `scope.json` / `heap.bin` / `meta.json`, and reconstructs context.

Deliverables:

- `llm-repl/src/lib/inspect/index.ts` — `inspect(...args).options({ timeout })`; argument shape `unknown | [unknown, InspectQuery]`; argument names recovered via source AST (port logic from `repl/src/parser/ast-utils.ts`); restricted `filter` grammar parser host-side, walked inside QuickJS via handle API (no marshaling of arbitrary functions).
- `llm-repl/src/lib/inspect/budget.ts` — `Budget` interface, sync `budget()` (no yield), `wastedOnAbort` tracking.
- `llm-repl/src/session/` — assembles git repo at `session-{id}/`; writes `session.ts` (value-producing statements **only** — captured declarations skip), `scope.json` (lossy JSON view), `heap.bin` (QuickJS scope snapshot — primitives, plain objects, arrays, Sets, Maps; **orphan placeholders** for custom class instances per spec L1409), `meta.json` (budget, tasks, pins, errors, `annotation_grace_used`). All four files committed atomically per the "Commit atomicity" contract.
- `llm-repl/src/context/reconstruction.ts` — priority-ordered sections per spec §"Context Reconstruction" (L1421–1547):
  - **Hard-pinned** (L1437): `__budget`, `__tasklist_nudge`, `__currentStep`, `__speculative_nudge`, `__speculative_pending`, `__fork_asks`
  - **Priority-ordered** (L1446): `__scope` → `__errors` (last 3) → expanded vars → source tail → `__tasks` → `__forks` → `__display` → `__git` → type feedback
  - Auto-compact under pressure: largest non-pinned vars, depth-1, omit-3-cycles-unused
  - Output is a single `role: "user"` message replacing the prior reconstruction; no assistant history retained (spec L1428–1433)
  - Scope generator adapts `repl/src/context/scope-generator.ts` — same serialization logic, now writes both `scope.json` (disk) and `__scope` (context section)
- Trace events added: `inspect`, `inspect_settle`, `context_reconstruct`, `budget_check`, plus the full list under "Eval focus" below.

**Exit:** end-to-end smoke — LLM streams TS → boundary detector → tsc → QuickJS → `inspect()` → git commit → reconstruction → new completion. `pnpm eval --lib inspect --model S` measures **inspect frequency** and **dead-code-after-inspect rate** (must be 0). Snapshot round-trips via `heap.bin`.

---

## Phase 4 — L3: `lib/checkpoint`

**Goal:** named savepoints and rewinds.

Deliverables under `llm-repl/src/lib/checkpoint/`:

- `checkpoint(label)` — `cp-{label}` git tag + heap.bin snapshot. Does **not** yield. **Auto-settles every pending Promise in scope** before committing (each respects its own logical timeout — `ask` = 5min, fetch via AbortSignal); timeouts recorded as `kind: "timeout"` rejection. Emits `checkpoint_settle_wait` trace event.
- `rollback(target)` — by label OR by N statements. Spec §"Rollback" (L1573–1582): `git reset --hard` on the session repo; **all artifacts** revert (session.ts, scope.json, heap.bin, meta.json, entire `space/` tree). Fresh QuickJS context deserialized from restored heap.bin; session-space functions/classes re-bridged. Pins after target ref dropped. `RollbackBlockedError` if past the last valid snapshot (when a prior commit skipped `heap.bin` due to >64MB size). Returns count of statements rewound.
- Count-mode `rollback(N)` walks `trace.jsonl` back N `execute` events (skipping `function_captured` events, per spec "Statement/trace alignment" contract L1854).

**Exit:** rollback tests cover orphan placeholders (class instances become `OrphanedInstance` on method call after rollback restore — spec L1409); checkpoint auto-settle covers ask + fetch + fork-timeout cases. `pnpm eval --lib checkpoint --model S` measures **checkpoint quality / rollback success rate**.

---

## Phase 5 — L4: `lib/fork`

**Goal:** parallel completions in fresh QuickJS contexts, on git branches.

Deliverables under `llm-repl/src/lib/fork/`:

- `fork({ instruction, exclude, tokenBudget, warnAt })` returning `ForkHandle<T> extends Promise<ForkResult<T>>` with `inject(answer)` for routing parent-surface `ask()` responses back into the fork.
- Branch `fork/{id}` seeded from parent `heap.bin` minus `exclude`. Session-space functions re-injected as host-bridged globals in the child.
- `resolve<T>(value)` global available **in forks only** — absent from main session `.d.ts`.
- **Fork token budget** counts against parent `tokensRemaining` in real time (spec contract L1856). `Budget.nearingLimit = true` and `// ⚠ Budget warning: ...` injected at `warnAt` (default 20% of `tokenBudget`, min 500). Fork kills with `BudgetExceeded` if cap exhausted before `resolve()`.
- **Fork-scoped display slot** keyed by fork id (spec L1567), separate from parent surface.
- **Fork `ask()` routes to parent surface** (spec L1561): fork's `.d.ts` replaces generic `ask<T>` with `Promise<string>`-returning form; UI renders in parent slot labelled by fork id; resolves on `forkHandle.inject(answer)` or 5-minute timeout (uses fallback if provided, else rejects with `TimeoutError`). `__fork_asks` hard-pinned section injected in parent reconstruction while any such ask is pending.
- Trace events: `fork_spawn/resolve/reject`, `fork_budget_warning`, `fork_ask`, `fork_ask_inject`, `fork_ask_timeout`.

**Exit:** parent + 2 concurrent forks complete; budget warning injected at threshold; nested `fork()` rejected (absent from fork `.d.ts` — tsc compile-time enforcement, spec L1555). `pnpm eval --lib fork --model S` measures fork success rate and budget overrun rate.

---

## Phase 6 — L5: `lib/memory`

`pin/unpin`, `compact/expand` (orchestrator-chosen strategy from `'schema' | 'sample' | 'summary' | 'hash'`), dotted-path support (`__knowledge.grading.level`), auto-compact under context pressure (spec L1458). **Eval focus:** proactive-vs-auto compact ratio. Min alias: M (`pnpm eval --lib memory --model M`).

---

## Phase 7 — L6: `lib/tasklist`

`tasklist(id, dag)` returning `TasklistHandle`. DAG enforcement at host bridge (`start(id)` on un-`done` deps → `kind: "contract"` error; scope clean — spec L1287). `condition` expression parsed by the same restricted grammar as `InspectQuery.filter`, evaluated inside QuickJS via handle walk; falsy → `"skipped"` and dependents unblocked. `optional: true` failures unblock dependents (spec contract L1864). `outputSchema` JSON-Schema validated on `finish(id)` against the runtime variable named after the step id. `__tasklist_nudge` injected on every `inspect()` when any tasklist has unfinished nodes. **Eval focus:** DAG scheduling correctness. Min alias: M (`pnpm eval --lib tasklist --model M`).

---

## Phase 8 — L7: `lib/io`

`fetch(url, init)` with domain allowlist (`PermissionError` outside list), pre-buffered response body up to `maxFetchResponseBytes`, `.text/.json/.bytes` sync getters from buffer, AbortSignal timeouts. `fs.*` sandboxed to `/session/{id}/files/` (side effects **not** undone by rollback — spec L1581). `require(module)` whitelisted npm packages with auto-generated ambient `.d.ts` (mechanism from L0's `require.ts`, list-driven from `SessionConfig.availableModules`). **Eval focus:** end-to-end task completion. Min alias: S (`pnpm eval --lib io --model S`).

---

## Phase 9 — L8: `lib/render` + Ink + Web

**Goal:** `display()` and `ask()` plus the two renderer adapters.

Under `llm-repl/src/lib/render/`:

- `display(ui, { id, mode })` — non-blocking; descriptor tree marshaled out via host bridge; stable-id replace; `__display` bounded by `display.maxEntries` / `display.maxTokens`. On `rollback()`, emits `display_invalidate(cutoffIndex)`; stable-id elements before cutoff retain last pre-cutoff state (spec L1589).
- `ask<T>(ui, { timeout, fallback })` — returns `Promise<T>` resolved when the renderer calls the bridged `submit` callback handle; 5-min logical timeout independent of `inspect()` soft cap (spec L1593); session-end policy resolves with `fallback` or rejects `SessionEnded`.
- Built-in components registered as descriptor types resolved by host renderer: `TextInput`, `Select`, `Confirm`, `Table`, `ProgressBar`, `Markdown`, `CodeBlock`.
- Virtual `react/jsx-runtime` host module returning descriptor builders. tsc emits `jsx` calls; require transformer rewires them to the host module.

Under `llm-repl-cli/src/ink/` and `llm-repl-cli/src/web/`: descriptor → Ink (terminal) and descriptor → React (browser). Both share built-ins plus space-provided components from L10. Components from `cli/src/components/{display,form}/` port over unchanged; the form-extractor pattern (`cli/src/components/shared/form-extractor.ts`) drives the descriptor→`submit` bridge.

**Eval focus:** clarification quality (ask) and render correctness (display).

---

## Phase 10 — L9: `lib/snapshot`

Base snapshots — cross-session scope reuse via `SessionConfig.baseSnapshot`. Re-seed `heap.bin` into a fresh QuickJS context with session-space functions re-bridged. Skip-snapshot path when heap > 64MB (`snapshot_skipped` event; rollback blocked past that point). Min alias: L (`pnpm eval --lib snapshot --model L`).

---

## Phase 11 — L10: `lib/spaces`

**Goal:** the `Space` class and the `.d.ts` overlay generator — the headline runtime API.

Deliverables under `llm-repl/src/lib/spaces/`:

- `Space` class — `new Space(name)`, `Space.current()` (session-scoped, auto-created at boot under `session-{id}/space/` — spec L1617), `Space.load(name)` → `SpaceHandle`.
- Mutation methods (`addFunction`, `addViewComponent`, `addFormComponent`, `addTaskList`, `addAgent`, `addKnowledgeDomain/Field/Option`, `read`, `patch`, `list`, `write`, `remove`) — all return `this`. Each method writes files **and** wires the runtime binding immediately; `loadSpace()` re-runs after the next inspect to refresh system prompt + `.d.ts` overlay.
- `SpaceHandle` with lazy `loadAgent/loadFunction/loadComponent/loadKnowledge` and populated `.agents`, `.functions`, `.components` records.
- **Two-step class load** (spec contract "Class stub in .functions" L1871): `loadFunction(name)` populates `.functions.{name}` with a collapsed stub + `.d.ts` hint comment; method use produces a tsc error pointing to `loadFunction(name, { expand: true })` + `inspect()` to replace stub with full interface.
- `.d.ts` overlay generator — branded `SpaceHandle` types per visible space, agent action signatures from tasklist config (with knowledge field type unions per spec L1754), function/component signatures from captured source, ambient module declarations for `availableModules`.
- `loadSpace()` failure path: keep prior `SessionConfig`, inject `space_reload_failed` error (kind: "contract") naming the offending file (spec L1699).
- **Class deletion cascade** (spec L1275, L1874): on `remove('functions/MyClass.ts')`, walk live QuickJS scope at next yield and nullify any variable whose value is an instance; `class_instance_nullified` traced per variable.
- Adapts `repl/src/spaces/dynamic-loader.ts` + `repl/src/spaces/creator.ts` + `cli/src/cli/agent-loader.ts` — same file-tree contract, new programmatic surface.

**Eval focus:** action success rate, tasklist completion, knowledge expansion accuracy, space authoring. Min alias: L (`pnpm eval --lib spaces --model L`).

---

## Phase 12 — Orchestration Router (`llm-repl-cli/src/router/`)

**Goal:** the host-side router that fires at `new_message` and `post_inspect` (spec §"Model Orchestration" L237–372).

Deliverables:

- `router.ts` — implements every routing rule from spec §"Routing Rules" in order (L302–323): annotation-escalation (rule 1), re-analyze (rule 2), recovery escalation M-R/L-R (rules 3–6), no-tasklist-yet, in-progress-task-difficulty tier selection, finish-up, budget warning, heap warning.
- `analyzer.ts` — single-turn XS call. JSON output schema per spec §"ANALYZER Sub-Prompt" L327–342 (`difficulty`, `skip_planner`, `estimated_tasks`, `needs_fork`, `needs_ask`, `rationale`).
- LoRA adapter selection via AI SDK `providerOptions` (spec L289–298). Model aliases via existing env-var resolver (`LM_MODEL_{ALIAS}`, `-R` suffix toggles reasoning).
- Router state: `error_streak`, `annotation_mismatch_streak`, `analyzer_refires`, cached difficulty. Reset rules per spec.
- Router emits **only** `router_decision` events to `trace.jsonl` (spec L246) — routing JSON never injected into executor context. Effects are visible only through context flags (`budget_warning`, `heap_warning`, `recovery_context`) which expand specific reconstruction blocks per spec L344–352.
- `router/eval/` with router dataset + grader and prompts (`router.md`, `analyzer.md`).
- Per-role evals callable as `pnpm eval --role <ROLE> --model <ALIAS>` (spec L1994–1997).

**Exit:** router decisions on the eval dataset match expected role+model+flags; annotation-escalation triggers at streak 2; re-analyze fires at most once per user instruction.

---

## Phase 13 — CLI Surface & Cutover

- `llm-repl-cli/src/cli/` — `lmthing run` equivalent (binary name `llm-repl`) wiring providers → router → session → Ink/web renderer. WebSocket server for browser renderer (reuses ported `rpc/`).
- **TypeScript export classifier** reused from `cli/src/cli/run-agent.ts` to drive Capture Rule decisions where the CLI sees streamed completions before the runtime sees them (parity check).
- Catalog modules re-registered as QuickJS host bridges — port logic from `repl/src/catalog/{fs,fetch,shell,db,csv,json,path,env,date,crypto,mcp,web-search,image}.ts`, change registration form only.
- **Migration**: existing `repl/` and `cli/` consumers (Studio, Computer, Chat — see `studio/`, `computer/`, `chat/` in the parent monorepo) switch import sites in a single PR per consumer, after the new package passes all eval gates.
- Delete `repl/` and `cli/` once all consumers migrate; update `sdk/org/pnpm-workspace.yaml` and `sdk/org/CLAUDE.md`.

---

## Critical Files (new)

- `sdk/org/llm-repl/src/lib/sandbox/{quickjs,boundary,capture,file-blocks,trace,host-bridge,require}.ts`
- `sdk/org/llm-repl/src/lib/typecheck/{tsc-runner,retry,speculative,annotation-grace}.ts`
- `sdk/org/llm-repl/src/lib/inspect/{index,budget}.ts` + `src/session/` + `src/context/reconstruction.ts`
- `sdk/org/llm-repl/src/lib/{checkpoint,fork,memory,tasklist,io,render,snapshot,spaces}/index.ts` (+ supporting files per phase)
- `sdk/org/llm-repl-cli/src/{router,cli,ink,web}/`
- Each `lib/<name>/eval/` directory: `dataset.jsonl`, `grade.ts`, prompts for all six model aliases (`xs.md`, `s.md`, `m.md`, `m_r.md`, `l.md`, `l_r.md`).
- `sdk/org/llm-repl/llm-repl.d.ts` — canonical surface API (matches spec §"API" L375–999).

## Critical Files (ported, no behavior change)

- `sdk/org/llm-repl/src/knowledge/` ← `repl/src/knowledge/`
- `sdk/org/llm-repl/src/context/{knowledge-decay,stop-decay}.ts` ← `repl/src/context/`
- `sdk/org/llm-repl/src/hooks/` ← `repl/src/hooks/` + extended phase enum
- `sdk/org/llm-repl/src/security/jsx-sanitizer.ts` ← `repl/src/security/`
- `sdk/org/llm-repl/src/lib/spaces/loader.ts` ← `cli/src/cli/agent-loader.ts` + `repl/src/spaces/dynamic-loader.ts` (skeleton, full Space class in L10)
- `sdk/org/llm-repl-cli/src/providers/` ← `cli/src/providers/`
- `sdk/org/llm-repl-cli/src/rpc/` ← `cli/src/rpc/` + `cli/src/cli/server.ts`
- `sdk/org/llm-repl-cli/src/cli/args.ts` ← `cli/src/cli/args.ts`

---

## Verification

Each phase exits when **all three** hold:

1. **Unit tests** — `pnpm -F llm-repl test --filter lib/<layer>` green; specific assertions for every spec subsection in that layer.
2. **Eval grader** — `pnpm eval --lib <layer> --model <ALIAS>` runs end-to-end against the real model configured in `LM_MODEL_<ALIAS>` and emits scores ≥ baseline threshold for the layer's primary metric: L0 = error rate; L1 = self-correction rate; L2 = dead-code-after-inspect rate (must be 0); L3 = rollback success rate; L4 = fork success + budget overrun rate; L5 = proactive-vs-auto compact ratio; L6 = DAG scheduling correctness; L7 = E2E completion; L8 = render correctness + clarification quality; L9 = cross-session scope reuse rate; L10 = action success rate.
3. **Trace assertions** — `trace.jsonl` from the eval run contains every event the layer is supposed to emit (matched against the canonical list at spec L2006).

**End-to-end verification at the close of Phase 13:**

- Run `llm-repl run` with a frontier model on a multi-layer scenario: build a small space, fork two parallel research tasks, use `ask()` for clarification, `checkpoint()` before a risky op, `rollback()` after an injected error. Verify trace event ordering matches the spec's pipeline diagram (spec §"Pipeline" L1154).
- Run the browser renderer against the same session via the WS bridge to confirm parity.
- Run `pnpm eval --role EXEC_STANDARD --model M`, `--role RECOVERY --model M_R`, `--role PLANNER_DEEP --model L_R` and confirm all role gates clear.
- Run all three existing consumer apps (Studio, Computer, Chat) against the new package and confirm no regression in their primary flows before deleting `repl/` and `cli/`.
