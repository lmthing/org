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

## Adding the dsh provider (Stages 2+ — not yet implemented)

The seam above is complete and tested. What remains is the actual `dsh` provider and the
plugins that give dsh parity with lmthing's product surface. This is a multi-stage build; the
`dsh` path currently returns `HarnessUnavailableError` until a provider is registered.

**Stage 2 — embed dsh + provider skeleton.** Add DeepSeek Harness to the workspace (vendored or
as `@deepseek-ai/dsh-*` deps), boot a Cordis app per session, and register a `HarnessProvider`
whose `buildSession` returns a `Session`-compatible handle backed by dsh's agent loop. Bridge
the pod's `streamFn`/model to a `ctx.llm` adapter and dsh's session-event stream to the pod's
`RenderHost`/`TraceHub`. Select dsh Code Mode (`tools.mode: 'code'`) so the model still writes
TypeScript.

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
