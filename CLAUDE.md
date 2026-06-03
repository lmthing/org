# LMThing — Developer Guide

LLM agent runtime where models drive programs by writing TypeScript. The model streams TS statements; the host evaluates them one at a time in a QuickJS WASM sandbox. Value-yielding calls (`ask`, `sleep`, `tasklist`, `fork`, `delegate`, `inspect`, `loadKnowledge`, `registerSpace`) abort the stream, hand control to the host, and resume the next turn with resolved values injected as a VARIABLES block.

## Workspace

```bash
pnpm install          # install from lockfile
pnpm build            # build all packages → dist/
pnpm typecheck        # tsc --noEmit across all packages (strict)
pnpm test             # vitest run (co-located tests)
pnpm dev              # watch + rebuild all packages in parallel
```

Single-package commands (faster during active work):
```bash
pnpm --filter @repl/core build
pnpm --filter @repl/cli build
pnpm --filter @repl/core test
```

Run the CLI against a fixture space:
```bash
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking "make pasta"
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --agent chef "make pasta"
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --web 3000     # browser mode
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --trace /tmp/trace.jsonl "make pasta"
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --repl         # interactive multi-turn (human)
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --claude --repl  # interactive multi-turn (agent/automated)
node packages/cli/dist/cli/bin.js --space ./fixtures/engineer --claude "grep for TODO and list the files"  # coding agent (system spaces)
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --claude --no-system-spaces "..."  # disable the always-on toolkit
```

### REPL mode (`--repl`)

Starts a persistent session. Each message typed at `>` runs `session.start()` for the first turn, then `session.continue()` for subsequent turns — the VM, scope, and message history are preserved across turns.

Type `exit` or press Ctrl+C to quit.

A first message can be supplied as a positional argument to skip the initial prompt:
```bash
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --repl "make pasta"
```

### `--claude` flag

Switches `InkRenderHost.ask()` from Ink's `TextInput` widget to a plain stdout/stdin approach. Use this when the CLI is driven programmatically (Claude Code, scripts, tmux automation) where raw-mode PTY assumptions don't hold. Without `--claude`, ask() renders an interactive Ink form for human use.

## Packages

| Package | Entry | Purpose |
|---------|-------|---------|
| `@repl/core` | `packages/core/src/index.ts` | Runtime — sandbox, eval loop, globals, spaces. No renderer/provider. |
| `@repl/cli` | `packages/cli/src/cli/bin.ts` | Terminal (Ink), WS server, AI provider wiring. |
| `@repl/ui` | `packages/ui/src/index.ts` | React web surface + `useReplSession` hook. |

`@repl/core` never imports from `cli` or `ui`. It emits events and accepts a `RenderHost` interface.

## Directory Map

```
packages/core/src/
  sandbox/     quickjs.ts host-bridge.ts boundary.ts jsx-runtime.ts trace.ts  ← VM + marshalling + tracing
  eval/        turn-loop.ts yield.ts error-rewind.ts stream-types.ts           ← the execution engine
  typecheck/   tsc.ts library-dts.ts overlay.ts overlay-dts.ts transpile.ts
  globals/     ask.ts sleep.ts display.ts inspect.ts fork.ts delegate.ts tasklist.ts load-knowledge.ts register-space.ts serialize.ts host-tools.ts  ← host-tools = shared sync substrate (execShell/fetch/readFileRaw/writeFileRaw…)
  spaces/      load.ts frontmatter.ts agent.ts components.ts knowledge.ts tasklist-load.ts system.ts  ← system.ts = system-space loader + merge
  tasklist/    dag.ts orchestrator.ts condition-dsl.ts schema.ts
  fork/        fork.ts roles.ts                                                 ← roles.ts = explore/plan/general capability profiles + preambles
  delegate/    delegate.ts registry.ts
  context/     history.ts system-block.ts variables.ts summarize.ts             ← summarize wired into session.continue()
  session/     session.ts snapshot.ts types.ts

packages/core/system-spaces/                                                    ← always-loaded baseline spaces (NOT under src/; read at runtime)
  fs/functions/      readFile writeFile editFile glob grep listDir
  web/functions/     webSearch webFetch
  memory/functions/  remember recall recallAll forget
  todo/functions/    todoWrite todoRead

packages/cli/src/
  providers/   resolve.ts aliases.ts
  stream/      stream.ts
  render/      ink-renderer.tsx html-to-terminal.ts
  rpc/         server.ts events.ts
  web/         serve.ts                                                          ← esbuild bundle + HTTP+WS server
  cli/         bin.ts args.ts

packages/ui/src/
  client/      rpc-client.ts useReplSession.ts
  components/  DisplayBlock.tsx AskBlock.tsx VariablesBlock.tsx
```

