# Harness selection

A **harness** is the execution engine that runs a project's agent sessions. lmthing
historically had exactly one — the `@lmthing/core` QuickJS / TypeScript-REPL runtime,
hard-wired into `Session`. This module lets a project choose between engines:

| id | engine |
|----|--------|
| `lmthing` | the built-in QuickJS statement-streaming runtime (default; unchanged) |
| `dsh` | DeepSeek Harness (Cordis), embedded in-process, with the lmthing-compat plugin bundle |

## How selection works (implemented — Stage 1)

- **Storage.** `ProjectMeta.harness?: HarnessId` in `project.json` (`projects.ts`). Absent
  means "no per-project preference." `createProjectSync`/`scaffoldProjectSync` accept it;
  `setProjectHarness(root, id, harness)` changes it in place, preserving every other field;
  `readProjectMeta` normalizes it (a stored value that names no known harness is dropped).
- **Resolution** (`harness.ts#resolveHarness`): explicit project value → pod default
  (`LMTHING_HARNESS` env) → `DEFAULT_HARNESS` (`'lmthing'`). `readProjectHarnessSync` is the
  best-effort sync reader used on the build path; it never throws.
- **Dispatch.** `SessionManager` owns a `Map<HarnessId, HarnessProvider>`. Every creation path
  (chat, resume, headless, delegate) already funnels through `buildSessionFn`; that is now a
  single wrapper (`dispatchBuildSession`) that resolves the session's harness from its project
  and hands off to the matching provider. The built-in `'lmthing'` provider wraps the existing
  builder, so its behaviour is identical. A project pinned to a harness with **no registered
  provider** throws `HarnessUnavailableError` at start — it never silently falls back to another
  engine.
- **Registration.** Pass `harnessProviders` to `SessionManagerOpts`, or call
  `manager.registerHarness(provider)` after construction. `manager.availableHarnesses()` lists
  what a pod can run.

Selection is per-project + a pod default; there is no UI yet (set via the project create API,
`setProjectHarness`, or `LMTHING_HARNESS`).

## The dsh runtime (`./dsh/`) — Stage 2, embed proven

The `dsh` provider embeds a DeepSeek Harness (Cordis) runtime **in-process** and renders it
through lmthing's existing surface. Implemented and covered:

