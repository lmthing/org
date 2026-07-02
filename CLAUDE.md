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

`libs/core/src/{sandbox,eval,typecheck,globals,spaces,tasklist,fork,delegate,context,session}` · `system-spaces/{system-global,system-engineer,system-architect,system-research,user-memory,user-thing}` · `libs/cli/src/{providers,stream,render,rpc,web,cli,server}` · `libs/ui/src/{app,store,client,components,compat,lib,theme}` · `apps/web/{src,public}` (unified SPA). Full subsystem detail lives in `@.claude/arch/*` (see Task Index).

## Top gotchas

One-liners — full explanations are in the linked file.

- **Variables don't persist between evals** — propagated via `globalThis['x'] = x` appended after each statement. → `@.claude/arch/turn-loop.md`
- **System spaces always merged; only `system-global` functions are universal** — all system agents are universally delegatable; user space wins on collisions (except empty placeholders). → `@.claude/arch/spaces.md` · `@.claude/skills/system-spaces.md`
- **Yield-result binding is host-side**, not the QuickJS post-`await` continuation — `Promise.all` / destructured binds work via `extractBindingPattern` + `vm.setVar`, falling back to the VM's own computed value (`vm.getVar`) when a yield is nested inside another async function (e.g. `webSearch()` awaiting `fetch()` internally) — see DEVELOPMENT.md §5. → `@.claude/arch/turn-loop.md`
- **A bridged host-function promise must not be disposed before it settles** — `sandbox/host-bridge.ts` used to dispose the QuickJS promise deferred immediately on creation; `resolve()`/`reject()` are no-ops after `dispose()` (quickjs-emscripten), so a yield nested inside another async function could never resume. Fixed by disposing on settle, with an `alive`-guard + per-context pending-deferred registry so a VM torn down mid-flight (budget cap, timeout) doesn't leave a live handle blocking `ctx.dispose()`.
- **VM teardown must never throw** — `vm.dispose()` (`sandbox/quickjs.ts`) drains pending jobs then swallows QuickJS's `list_empty(&rt->gc_obj_list)` abort. That assertion fires when a stray GC object survives teardown (deep fork/delegate nesting with many nested `fetch` yields); it is CATCHABLE and does NOT poison the shared WASM module, but if it propagated out of `dispose()` the fork error-path would reject an **already-resolved** fork — silently turning a successful result into a failure and cascading up (`investigate` fails → `deep_research` returns undefined → architect gets nothing). Set `LM_QJS_DEBUG=1` to load the assertion-tracking debug WASM variant when hunting a real handle leak.
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
- **Per-task capability is declared in tasklist frontmatter, enforced by the host** — `role` (`explore`/`plan` = read-only, `general` = write), `functions: [...]` (allowlist; **`[]` = no functions at all, incl. `webSearch`/`webFetch`**; omit = all), `forEach: "<task>.<field>"` (fan-out), `canDelegateTo` (delegation allowlist). **Never forbid a tool in prose — disable it in frontmatter.** → `libs/core/system-spaces/DEVELOPMENT.md`
- **`forEach` map node** — the host runs the task once per element of an upstream array (parallel, within the fork cap), injects the element as `item`/`index`, and collects results into an array for dependents; the model never writes the loop. → `tasklist/orchestrator.ts` · DEVELOPMENT.md §3
- **`charter.md` vs `instruct.md`** — `agents/<slug>/charter.md` (short, fork-safe identity/guardrails, no ask/delegate/UI prose) is injected into the top-level prompt **and every fork**; `instruct.md` (orchestration/routing) is top-level only. Forks also receive the tasklist `index.md` goal as standing context. → DEVELOPMENT.md §1
- **Tasks have no `tasklist`/`fork`/`ask` and no `delegate` unless they opt in** — these are **stripped from the fork DTS** (stray calls fail typecheck, not at runtime). A task adds `delegate` back, allowlisted to `space/agent#action`, via frontmatter `canDelegateTo`; routed through `delegateRunner` wired at BOTH ForkEngine sites (`session.ts`, `delegate.ts` — the architect runs as a delegatee). → `fork/fork.ts` `resolveTaskDelegate` · DEVELOPMENT.md §3a
- **Soft todos** — open `.lmthing/todos.json` items (`todoWrite`/`todoRead`) are re-injected into every top-level turn (non-blocking) so the agent doesn't forget them. → `session.ts readTodoReminder`
- **Per-stream idle watchdog** — a no-token model-stream stall (`streamIdleMs`, default 60s) is retried as a transient error. **Caveat:** it cannot fire while a synchronous call (e.g. `execShell`) blocks the Node event loop. `fetch` is no longer in this category — it's a real, non-blocking yield (`globals/fetch.ts`), not `execSync(curl)`. → `eval/turn-loop.ts` · DEVELOPMENT.md §5

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

- `delegate-writes-resolve-against-system-space-dir.md` — a delegate's relative `writeFile` resolves against the delegated agent's OWN space dir; in workspace runs that is the SOURCE system-spaces tree, so a writing delegate (engineer) pollutes the installed system space instead of the project (found live in E4, 2026-07-02).

## Rules

- **Always test every fix.** No fix is done until a test would have caught it.
- **Issue lifecycle.** File a `.issues/` entry when a bug is found; delete it (and its Known issues entry) when fixed and tested.
- **No issue file = no known bugs.** Keep `.issues/` empty by fixing things, not ignoring them.
- **Design system is mandatory.** Any web styling uses `@lmthing/css` tokens — never a raw color (no hex, no literal `rgb()/hsl()`, no stock Tailwind colors like `gray-*`/`blue-*`/`green-500`); use `var(--foreground)`, `bg-primary`, `text-agent`, etc. Change colors only via `libs/css/src/tokens/tokens.json` + `pnpm --filter @lmthing/css generate` (never hand-edit `theme.css`). Enforced by `lint:tokens` (hard CI gate). → `@.claude/skills/visual-design-system.md` · `libs/css/DESIGN.md`.

## Task Index

Load the matching file when working on:

| Working on… | Load |
|---|---|
| the `lmthing` project server / session persistence / `.lmthing/` layout | `@.claude/skills/project-server.md` |
| terminal+web UI design system (catalog, renderers, theming) | `@.claude/skills/ui-design-system.md` |
| **visual** design system — brand palette, CSS design tokens, Tailwind theme, dark mode, component CSS (web SPAs) | `@.claude/skills/visual-design-system.md` (source: `libs/css/DESIGN.md` + `tokens.json`) |
| system spaces / host primitives / fork roles | `@.claude/skills/system-spaces.md` |
| **developing the system spaces** (role/functions/forEach, charter split, architect/research pipelines, live-test commands, gotchas) | [./libs/core/system-spaces/DEVELOPMENT.md](./libs/core/system-spaces/DEVELOPMENT.md) |
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