## Key Invariants

- Each `evalStatement(code)` call is an isolated ES module. Variables do not persist between evals — the turn loop appends `try { globalThis['x'] = x; } catch {}` after each statement so the next module can read them as globals. All declared variables (including `undefined` values) are propagated this way.
- **Yield-result binding is host-side, not via the module continuation.** A statement that yields (`const x = await ask()`, `const [a,b] = await Promise.all([fork(),fork()])`) does NOT re-run its post-`await` code in this sync eval model. The turn loop resolves each pending yield, then maps the resolved value(s) onto the bound names using `extractBindingPattern` (simple ← the value; array ← positional, so parallel `Promise.all` results land in order; object ← by key) and `vm.setVar`s them. Do not assume the QuickJS continuation binds variables.
- `accumulatedContext` in the turn loop persists across yield continuations (variables stay in typecheck scope). Only error retries start fresh.
- **System spaces are always merged into every space.** `Session` calls `mergeSystemInto` (`spaces/system.ts`) after `loadSpace`; system functions are injected universally (bypassing the per-agent `functions:` filter), and the same set flows to forks **and delegates** (via `RunDelegateOpts.systemSpaces`). The user space wins on name collisions.
- **Fork VMs have `loadKnowledge`** injected alongside `ask`, `inspect`, `sleep`, and `display`. Tasks inside a tasklist fork can call `await loadKnowledge(...)`.
- **`registerSpace(dir)` loads a space at runtime** into a `dynamicSpaces` map on `Session`. Subsequent `delegate()` calls can reach the newly registered space immediately — no session restart needed. Re-registering the same dir overwrites the prior entry (used for idempotent re-scaffolding).
- JSX in model output is transpiled to `React.createElement(...)` via `transpileStatement()` before VM eval. A React shim and component stubs are injected at session start.
- Space functions are transpiled and evaled as scripts (not modules) in the VM via `evalScript()`, binding to `globalThis`. When the space has `node_modules` (esbuild bundling ran), the bundled JS is used instead of transpiling from TS source.
- The QuickJS VM uses sync `evalCode` + manual `executePendingJobs` loop — NOT `evalCodeAsync`, which deadlocks when awaiting user input.
- `.env` is loaded from `process.cwd()` only (where the script is run, not the package dir).
- `Tracer` writes NDJSON to `--trace <file>` (each event is a JSON line). Pass `NULL_TRACER` to disable. The tracer is threaded through session → fork → delegate.

## Environment

```bash
# .env at repo root (or wherever you run the CLI from)
AZURE_API_KEY=...
AZURE_RESOURCE_NAME=...

# Model aliases — LM_MODEL_<ALIAS>
LM_MODEL_M=azure:DeepSeek-V4-Flash
LM_MODEL_L=azure:DeepSeek-V4-Pro

# Default model when --model omitted
LM_MODEL=M
```

Provider support: `azure`, `anthropic`, `openai`, `google`, `mistral`. Format: `provider:modelId`.

## Session API

`Session` in `packages/core/src/session/session.ts`:

