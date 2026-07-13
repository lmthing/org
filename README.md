# lmthing — the SDK submodule (`sdk/org`)

An LLM agent runtime where the model drives programs by **writing TypeScript**, executed one statement
at a time in a QuickJS WASM sandbox. The user-facing surface is **THING** — an orchestrator agent that
talks to you and routes each request to the right specialist (research, coding, a new agent it builds on
demand, or a whole **app** it builds for a project).

This submodule holds the runtime and everything built directly on it:

- `libs/core` — the sandbox, turn/eval loop, yield protocol, spaces, forks, delegation, tasklists, typecheck
- `libs/cli` — the `lmthing` binary + the pod server (REST/WS API)
- `libs/{ui,css,state,auth,utils,config,openclaw-compat}` — shared libraries
- `libs/core/system-spaces/` — the shipped system + user spaces
- `apps/web` — the unified Vite SPA; `/chat`, `/studio`, `/computer` are client-side routes
- `scenarios/` — live production scenario runner

## Source of truth

**[`org/docs/`](../../org/docs/README.md) (published at lmthing.org) is the single source of truth.**
Every factual sentence there is cited to code. This README is an orientation doc — it holds no knowledge
of its own. When it disagrees with `org/docs`, `org/docs` wins; when `org/docs` disagrees with the code,
the code wins and the doc is a bug.

Contributor-facing detail (gotchas, rules, the full task index) → [CLAUDE.md](./CLAUDE.md).

## Prerequisites

- Node.js ≥ 24, pnpm ≥ 9 (repo-root `package.json` → `engines`)
- A model provider. Put credentials in a `.env` in the directory you run from — `.env` is read from
  `process.cwd()` only:

  ```bash
  AZURE_API_KEY=...
  AZURE_RESOURCE_NAME=...
  LM_MODEL_M=azure:DeepSeek-V4-Pro     # model aliases: provider:modelId
  LM_MODEL=M                           # default alias when --model is omitted
  ```

  Every flag, subcommand, provider and env var → [org/docs/cli-api/commands.md](../../org/docs/cli-api/commands.md).

## Workspace commands

Run these from `sdk/org`:

```bash
pnpm install
pnpm build                          # turbo run build → dist/
pnpm typecheck                      # tsc --noEmit, strict, across all packages
pnpm test                           # vitest run (co-located tests)
pnpm test libs/core/src/tasklist    # path / substring filter
pnpm dev                            # turbo run dev --parallel (watch + rebuild)
pnpm thing                          # CLI + web app on ONE port, both hot-reloading
```

> `pnpm --filter @lmthing/<pkg> test` is a **silent no-op** — the packages define no `test` script, so it
> resolves nothing and runs nothing. Always use `cd sdk/org && pnpm test <path>`.
> Test runners, the mock harness, live scenarios → [org/docs/contributing/testing.md](../../org/docs/contributing/testing.md).

## Running it

```bash
# 1. Initialize a workspace (once per directory) — keyless, no API key needed
cd ~/my-workspace
node /path/to/lmthing/sdk/org/libs/cli/dist/cli/bin.js init

# 2. Start the server (bare invocation = serve)
node /path/to/lmthing/sdk/org/libs/cli/dist/cli/bin.js
#    or explicitly: ... serve --port 8080 --model M
```

`init` creates `.lmthing/` with `system/` (the shipped system + user spaces) and `user/` (the default
project). Other modes: `--space <dir> "<message>"` one-shot · `--repl` interactive · `--web <port>`
DevTools UI · `--request "<msg>"` headless single-shot · `--mock <file>` keyless scripted provider ·
`--trace <file>` NDJSON trace.

The server serves all three product surfaces as client-side routes on the same origin:

- **`/chat`** — the conversational interface to THING.
- **`/studio`** — project and space management IDE: browse projects and spaces, author space
  definitions, chat with THING via the always-on right-side dock.
- **`/computer`** — the pod workbench: a file-tree + editor + terminal IDE over your compute pod, plus
  dashboard, spaces and settings views (`apps/web/src/routes/computer/`). *Not computer-use — there is
  no browser control, no desktop, no screen capture.*

## Task index

| Working on… | Read |
|---|---|
| the turn loop, typecheck/DTS, forks, delegation, space loading, sessions | [org/docs/runtime/](../../org/docs/runtime/README.md) |
| a runtime global, or the capability that gates it | [org/docs/runtime-globals/](../../org/docs/runtime-globals/README.md) |
| the on-disk format of a **space** | [org/docs/format/space/](../../org/docs/format/space/README.md) |
| the on-disk format of a **project** (`database/ api/ pages/ hooks/ events/ spaces/`) | [org/docs/format/project/](../../org/docs/format/project/README.md) |
| **project-as-application** — how an app is built, served and executed | [org/docs/app/](../../org/docs/app/README.md) |
| the `lmthing` CLI + the pod REST/WS API | [org/docs/cli-api/](../../org/docs/cli-api/README.md) · [rest/](../../org/docs/cli-api/rest/README.md) |
| the shipped system spaces (THING, appbuilder, architect, engineer, store, …) | [org/docs/system-spaces/](../../org/docs/system-spaces/README.md) |
| the shared libs' public APIs | [org/docs/libs/](../../org/docs/libs/README.md) |
| the `/chat`, `/studio`, `/computer` surfaces | [chat/](../../org/docs/chat/README.md) · [studio/](../../org/docs/studio/README.md) · [computer/](../../org/docs/computer/README.md) |
| **any styling** — design tokens, never a raw color (hard CI gate) | [org/docs/design-system/](../../org/docs/design-system/README.md) |
| making a change; testing; debugging | [org/docs/contributing/](../../org/docs/contributing/README.md) |
| the whole system (domains, pod model, data flow) | [org/docs/architecture.md](../../org/docs/architecture.md) |
