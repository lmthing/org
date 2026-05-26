# Features map: DTS surface + new architecture

## DTS sources & overlay pipeline
- `llm-repl/llm-repl.d.ts` — canonical public surface for `@lmthing/llm-repl`.
- `llm-repl/src/lib/spaces/library-dts.ts` (`LIBRARY_AMBIENT_DTS`) — runtime primitives exposed to the LLM.
- `llm-repl/src/lib/spaces/overlay-dts.ts` — extracts ambient declarations for space `functions/` and `components/`.
- `llm-repl/src/lib/spaces/prompt-builder.ts` — assembles library + overlay into `ambientDts` passed to `runTsc`.
- `llm-repl/src/lib/eval-shared/api-surface.d.ts.md` — eval harness snapshot of the API surface.

## DTS primitives (globals + Space API)

### inspect() / InspectQuery / InspectBuilder
- DTS: `llm-repl/llm-repl.d.ts`, `LIBRARY_AMBIENT_DTS`.
- Implementation: `llm-repl/src/lib/inspect/index.ts` (registerInspectGlobals, query parsing, applyQuery), `llm-repl/src/lib/inspect/serialize.ts`, `llm-repl/src/lib/inspect/extract-names.ts`.
- Related code: `llm-repl/src/context/reconstruction.ts` (rebuilds __scope + __<arg>), `llm-repl/src/session/assembly.ts` (git commits per inspect), `llm-repl-cli/src/session/session.ts` + `llm-repl-cli/src/cli/chat-session.ts` (registerInspectGlobals, onInspect hooks).

### display() / ask() + built-in UI components
- DTS: `llm-repl/llm-repl.d.ts`, `LIBRARY_AMBIENT_DTS`.
- Implementation: `llm-repl/src/lib/render/render.ts` (RenderEngine, display/ask lifecycle), `llm-repl/src/lib/sandbox/host-bridge.ts` (marshal JSX descriptors).
- Related code: `llm-repl/src/security/jsx-sanitizer.ts` (sanitization/validation), `ui/src/thing-web-view/JSXRenderer.tsx` (web renderer), `cli/src/components/form/*` + `cli/src/components/shared/*` (Ink/CLI renderer, legacy), `llm-repl-cli/src/session/session.ts` + `llm-repl-cli/src/cli/run.ts` (RenderEngine wiring).

### budget()
- DTS: `llm-repl/llm-repl.d.ts`, `LIBRARY_AMBIENT_DTS`.
- Implementation: `llm-repl/src/lib/inspect/budget.ts` (BudgetTracker, pricing), `llm-repl/src/lib/inspect/index.ts` (budget() global).
- Related code: `llm-repl-cli/src/session/session.ts` (loadModelPricing + recordApiUsage), `llm-repl/src/context/reconstruction.ts` (injects __budget in reconstruction).

### sleep(ms)
- DTS: `llm-repl/llm-repl.d.ts`, `LIBRARY_AMBIENT_DTS`, spec in `NEW_ARCHITECTURE.md`.
- Implementation status: no `sleep()` global is wired in `llm-repl` or `llm-repl-cli` yet; the only implementation in repo is legacy `repl/src/sandbox/globals.ts`.

### fork() / ForkHandle / resolve()
- DTS: `llm-repl/llm-repl.d.ts`, `LIBRARY_AMBIENT_DTS`.
- Implementation: `llm-repl/src/lib/fork/fork.ts` (ForkEngine, registerGlobals for fork/resolve).
- Related code: `llm-repl-cli/src/session/session.ts` (overrides fork with single-turn LLM executor), `llm-repl/src/context/reconstruction.ts` (fork state + asks), `llm-repl/src/lib/inspect/budget.ts` (fork counts/budget).

### checkpoint() / rollback()
- DTS: `llm-repl/llm-repl.d.ts`, `LIBRARY_AMBIENT_DTS`.
- Implementation: `llm-repl/src/lib/checkpoint/checkpoint.ts` (CheckpointEngine), `llm-repl/src/session/assembly.ts` (git tags + reset).
- Related code: `llm-repl/src/lib/snapshot/snapshot.ts` (rollback validity for heap snapshots), `llm-repl/src/context/reconstruction.ts` (git/checkpoint info in reconstruction).

### pin() / unpin() / compact() / expand()
- DTS: `llm-repl/llm-repl.d.ts`, `LIBRARY_AMBIENT_DTS`.
- Implementation: `llm-repl/src/lib/memory/memory.ts` (MemoryEngine, compaction strategies).
- Related code: `llm-repl/src/context/scope-serializer.ts` (pins + compactions in __scope), `llm-repl/src/context/reconstruction.ts` (auto-compaction + pin metadata), `llm-repl/src/session/types.ts` (PinRecord/CompactionRecord).

### tasklist()
- DTS: `llm-repl/llm-repl.d.ts`, `LIBRARY_AMBIENT_DTS`.
- Implementation: `llm-repl/src/lib/tasklist/tasklist.ts` (TasklistEngine + schema validation).
- Related code: `llm-repl/src/context/reconstruction.ts` (tasklist nudge + __tasks), `llm-repl/src/lib/spaces/prompt-builder.ts` (task DAG harness and instructions), `llm-repl-cli/src/session/session.ts` + `llm-repl-cli/src/cli/run.ts` (TasklistEngine wiring).

