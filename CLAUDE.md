# LMThing — Core Runtime Developer Guide (`sdk/org`)

The agent runtime and everything built directly on it: `@lmthing/core` (QuickJS WASM sandbox, streaming
statement pipeline, yield protocol, spaces/forks/delegates/tasklists, typecheck, budgets), `@lmthing/cli`
(the `lmthing` binary + pod server), the shared libs, and the unified web SPA (`apps/web`).

The model does not call tools — **the model writes TypeScript**, one statement at a time, and the host
evaluates each statement as it streams in. A value-yielding call suspends the VM, aborts the stream, is
resolved host-side, and the results come back as a `VARIABLES` block on the next turn.

## Source of truth — read this first

> **[`org/docs/`](../../org/docs/README.md) (published at lmthing.org) is the single source of truth for
> this codebase.** Every factual sentence there carries a `path:Lstart-Lend` citation to the code that
> makes it true. When this file disagrees with `org/docs`, `org/docs` wins. When `org/docs` disagrees
> with the **code**, the code wins and `org/docs` is fixed.
>
> **A change to code is not done until the matching `org/docs` page is updated in the same change.**
> The rule, the grounding convention, and the "which doc moves with my change?" table →
> [`org/docs/SYNC.md`](../../org/docs/SYNC.md).

This file is an **orientation index**: what lives here, how to run it, and where the real answer is.
Knowledge does not live here.

## Workspace

```bash
cd sdk/org
pnpm install                       # from lockfile
pnpm build                         # turbo run build → dist/
pnpm typecheck                     # tsc --noEmit across all packages (strict)
pnpm test                          # vitest run (co-located tests) — run from sdk/org, NOT the repo root
pnpm test libs/core/src/tasklist   # one directory / substring filter
pnpm dev                           # turbo run dev --parallel (watch + rebuild)
pnpm thing                         # CLI + web app on ONE port, both hot-reloading (scripts/thing-dev.mjs)
```

Running the CLI: `node libs/cli/dist/cli/bin.js --space <dir> "<message>"`. Keyless testing:
`--mock <file>` / `LM_MOCK=<file>` (scripted `streamFn`). `--repl` interactive · `--claude`
programmatic · `--web <port>` DevTools UI · `--request "<msg>"` headless single-shot · `--trace <file>`
NDJSON trace.

- Every flag, subcommand and env var (model aliases, providers) → [`org/docs/cli-api/commands.md`](../../org/docs/cli-api/commands.md)
- Test runners, the two-workspace trap, the mock harness, live scenarios → [`org/docs/contributing/testing.md`](../../org/docs/contributing/testing.md)
- Debugging the eval/yield pipeline → [`org/docs/contributing/debugging.md`](../../org/docs/contributing/debugging.md)

`.env` is read from `process.cwd()` only (`libs/cli/src/cli/bin.ts:L18`). In Claude Code web sessions
keys are decrypted from `.env.encrypted` by `.claude/hooks/session-start.sh` — **if `TAVILY_API_KEY` or
another secret is missing, ask for `ENV_DECRYPT_KEY` before proceeding.**

## Layout

`libs/{core,cli,ui,css,state,auth,utils,config,openclaw-compat}` · `libs/core/system-spaces/*` (the
shipped system + user spaces) · `apps/web` (the unified SPA — `/chat`, `/studio`, `/computer` as
client-side routes) · `scenarios/` (live prod scenario runner).

`@lmthing/core` never imports from `cli` or `ui` — it emits events and accepts a `RenderHost`.

Package-by-package detail → [`org/docs/libs/README.md`](../../org/docs/libs/README.md) · the surfaces →
[`chat/`](../../org/docs/chat/README.md) · [`studio/`](../../org/docs/studio/README.md) ·
[`computer/`](../../org/docs/computer/README.md).

## Gotchas that bite while editing this code

Each is one line; the grounded explanation is behind the link.

