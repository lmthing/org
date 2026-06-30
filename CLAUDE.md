# LMThing — Core Runtime Developer Guide

LLM agent runtime where models drive programs by writing TypeScript. The model streams TS statements; the host evaluates them one at a time in a QuickJS WASM sandbox. Value-yielding calls (`ask`, `sleep`, `tasklist`, `fork`, `delegate`, `inspect`, `loadKnowledge`, `registerSpace`) abort the stream, hand control to the host, and resume the next turn with resolved values injected as a VARIABLES block.

This file is an **orientation index** — load detail from the **Task Index** below only when a task needs it.

## Workspace

```bash
pnpm install          # from lockfile
pnpm build            # build all packages → dist/
pnpm typecheck        # tsc --noEmit across all packages (strict)
pnpm test             # vitest run (co-located tests)
pnpm dev              # watch + rebuild all packages
# Single package: pnpm --filter @lmthing/core {build|test}
# CLI: node libs/cli/dist/cli/bin.js --space ./fixtures/cooking "make pasta"
```

Testing without keys: `--mock <file>` / `LM_MOCK=<file>` (scripted streamFn, no credentials). REPL: `--repl`. Programmatic/automated: `--claude`. Web DevTools UI: `--web <port>`. Headless single-shot: `--request "<msg>"` (runs THING agent, streams to stdout, exits — no TUI, no server). Full testing guide → `@.claude/skills/writing-tests.md`.

## Packages

| Package | Entry | Purpose |
|---------|-------|---------|
| `@lmthing/core` | `libs/core/src/index.ts` | Runtime — sandbox, eval loop, globals, spaces. No renderer/provider. |
| `@lmthing/cli` | `libs/cli/src/cli/bin.ts` | Terminal (Ink), WS server, AI provider wiring, `lmthing serve`. Serves the unified SPA (studio/computer/chat) as a catch-all for non-`/api` requests. |
| `@lmthing/web-app` | `apps/web/` | Unified Vite SPA — three product surfaces as client-side routes, served by `lmthing serve` and deployed as separate nginx K8s images per domain. See **App Surfaces** below. |

`@lmthing/core` never imports from `cli` or `ui`. It emits events and accepts a `RenderHost` interface.

## App Surfaces (`apps/web/`)

The unified SPA (`@lmthing/web-app`) exposes three product surfaces as TanStack Router client-side routes. The CLI's `serve.ts` wires `createStaticApps(resolveAppDist())` as a catch-all for all non-`/api` requests (`LM_APP_DIST` overrides the dist path). The same build is deployed as separate nginx images (`lmthingacr.azurecr.io/{studio,computer,chat}`) — one K8s Deployment per domain, different Envoy JWT+Lua routing per domain.

| Route | Domain | Product |
|-------|--------|---------|
| `/chat` | lmthing.chat | **Chat** — the primary conversational interface to the THING agent. Users write to the agent, the agent streams TypeScript statements that run in their compute pod's QuickJS sandbox. Projects and spaces are visible as a side panel. |
| `/studio`, `/studio/$projectId` | lmthing.studio | **Studio** — project and space management IDE. Users browse their pod's PVC projects and spaces, author space definitions (knowledge, personas, tools), and run agents within a project context. The always-on THING chat dock is present on the right side. |
| `/computer`, `/computer/dashboard` | lmthing.computer | **Computer** — autonomous computer-use surface. The agent controls a browser/desktop environment running inside the user's compute pod. Users describe a task; the agent executes it with screen captures streamed back in real time. |

## Directory map (top level)

`libs/core/src/{sandbox,eval,typecheck,globals,spaces,tasklist,fork,delegate,context,session}` · `system-spaces/{system-global,system-engineer,system-architect,system-deep-research,user-memory,user-thing}` · `libs/cli/src/{providers,stream,render,rpc,web,cli,server}` · `libs/ui/src/{app,store,client,components,compat,lib,theme}` · `apps/web/{src,public}` (unified SPA). Full subsystem detail lives in `@.claude/arch/*` (see Task Index).