### fetch() / fs / require()
- DTS: `llm-repl/llm-repl.d.ts`, `LIBRARY_AMBIENT_DTS`.
- Implementation: `llm-repl/src/lib/io/io.ts` (IoEngine, fetch allowlist, fs sandbox), `llm-repl/src/lib/sandbox/require.ts` (ModuleRegistry).
- Related code: `llm-repl-cli/src/session/session.ts` + `llm-repl-cli/src/cli/run.ts` (IoEngine config), `llm-repl/src/lib/sandbox/host-bridge.ts` (host function marshaling).

### delegate()
- DTS: `llm-repl/src/lib/spaces/library-dts.ts` (`DelegateSpec`, `delegate()`).
- Implementation: `llm-repl-cli/src/session/session.ts` (injectGlobal delegate + runSpaceSession).
- Related code: `llm-repl/src/lib/spaces/prompt-builder.ts` (delegate hint in system prompt), `llm-repl-cli/src/session/session.ts` (Space proxy uses __Space_delegate).

### Space / SpaceHandle / space editing APIs
- DTS: `llm-repl/llm-repl.d.ts`.
- Implementation: `llm-repl/src/lib/spaces/space.ts` (Space class: addFunction/addViewComponent/addFormComponent/addAgent/addKnowledgeDomain/addKnowledgeField, read/write/patch/list/remove, generateDtsOverlay, processClassDeletion).
- Related code: `llm-repl/src/lib/spaces/disk.ts` (loadSpaceFromDisk uses add* methods), `llm-repl/src/lib/spaces/overlay-dts.ts` (space DTS overlay), `llm-repl-cli/src/session/session.ts` (minimal Space proxy injected for runtime).
- Status notes: `addTaskList`, `addKnowledgeOption`, `loadKnowledge`, `SpaceHandle.loadAgent/loadComponent/loadKnowledge` are declared in `llm-repl.d.ts` but have no implementation in `space.ts` yet.

### SessionError / SessionConfig
- DTS: `llm-repl/llm-repl.d.ts`.
- Implementation: `llm-repl/src/session/types.ts` (SessionError), config values are applied in `llm-repl-cli/src/session/session.ts` and `llm-repl-cli/src/cli/run.ts` when constructing `createSandboxSession`, `IoEngine`, and `RenderEngine`.

## New architecture layers (L0–L10)
- L0 Sandbox: `llm-repl/src/lib/sandbox/*` (QuickJS lifecycle, boundary detection, capture rule, file blocks, trace writer, host bridge, ModuleRegistry).
- L1 Typecheck: `llm-repl/src/lib/typecheck/*` (runTsc, retry, speculative buffer, annotation grace) + `llm-repl-cli/src/session/session.ts` / `llm-repl-cli/src/cli/chat-session.ts` (runTsc usage).
- L2 Inspect/yield: `llm-repl/src/lib/inspect/*`, `llm-repl/src/context/reconstruction.ts`, `llm-repl/src/session/assembly.ts`.
- L3 Checkpoints: `llm-repl/src/lib/checkpoint/checkpoint.ts` + `llm-repl/src/session/assembly.ts`.
- L4 Forks: `llm-repl/src/lib/fork/fork.ts` + `llm-repl-cli/src/session/session.ts` override for single-turn forks.
- L5 Memory: `llm-repl/src/lib/memory/memory.ts` + `llm-repl/src/context/scope-serializer.ts`.
- L6 Tasklist: `llm-repl/src/lib/tasklist/tasklist.ts` + `llm-repl/src/lib/spaces/prompt-builder.ts`.
- L7 I/O: `llm-repl/src/lib/io/io.ts` + `llm-repl/src/lib/sandbox/require.ts`.
- L8 Render: `llm-repl/src/lib/render/render.ts` + `llm-repl/src/security/jsx-sanitizer.ts` + UI renderers (`ui/`, `cli/`).
- L9 Snapshot: `llm-repl/src/lib/snapshot/snapshot.ts` + `llm-repl/src/session/heap.ts`.
- L10 Spaces: `llm-repl/src/lib/spaces/*` (Space, disk loader, DTS overlay, prompt builder) + knowledge tree in `llm-repl/src/knowledge/*`.

## Orchestration / host runtime
- Session loop + wiring: `llm-repl-cli/src/session/session.ts` (space sessions) and `llm-repl-cli/src/cli/run.ts` (phase-13 single-cycle runner).
- Router: `llm-repl-cli/src/router/*` (ANALYZER + routing rules, trace events).
- Knowledge formatting: `llm-repl/src/knowledge/*` (build/load/format knowledge trees), consumed by `llm-repl/src/lib/spaces/prompt-builder.ts`.
- Hooks: `llm-repl/src/hooks/*` (pattern matching + hook execution).
- Security: `llm-repl/src/security/*` (JSX sanitization + function registry wrappers).