- `session.start(message)` — loads the space, creates the VM, injects globals, runs the turn loop from a fresh user message.
- `session.continue(message)` — appends a new user message to the existing history and re-runs the turn loop on the same VM and scope. Throws if called before `start()`. Used by `--repl` mode. Auto-summarizes history when it exceeds `maxHistoryTurns*2` messages.
- `session.dispose()` — tears down the QuickJS VM.

`SessionOpts` additions: `systemSpaceDirs?` (override/disable the always-on spaces) and `maxHistoryTurns?` (history-summarization threshold).

`registerSpace(dir)` is a value-yielding global (`globals/register-space.ts`) that calls `loadSpace(dir)` and inserts the result into `Session.dynamicSpaces`. Returns `{ ok, spaceKey, agentSlug, error? }`. The `spaceKey` is the dir path and is passed as the first arg to `delegate()`. The `dynamicSpaces` map is a shared mutable reference — a `registerSpace` call inside a fork is visible to subsequent `delegate()` calls in the parent session.

## Known issues

See `.issues/` for open bug reports. When all issues are resolved this section will be empty.

## Fixtures

Reference spaces for end-to-end testing:

- `fixtures/cooking/` — chef agent with form components, view components, space functions, tasklist DAG
- `fixtures/sommelier/` — pairing agent with delegation target
- `fixtures/research/` — research analyst with simulated web search functions
- `fixtures/deep_research/` — deep research with real Tavily API (requires `TAVILY_API_KEY`)
- `fixtures/browser_use/` — browser agent using chromium headless + Google search
- `fixtures/data_analyst/` — CSV analysis with statistics, grouping, and filtering
- `fixtures/engineer/` — flagship coding agent: uses the system spaces (fs/web/memory/todo) + fork roles, declares no tools of its own
- `fixtures/architect/` — meta-agent that synthesizes, scaffolds, registers, and delegates to NEW agents at runtime; functions: `scaffoldSpace`, `validateSpace`, `listScaffoldedSpaces`; demonstrates the `registerSpace` → `delegate` pattern

See `@.claude/arch/spaces.md` for space file layout.

## System Spaces

Capabilities are **spaces**, not ad-hoc core globals. A set of baseline "system spaces" is **always loaded and merged into every user space** (and into forks/delegates), so every agent gets a coding toolkit for free. The user space wins on any name collision.

- Located in `packages/core/system-spaces/{fs,web,memory,todo}/` (resolved relative to the built core; `agents/` is reserved).
- `fs` — `readFile`, `writeFile`, `editFile`, `glob`, `grep`, `listDir`
- `web` — `webSearch` (Tavily, needs `TAVILY_API_KEY`), `webFetch`
- `memory` — `remember`, `recall`, `recallAll`, `forget` (durable JSON store at `<spaceDir>/.lmthing/memory.json`)
- `todo` — `todoWrite`, `todoRead` (renders a checklist via `display()`, persists to `.lmthing/todos.json`)

Loader/merge: `packages/core/src/spaces/system.ts` (`loadSystemSpaces`, `mergeSystemInto`). System functions are injected universally (bypassing the per-agent `functions:` filter). The system prompt lists them under a concise `# Built-in Tools` section (signature + doc, not full source). Configure via `SessionOpts.systemSpaceDirs`, CLI `--system-spaces`/`--no-system-spaces`, or env `LM_SYSTEM_SPACES`.

## Fork roles (subagents)

`fork({ role, instruction, output })` spawns an isolated subagent VM — the parent sees only what it resolves (a context firewall). Roles (`packages/core/src/fork/roles.ts`):

- `explore` / `plan` — **read-only**: `writeFileRaw`/`editFile` and mutating shell commands are withheld at injection (via the host-tools capability profile), not merely discouraged.
- `general` (default) — full toolkit.

Plan mode is just `fork({ role: 'plan' })` + an `ask()` approval gate. Run subagents in parallel with `Promise.all([...])` (bounded by `maxConcurrentForks`).