- **`dsh/modules.ts`** — soft loader. dsh is NOT a dependency of `@lmthing/cli`; the modules are
  dynamically imported from a built checkout at `LMTHING_DSH_HOME` (each dsh package by its own
  `lib/` entry, the `@deepseek-ai/cordis` peer resolved from a dsh package's `node_modules`). So
  `@lmthing/cli` builds and runs with no dsh present; `dshRuntimeAvailable()` gates registration.
- **`dsh/event-bridge.ts`** — pure translation of dsh `SessionEvent`s → lmthing `TraceEvent`s
  (assistant text → `display`+`llm_response`, `run_code` → `statement`, tool + code-dispatch →
  `yield`/`yield_resolved`, `turn/end` → `turn_end`). This is why a dsh turn renders in the
  existing chat/trace UI with no client change. Fully unit-tested (`event-bridge.test.ts`).
- **`dsh/session.ts`** — `DshSession implements SessionLike`: boots the Context (llm, session,
  system-prompt, tools, code-runtime, agent, agent-loop), creates the agent with the lmthing
  persona in `setup`, subscribes the bridge to `session/event`, drives turns via
  `followup` + `whenIdle`. Code Mode is on by default (`tools.mode: 'code'`), keeping "the model
  writes TypeScript".
- **`dsh/provider.ts`** — `createDshHarnessProvider({ createAdapter, codeMode? })` →
  `HarnessProvider`; loads a best-effort persona from the agent's `charter.md`/`instruct.md`.

**Proven end-to-end** by `dsh/session.live.test.ts`: with `LMTHING_DSH_HOME` set, it boots a real
dsh Context in-process, drives one turn with a keyless mock adapter, and asserts the bridged
`display`/`turn_end` land on the `SessionLike` tracer. The test self-skips when dsh is absent
(so CI is unaffected).

### LLM via the LiteLLM gateway — Stage 2b, done

- **`dsh/litellm.ts`** — `createLiteLlmSetup({ model })` points dsh's own OpenAI-compatible
  `llm-deepseek` adapter (which POSTs `/chat/completions` with `Bearer` auth) at the LiteLLM
  gateway lmthing already uses: `LMTHINGCLOUD_BASE_URL` (default `https://lmthing.cloud/v1`) +
  `LMTHINGCLOUD_API_KEY`, provider route `deepseek-official`. Reuses dsh's tested adapter rather
  than hand-rolling an OpenAI client. The config builder is pure + unit-tested.
- **`DshSession.llm`** is a `DshLlmSetup` seam (`configure(ctx)` mounts a provider and names the
  route/model) — the keyless mock and the LiteLLM path both plug in here.
- **Registration:** `maybeRegisterDshHarness(manager, { defaultModelSpec })` (called from both pod
  branches in `cli/bin.ts`) registers the `dsh` provider when `dshRuntimeAvailable()`, resolving
  the LiteLLM model from `LMTHING_DSH_MODEL` or the pod's default model spec.

Remaining before dsh is a full peer of the lmthing runtime:

- **History/resume.** `getHistory()` returns `[]` and `resume()` starts fresh; dsh keeps its own
  session log, so snapshot/summarize/resume need mapping to it.
### Stage 3 — space parity (persona + functions→tools, done)

- **`dsh/space-loader.ts`** — `loadDshAgent(spaceDir, agentSlug)` loads a space via
  `@lmthing/core`'s `loadSpace` and returns the agent's persona (charter + instruct body) plus a
  tool spec per declared `functions:` entry. `compileFunction(source)` esbuild-strips a function's
  `export default` and imports it as a callable.
- **`DshSession`** takes `spaceDir`/`agentSlug`, loads the agent in `boot()`, and in the agent
  `setup` hook installs the persona (`systemPrompt.section`) and registers each function as a dsh
  tool (`defineTool` + `ctx.tools.register`) whose `execute` runs the compiled function. The live
  test loads a real space (persona + a `double` function) and asserts the agent boots and renders,
  proving the registration path.

Remaining for Stage 3:
- **Argument mapping.** A function is called with the tool's whole JSON args object (`fn(args)`);
  positional-parameter functions need a param-schema derived from the source signature.
- **`fork`/`delegate`/`tasklist` → `ctx.subagents` + `ctx.workflowEngine`**, and **components →
  conversation nodes** (the `display()`/`ask()` component catalog).

**Stage 4 — app serving:** mount lmthing's SQLite/API/ViewRenderer stack on dsh's `ctx.webServer`.

**Stage 3 — space-format plugin.** A dsh plugin bundle that loads a project's spaces
(`agents/ functions/ components/ tasklists/ knowledge/`) and maps them to dsh: agents →
agent presets (persona + `tools.restrict`), `functions:` → registered tools, `display`/`ask`
→ a conversation node + an ask-user tool, `fork`/`delegate`/`tasklist` → subagents + the
workflow engine. Most of the on-disk format is portable data; the orchestration semantics
(salvage, per-node least-privilege, resumable checkpoints) are net-new on the dsh side.

**Stage 4 — app-serving plugin.** lmthing's serving stack (SQLite store, worker-isolated API
runtime, hooks/event bus, the no-eval `ViewRenderer`) is engine-independent Node and can be
mounted on dsh's `ctx.webServer`; the `writeProject*` authoring globals become dsh tools.

**Known gaps to close before dsh is production-viable** (see the migration analysis):
- **Isolation.** dsh Code Mode is a worker-thread ("containment, not a security boundary"),
  unlike lmthing's WASM jail. Multi-tenant per-user pods need dsh's `isolation: 'container'`
  code-runtime backend (declared upstream, not yet shipped).
- **Capability gate.** lmthing's ungranted-call-is-a-typecheck-error becomes a per-agent tool
  allowlist + dispatch-time rejection on dsh.