## Top gotchas

One-liners — full explanations are in the linked file.

- **Variables don't persist between evals** — propagated via `globalThis['x'] = x` appended after each statement. → `@.claude/arch/turn-loop.md`
- **System spaces always merged; only `system-global` functions are universal** — all system agents are universally delegatable; user space wins on collisions (except empty placeholders). → `@.claude/arch/spaces.md` · `@.claude/skills/system-spaces.md`
- **Yield-result binding is host-side**, not the QuickJS post-`await` continuation — `Promise.all` / destructured binds work via `extractBindingPattern` + `vm.setVar`. → `@.claude/arch/turn-loop.md`
- **Forks always salvage a value unless hard-capped** — `BudgetExceededError` propagates; an explicit `timeout` rejects; orchestrator/delegate forks (no timeout) always salvage. → `@.claude/arch/fork-tasklist.md`
- **Yield errors surface to the model** (retryable), not silent `undefined`; hard caps still short-circuit. → `@.claude/arch/turn-loop.md`
- **`delegate()`'s `action` is optional** — omit for model-driven delegation; auto-captures tasklist results. → `@.claude/arch/delegate.md`
- **`ask` is top-level-session-only** — NOT injected in forks/delegates (they're autonomous/headless) and absent from their DTS (`LIBRARY_DTS_NO_ASK`); a stray `ask()` there fails typecheck. → `@.claude/arch/delegate.md` · `@.claude/arch/fork-tasklist.md`
- **`tasklist`/`delegate`/`loadKnowledge` return `any`**, and a space function with no explicit return type is declared `any` — so `result.field` reads without a cast. Narrate via `// comments`, never bare prose. → `@.claude/arch/typecheck.md`
- **Transient stream errors retry** (a dropped/"terminated" connection isn't mistaken for "done"). → `@.claude/arch/turn-loop.md`
- **Knowledge: overview in `index.md`, multiple aspect options** — the field `index.md` body is the overview (surfaced to the agent); each field has ≥2 `<aspect>.md` files (no single `overview.md`), loaded on demand. → `@.claude/skills/new-space.md`
- **System spaces auto-adopt source/image updates** — a pristine materialized copy re-syncs from `defaultSystemSpaceDirs()` on boot; locally-edited ones hold back (adopt with `--adopt-system-spaces`). → `libs/cli/src/cli/runtime-init.ts`
- **The server exposes system/user spaces as a synthetic `system` project** — `listProjects` (`libs/cli/src/server/projects.ts`) prepends `{id:'system'}` when `<root>/system/spaces/` is non-empty, so Studio can list/view/edit them through the normal `/api/projects/system/spaces/...` routes (`<root>/system/spaces/<id>` matches the generic `<root>/<projectId>/spaces/<id>` shape). `system` is reserved (can't be created/deleted as a project).
- **`execShell` / `readFileRaw` / `writeFileRaw` rooted at `LMTHING_SPACE_DIR`**, not `process.cwd()`. → `@.claude/skills/system-spaces.md`
- **JSX in model output** is transpiled to `React.createElement`; the JSX runtime is injected into every VM (sessions, forks, delegates). → `@.claude/arch/typecheck.md`

## Session API (`libs/core/src/session/session.ts`)

- `start(message)` — load space, create VM, inject globals, run the turn loop from a fresh user message.
- `continue(message)` — append a user message to existing history + VM/scope; re-run the turn loop. Auto-summarizes past `maxHistoryTurns*2` messages.
- `resume(snapshotDir, message)` — rehydrate a persisted session on a fresh VM (powers server-side session persistence; see `@.claude/skills/project-server.md`).
- `dispose()` — tear down the VM.

Notable `SessionOpts`: `systemSpaceDirs`, `maxHistoryTurns`, `preloadSpaceDirs`, `projectSpacesDir`. `registerSpace(dir)` is a value-yielding global that loads a space into `Session.dynamicSpaces` (a shared `Map` reference, visible to subsequent `delegate()` calls and to forks).

## Tracing

`Tracer` (`sandbox/trace.ts`) is the single event spine: writes NDJSON to `--trace <file>` **and** fans out to in-process `subscribe()`rs. Threaded through session→run→fork→delegate→tasklist, each scope minting a `nodeId`/`parentId` via `tracer.child()/end()` (the `context` label is preserved verbatim so existing jq recipes keep working). `buildTraceTree(events)` (`sandbox/trace-tree.ts`, browser-safe) reconstructs the tree. Pass `NULL_TRACER` to disable.

## Environment & Secrets

```bash
# .env at repo root (or wherever you run the CLI)
AZURE_API_KEY=... · AZURE_RESOURCE_NAME=...
LM_MODEL_M=azure:DeepSeek-V4-Flash   # model alias (LM_MODEL_<ALIAS>)
LM_MODEL=M                           # default model when --model omitted
```

Providers: `azure`, `anthropic`, `openai`, `google`, `mistral` (format `provider:modelId`). `.env` loads from `process.cwd()` only.

Secrets (Claude Code web): API keys stored encrypted in `.env.encrypted` (AES-256-CBC), decrypted by `.claude/hooks/session-start.sh`. **If `TAVILY_API_KEY` (or other secrets) are missing in a web session, ask for `ENV_DECRYPT_KEY` before proceeding.**

## Known issues

See `.issues/`. When all are resolved this section is empty.

- `system-spaces-bundle-resolution.md` — `defaultSystemSpaceDirs()` resolves relative to the cli bundle; only the Docker image co-locates the assets, so a non-Docker built `serve` gets an empty `system/` and sessions fail with `Agent "thing" not found` (agent slug `thing`, in the `user-thing` space). `materializeRuntime` now warns + `runtimeNeedsInit` repairs an empty dir.
- `architect-synthesize-stall.md` — the `system-architect` `synthesize_and_run` pipeline can hang mid-turn on a silent no-token model stream (observed on the prod free-tier pod): the turn loop retries dropped/"terminated" streams but has no inactivity watchdog for a stream that stops emitting tokens, so the orchestrator waits on the fork forever and no space is scaffolded. Needs a per-stream idle timeout.

## Rules

- **Always test every fix.** No fix is done until a test would have caught it.
- **Issue lifecycle.** File a `.issues/` entry when a bug is found; delete it (and its Known issues entry) when fixed and tested.
- **No issue file = no known bugs.** Keep `.issues/` empty by fixing things, not ignoring them.

## Task Index

Load the matching file when working on:

| Working on… | Load |
|---|---|
| the `lmthing` project server / session persistence / `.lmthing/` layout | `@.claude/skills/project-server.md` |
| terminal+web UI design system (catalog, renderers, theming) | `@.claude/skills/ui-design-system.md` |
| system spaces / host primitives / fork roles | `@.claude/skills/system-spaces.md` |
| creating or modifying a space | `@.claude/skills/new-space.md` |
| adding a value-yielding global | `@.claude/skills/new-global.md` |
| adding an AI provider | `@.claude/skills/new-provider.md` |
| debugging the eval/yield pipeline | `@.claude/skills/debug-eval.md` |
| writing/running core tests | `@.claude/skills/writing-tests.md` |
| turn-loop / yield protocol / budget / prose-drop | `@.claude/arch/turn-loop.md` |
| typecheck / DTS overlay / transpile / JSX runtime | `@.claude/arch/typecheck.md` |
| fork + tasklist orchestration / salvage | `@.claude/arch/fork-tasklist.md` |
| delegate + registry / auto-capture / `defaultAction` | `@.claude/arch/delegate.md` |
| space loading / merge rules | `@.claude/arch/spaces.md` |
| space authoring + package API guide | [./SPACE_DEVELOPMENT.md](./SPACE_DEVELOPMENT.md) |