## Host-injected VM Globals

Beyond library globals (ask, sleep, fork, etc.), the QuickJS VM has these host-injected globals available to space functions. They are the thin substrate the system spaces build on (single source of truth: `packages/core/src/globals/host-tools.ts`, used by both the session VM and fork VMs):

- `process.env` — Node.js environment variables (read-only shim); includes `LMTHING_SPACE_DIR` for state stores
- `fetch(url, opts?)` — Synchronous HTTP using curl under the hood; returns `{ ok, status, text(), json() }`
- `execShell(cmd)` — Synchronous shell command execution; returns `{ ok, stdout, stderr }` (read-only fork roles block mutating commands)
- `readFileRaw(path, {offset?,limit?})` — Binary-safe file read via Node fs; returns `{ ok, content, lines, truncated, error? }`
- `writeFileRaw(path, content)` — File write via Node fs (no shell quoting); returns `{ ok, bytes, error? }`. Withheld in read-only fork roles.
- `console.log/warn/error` — Routes through renderHost.log

Space functions can use these directly. `tasklist(name, seed?)` passes `seed` as context to all fork tasks (injected as `any`-typed variables).

## Context economy

The runtime is built to keep context small over long sessions:
- `display()` output is shown to the user but does NOT enter the VARIABLES block.
- `fork({ role: 'explore' })` is a context firewall — a subagent's reading/searching stays in its own VM; only its resolved summary returns.
- `session.continue()` auto-summarizes history once it exceeds `maxHistoryTurns*2` messages (REPL default 20), keeping the last 6 verbatim (`packages/core/src/context/summarize.ts`).
- The `RUNTIME_PREAMBLE` instructs the model on all of the above.

## Tests

Tests are co-located: `packages/core/src/**/*.test.ts`. Run with `pnpm test`.

Current coverage: `boundary.test.ts`, `serialize.test.ts`, `condition-dsl.test.ts`, `tsc.test.ts`, `fork.test.ts`, `fork/roles.test.ts`, `globals/host-tools.test.ts`, `spaces/system.test.ts`, `spaces/system-functions.test.ts`, `spaces/architect-functions.test.ts`, `context/variables.test.ts`, `context/summarize.test.ts`, `eval/turn-loop.test.ts`, `eval/turn-loop-yield.test.ts`.

Live testing: for new runtime features, also drive the built CLI against fixture spaces with a real model and inspect the `--trace` NDJSON — unit tests miss model-behavior and end-to-end integration issues.

No linting or formatting config — TypeScript strict mode is the sole quality gate.

## Rules

- **Always test every fix.** After fixing a bug, write or run a test that would have caught it. No fix is done until it is tested.
- **Issue lifecycle.** When a bug is found, create a file in `.issues/`. When it is fixed and tested, delete the file and remove it from the Known issues list in this file.
- **No issue file = no known bugs.** Keep `.issues/` empty by fixing things, not by ignoring them.

## Skills

Load these when working on specific areas:

- Adding a new value-yielding global → `@.claude/skills/new-global.md`
- Adding a new AI provider → `@.claude/skills/new-provider.md`
- Creating or modifying a space → `@.claude/skills/new-space.md`
- Adding a system space, host primitive, or fork role → `@.claude/skills/system-spaces.md`
- Debugging the eval/yield pipeline → `@.claude/skills/debug-eval.md`
- Writing tests for core modules → `@.claude/skills/writing-tests.md`

## Architecture References

- Turn loop + yield protocol (deep) → `@.claude/arch/turn-loop.md`
- Typecheck + transpile + DTS overlay pipeline → `@.claude/arch/typecheck.md`
- Spaces: loading, validation, agent config → `@.claude/arch/spaces.md`
- Fork + tasklist orchestration → `@.claude/arch/fork-tasklist.md`
- Delegate + registry → `@.claude/arch/delegate.md`