- **Variables do not persist between evals** — each statement is its own module; the loop appends
  `globalThis['x'] = x` for every bound name. → [runtime/turn-loop](../../org/docs/runtime/turn-loop.md)
- **Yield-result binding is host-side**, not the QuickJS post-`await` continuation — it maps results onto
  the binding pattern but prefers `vm.getVar(name)` where they diverge (which is what recovers a yield
  nested inside another async function). → [runtime/turn-loop](../../org/docs/runtime/turn-loop.md)
- **A bridged host promise is disposed on settle, never on creation** — `resolve()`/`reject()` are no-ops
  after `dispose()`, so eager disposal permanently neuters a nested `await`. And **`vm.dispose()` must
  never throw**: it swallows QuickJS's `list_empty(&rt->gc_obj_list)` abort, which is catchable and
  benign — propagating it turns an already-produced fork result into a spurious rejection. `LM_QJS_DEBUG=1`
  loads the assertion-tracking debug WASM when hunting a real handle leak. → [runtime/](../../org/docs/runtime/README.md)
- **Not granted ⇒ not injected AND absent from the DTS** — one `CapabilityProfile` drives both, so a call
  the context cannot make fails typecheck (retryable) instead of throwing. This is why `ask`/`fork`/
  `tasklist` in a fork or delegate is a *typecheck* error. → [runtime/typecheck](../../org/docs/runtime/typecheck.md)
- **Never forbid a tool in prose — disable it in tasklist frontmatter** (`role`, `functions: [...]`,
  `canDelegateTo`); the host enforces it, prose does not.
  → [runtime/fork-and-tasklists](../../org/docs/runtime/fork-and-tasklists.md) · [format/space/tasklists](../../org/docs/format/space/tasklists/README.md)
- **`execShell` / `readFileRaw` / `writeFileRaw` are rooted at `LMTHING_SPACE_DIR`**, not `process.cwd()`
  and not the project root — a live footgun for project-authoring agents (`.issues/fs-globals-space-rooted-footgun-for-project-agents.md`).
  Project-app globals (`db`, `writePage`/`writeApi`/`writeHook`) resolve against `projectRoot` instead.
  → [runtime-globals/](../../org/docs/runtime-globals/README.md)
- **Adding a worker-run seam ⇒ add its tsup entry.** Store code (space emitters, space hook handlers, code
  nodes) resolves its worker entry as a sibling of the bundled module; a missing `worker-load-entry` in
  `libs/cli/tsup.config.ts` ships an image where every emitter scan and space-hook dispatch fails in prod
  (unit tests run from `src/` and miss it). → [`libs/cli/tsup.config.ts`](./libs/cli/tsup.config.ts)
- **System spaces auto-adopt source/image updates** — a pristine materialized copy re-syncs on boot;
  locally-edited ones hold back (adopt with `--adopt-system-spaces`). → [`libs/cli/src/cli/runtime-init.ts`](./libs/cli/src/cli/runtime-init.ts) · [system-spaces/](../../org/docs/system-spaces/README.md)
- **`pnpm --filter @lmthing/core test` is a silent no-op** — core has no `test` script. Use
  `cd sdk/org && pnpm test <path>`. → [contributing/testing](../../org/docs/contributing/testing.md)

## Rules

- **Always test every fix.** No fix is done until a test would have caught it.
- **Update the doc in the same change.** See [`org/docs/SYNC.md`](../../org/docs/SYNC.md). If you catch
  yourself explaining behaviour *here*, it belongs in `org/docs` — put it there and link it.
- **Issue lifecycle.** File a `.issues/` entry when a bug is found; delete it when fixed and tested.
  No issue file = no known bugs. (`.issues/` is the live list — do not mirror it here.)
- **Design system is mandatory.** Any web styling uses `@lmthing/css` tokens — never a raw color. Change
  colors only via `libs/css/src/tokens/tokens.json` + `pnpm --filter @lmthing/css generate` (never
  hand-edit `theme.css`). Enforced by `lint:tokens` (hard CI gate). → [design-system/](../../org/docs/design-system/README.md)

