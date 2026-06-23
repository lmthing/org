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
# CLI: node packages/cli/dist/cli/bin.js --space ./fixtures/cooking "make pasta"
```

Testing without keys: `--mock <file>` / `LM_MOCK=<file>` (scripted streamFn, no credentials). REPL: `--repl`. Programmatic/automated: `--claude`. Web DevTools UI: `--web <port>`. Full testing guide → `@.claude/skills/writing-tests.md`.

## Packages

| Package | Entry | Purpose |
|---------|-------|---------|
| `@lmthing/core` | `packages/core/src/index.ts` | Runtime — sandbox, eval loop, globals, spaces. No renderer/provider. |
| `@lmthing/cli` | `packages/cli/src/cli/bin.ts` | Terminal (Ink), WS server, AI provider wiring, `lmthing run`. |
| `@lmthing/agent-ui` | `packages/ui/src/index.ts` | React web surface — THING chat shell + DevTools panel. |

`@lmthing/core` never imports from `cli` or `ui`. It emits events and accepts a `RenderHost` interface.

## Directory map (top level)

`packages/core/src/{sandbox,eval,typecheck,globals,spaces,tasklist,fork,delegate,context,session}` · `system-spaces/{global,engineer,architect,solver,deep_research,memory,thing}` · `packages/cli/src/{providers,stream,render,rpc,web,cli}` · `packages/ui/src/{app,store,client,components,compat,lib,theme}`. Full subsystem detail lives in `@.claude/arch/*` (see Task Index).

## Top gotchas

One-liners — full explanations are in the linked file.

- **Variables don't persist between evals** — propagated via `globalThis['x'] = x` appended after each statement. → `@.claude/arch/turn-loop.md`
- **System spaces always merged; only `global` functions are universal** — all system agents are universally delegatable; user space wins on collisions (except empty placeholders). → `@.claude/arch/spaces.md` · `@.claude/skills/system-spaces.md`
- **Yield-result binding is host-side**, not the QuickJS post-`await` continuation — `Promise.all` / destructured binds work via `extractBindingPattern` + `vm.setVar`. → `@.claude/arch/turn-loop.md`
- **Forks always salvage a value unless hard-capped** — `BudgetExceededError` propagates; an explicit `timeout` rejects; orchestrator/delegate forks (no timeout) always salvage. → `@.claude/arch/fork-tasklist.md`
- **Yield errors surface to the model** (retryable), not silent `undefined`; hard caps still short-circuit. → `@.claude/arch/turn-loop.md`
- **`delegate()`'s `action` is optional** — omit for model-driven delegation; auto-captures tasklist results. → `@.claude/arch/delegate.md`
- **`execShell` / `readFileRaw` / `writeFileRaw` rooted at `LMTHING_SPACE_DIR`**, not `process.cwd()`. → `@.claude/skills/system-spaces.md`
- **JSX in model output** is transpiled to `React.createElement`; the JSX runtime is injected into every VM (sessions, forks, delegates). → `@.claude/arch/typecheck.md`

## Session API (`packages/core/src/session/session.ts`)

- `start(message)` — load space, create VM, inject globals, run the turn loop from a fresh user message.
- `continue(message)` — append a user message to existing history + VM/scope; re-run the turn loop. Auto-summarizes past `maxHistoryTurns*2` messages.
- `resume(snapshotDir, message)` — rehydrate a persisted session on a fresh VM (powers server-side session persistence; see `@.claude/skills/project-server.md`).
- `dispose()` — tear down the VM.

Notable `SessionOpts`: `systemSpaceDirs`, `maxHistoryTurns`, `preloadSpaceDirs`, `projectSpacesDir`. `registerSpace(dir)` is a value-yielding global that loads a space into `Session.dynamicSpaces` (a shared `Map` reference, visible to subsequent `delegate()` calls and to forks).

## Tracing

`Tracer` (`sandbox/trace.ts`) is the single event spine: writes NDJSON to `--trace <file>` **and** fans out to in-process `subscribe()`rs. Threaded through session→run→fork→delegate→tasklist→solve, each scope minting a `nodeId`/`parentId` via `tracer.child()/end()` (the `context` label is preserved verbatim so existing jq recipes keep working). `buildTraceTree(events)` (`sandbox/trace-tree.ts`, browser-safe) reconstructs the tree. Pass `NULL_TRACER` to disable.

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

- `research-fork-scope-loss.md` — `fork:research` in `synthesize_and_run` loses variable scope across statements (typecheck "Cannot find name"); the DAG skips it gracefully so the synthesized space ships without web knowledge.
- `skill-import-scenarios.md` — enhancement: whole-plugin / marketplace-wide / commands+agents import (single-`SKILL.md` import already works); has open questions.

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
| space loading / merge rules / `normalizeSpec` | `@.claude/arch/spaces.md` |
| space authoring + package API guide | [./SPACE_DEVELOPMENT.md](./SPACE_DEVELOPMENT.md) |