## Task Index

Source of truth is the `org/docs` page. Skills (`@.claude/skills/*`) are local *procedures* only.

| Working on… | Read |
|---|---|
| the turn loop / yield protocol / budgets / retries / prose-drop | [org/docs/runtime/turn-loop.md](../../org/docs/runtime/turn-loop.md) |
| typecheck / the DTS overlay / transpile / the JSX runtime | [org/docs/runtime/typecheck.md](../../org/docs/runtime/typecheck.md) |
| forks + tasklist orchestration / roles / `forEach` / salvage / code nodes | [org/docs/runtime/fork-and-tasklists.md](../../org/docs/runtime/fork-and-tasklists.md) |
| `delegate()` / the registry / `canDelegateTo` / actions / auto-capture | [org/docs/runtime/delegation.md](../../org/docs/runtime/delegation.md) |
| space loading / system-space merge rules / project functions | [org/docs/runtime/spaces-loading.md](../../org/docs/runtime/spaces-loading.md) |
| the `Session` API / snapshots + resume / history summarization / tracing | [org/docs/runtime/sessions.md](../../org/docs/runtime/sessions.md) |
| a runtime global, or the capability that gates it | [org/docs/runtime-globals/](../../org/docs/runtime-globals/README.md) · procedure: `@.claude/skills/new-global.md` |
| the on-disk format of a **space** (agents, tasklists, knowledge, functions, components, events) | [org/docs/format/space/](../../org/docs/format/space/README.md) · procedure: `@.claude/skills/new-space.md` |
| the on-disk format of a **project** (`database/ api/ pages/ hooks/ events/ spaces/`) | [org/docs/format/project/](../../org/docs/format/project/README.md) |
| **project-as-application** — how an app is built, served and executed | [org/docs/app/](../../org/docs/app/README.md) · procedure: `@.claude/skills/project-app.md` |
| the `lmthing` CLI, the pod server, session persistence, `.lmthing/` | [org/docs/cli-api/](../../org/docs/cli-api/README.md) · [rest/](../../org/docs/cli-api/rest/README.md) · procedure: `@.claude/skills/project-server.md` |
| the shipped system spaces (THING, appbuilder, architect, engineer, store, …) | [org/docs/system-spaces/](../../org/docs/system-spaces/README.md) · authoring notes: [libs/core/system-spaces/DEVELOPMENT.md](./libs/core/system-spaces/DEVELOPMENT.md) |
| **the unified event pipeline** — `events/*` emitter defs, event hooks, `@consent`, store globals | `@lmthing:.claude/skills/events-and-hooks.md` (repo-root skill) · [org/docs/format/space/events/](../../org/docs/format/space/events/README.md) |
| adding an AI provider | [org/docs/contributing/add-a-provider.md](../../org/docs/contributing/add-a-provider.md) |
| writing / running tests | [org/docs/contributing/testing.md](../../org/docs/contributing/testing.md) |
| debugging the eval/yield pipeline | [org/docs/contributing/debugging.md](../../org/docs/contributing/debugging.md) |
| the design system (tokens, theme, component CSS) | [org/docs/design-system/](../../org/docs/design-system/README.md) · canonical spec: [libs/css/DESIGN.md](./libs/css/DESIGN.md) |
| the shared libs' public APIs (`state`, `ui`, `css`, `auth`, `openclaw-compat`) | [org/docs/libs/](../../org/docs/libs/README.md) |
| the `/chat`, `/studio`, `/computer` surfaces | [chat/](../../org/docs/chat/README.md) · [studio/](../../org/docs/studio/README.md) · [computer/](../../org/docs/computer/README.md) |
| the whole system (domains, pod model, data flow) | [org/docs/architecture.md](../../org/docs/architecture.md) |
