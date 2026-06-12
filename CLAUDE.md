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
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --web 3000     # DevTools web UI (see "Web observability UI")
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --trace /tmp/trace.jsonl "make pasta"
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --repl         # interactive multi-turn (human)
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --claude --repl  # interactive multi-turn (agent/automated)
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --claude "grep for TODO and list the files"  # coding agent (system spaces always loaded)
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --claude --no-system-spaces "..."  # disable the always-on toolkit
node packages/cli/dist/cli/bin.js --space ./packages/core/system-spaces/solver --claude --mock ./fixtures/solver/mock.mjs "implement add"  # keyless run (scripted mock)
```

### Testing without API keys (`--mock` / `LM_MOCK`)

`--mock <file>` (or `LM_MOCK=<file>`) replaces the live AI SDK with a scripted
`streamFn`, so the whole runtime — including forks/delegates/`solve` — runs with **no
credentials**. The mock file is plain ESM (`.mjs`); its default export is a
`MockHandler` (or a `string[]`, wrapped in `mockScript`) that returns the TypeScript the
"model" should emit for each turn. The builders live in
`packages/core/src/testing/mock-provider.ts` (`createMockStreamFn`, `mockScript`,
`mockMatch`). Because the mock sits upstream of the tracer, every `--trace` assertion
works unchanged. See `fixtures/{solver,engineer}/mock.mjs` for worked examples and
`packages/cli/src/testing/keyless-cli.test.ts` for the keyless CLI smoke suite (run
after `pnpm build`).

### REPL mode (`--repl`)

Starts a persistent session. Each message typed at `>` runs `session.start()` for the first turn, then `session.continue()` for subsequent turns — the VM, scope, and message history are preserved across turns.

Type `exit` or press Ctrl+C to quit.

A first message can be supplied as a positional argument to skip the initial prompt:
```bash
node packages/cli/dist/cli/bin.js --space ./fixtures/cooking --repl "make pasta"
```

### `--claude` flag

Switches `InkRenderHost.ask()` from Ink's `TextInput` widget to a plain stdout/stdin approach. Use this when the CLI is driven programmatically (Claude Code, scripts, tmux automation) where raw-mode PTY assumptions don't hold. Without `--claude`, ask() renders an interactive Ink form for human use.

### Web observability UI (`--web <port>`)

A DevTools-style 3-pane browser UI with **full observability of the execution hierarchy** (session → run → delegate → fork → tasklist task → solve) and an **agent-friendly HTTP API** on the same port.

- **Layout:** left = live execution tree (status glyphs, durations, retry counts, fork-queue stats); center = conversation (user messages, `display()` output, interactive `ask()` forms incl. space components); right = per-node inspector (LLM requests/responses with retry attempts, evaluated statements + typecheck/eval errors, yields, variables snapshot, raw trace events).
- **Live + replay:** live over WebSocket; `?trace=/trace.jsonl` (when `--trace` is set) or the "Load trace" file picker replays a `.jsonl` with a timeline scrubber. Same reducer powers both.
- **Agent control (minimum context):** the UI is driveable headless via `GET /api/help` → `/api/state` (ASCII tree) → `/api/node/<id>?tab=…` → `/api/events?since=<seq>` (poll), plus `POST /api/message` / `/api/ask/<id>` / `/api/ui`. Full guide: `packages/cli/src/web/AGENT.md` (also served at `/api/help`). Every UI view is a deep-link URL (`?node=…&tab=…`); tree rows carry `data-node-id`; panes use ARIA landmarks.
- **Build:** the React app lives in `@repl/ui` (`src/app/`, `src/store/`), styled with **Tailwind v4** (prebuilt to `dist-web/app.css` at `pnpm build`). `serve.ts` runtime-bundles the app entry + the space's `web.tsx` form components together via esbuild so a **single React instance** is shared (no hooks-breaking second copy). Only the CSS is prebuilt.

## Packages

| Package | Entry | Purpose |
|---------|-------|---------|
| `@repl/core` | `packages/core/src/index.ts` | Runtime — sandbox, eval loop, globals, spaces. No renderer/provider. |
| `@repl/cli` | `packages/cli/src/cli/bin.ts` | Terminal (Ink), WS server, AI provider wiring. |
| `@repl/ui` | `packages/ui/src/index.ts` | React web surface — the DevTools observability app (`src/app/`, `src/store/`, Tailwind v4 → `dist-web/app.css`). Also exports legacy block components + `useReplSession`. |

`@repl/core` never imports from `cli` or `ui`. It emits events and accepts a `RenderHost` interface.

## Directory Map

```
packages/core/src/
  sandbox/     quickjs.ts host-bridge.ts boundary.ts jsx-runtime.ts trace.ts trace-tree.ts  ← VM + marshalling + tracing (trace.ts = event spine; trace-tree.ts = pure tree builder)
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
  rpc/         server.ts events.ts trace-hub.ts                                  ← trace-hub.ts = seq-buffered WS broadcast + snapshot/compaction
  web/         serve.ts agent-api.ts AGENT.md                                    ← serve.ts = HTTP+WS+static; agent-api.ts = headless /api/* control surface
  cli/         bin.ts args.ts

packages/ui/src/
  app/         main.tsx App.tsx tree.tsx conversation.tsx inspector.tsx replay.tsx common.tsx styles.css  ← DevTools 3-pane web app (Tailwind v4)
  store/       model.ts store.ts                                                 ← pure reducer (model.ts) + zustand store (live + replay)
  client/      rpc-client.ts useReplSession.ts                                   ← legacy chat hook (superseded by store/)
  components/  DisplayBlock.tsx AskBlock.tsx VariablesBlock.tsx                   ← legacy block renderers
```

## Key Invariants

- Each `evalStatement(code)` call is an isolated ES module. Variables do not persist between evals — the turn loop appends `try { globalThis['x'] = x; } catch {}` after each statement so the next module can read them as globals. All declared variables (including `undefined` values) are propagated this way.
- **Yield-result binding is host-side, not via the module continuation.** A statement that yields (`const x = await ask()`, `const [a,b] = await Promise.all([fork(),fork()])`) does NOT re-run its post-`await` code in this sync eval model. The turn loop resolves each pending yield, then maps the resolved value(s) onto the bound names using `extractBindingPattern` (simple ← the value; array ← positional, so parallel `Promise.all` results land in order; object ← by key) and `vm.setVar`s them. Do not assume the QuickJS continuation binds variables.
- `accumulatedContext` in the turn loop persists across yield continuations (variables stay in typecheck scope). Only error retries start fresh.
- **System spaces are always merged into every space.** `Session` calls `mergeSystemInto` (`spaces/system.ts`) after `loadSpace`; system functions are injected universally (bypassing the per-agent `functions:` filter), and the same set flows to forks **and delegates** (via `RunDelegateOpts.systemSpaces`). The user space wins on name collisions.
- **Fork VMs have `loadKnowledge`** injected alongside `ask`, `inspect`, `sleep`, and `display` (plus `registerSpace` for write-capable roles). Tasks inside a tasklist fork can call `await loadKnowledge(...)`. The fork's `processYield` explicitly handles `loadKnowledge` by calling `loadKnowledgeFile` directly — without this, `undefined` would win the race against the async file read and bind `k = undefined` in the VM.
- **`registerSpace(dir)` loads a space at runtime** into a `dynamicSpaces` map on `Session`. Subsequent `delegate()` calls can reach the newly registered space immediately — no session restart needed. Re-registering the same dir overwrites the prior entry (used for idempotent re-scaffolding). The `Session` shares this same `Map` reference with its `ForkEngine`, so a `registerSpace()` call **inside a (write-capable) fork** is visible to subsequent parent `delegate()` calls. Read-only fork roles (`explore`/`plan`) do **not** get `registerSpace` injected — it mutates shared session state, so it is withheld like the other write capabilities.
- **Delegate auto-captures tasklist result.** When a delegate agent calls `tasklist(name)` where `name === actionDef.tasklist`, the result is automatically set as `capturedResult` even without an explicit `currentTask.resolve()` call. This prevents silent null returns when the model forgets to call resolve after the tasklist.
- **`scaffoldSpace` normalizes the nested spec shape models emit.** Models reliably produce a nested spec (`{ agents: { <slug>: { instruct } }, knowledge: { <domain>: { <field>: { index, options|files: {...} } } }, functions: { "<name>.ts": "<source>" }, components: { "<Name>.tsx": "<source>" }, tasklists: { <name>: { "1-id.md": "<markdown>" } } }`) instead of the flat `ScaffoldSpec` — and prompting does not reliably override that prior. `scaffoldSpace` (`system-spaces/architect/functions/scaffoldSpace.ts`) therefore runs `normalizeSpec` first: it lifts the nested shape to flat (no-op when already flat), accepts bare-string or `{code}`/`{source}`/`{content}` bodies, strips baked `.md`/`.ts`/`.tsx` extensions from names/slugs, infers form-vs-view, and flattens tasklists from arrays / `{tasks}` / bare `{ "N-id.md": body }` maps. `validateSpecShape` then returns actionable errors instead of a cryptic crash. Already-flat specs (those with top-level `agentSlug`) pass through unchanged.
- **Delegate user message guides tasklist use.** When the action has a `tasklist` field, the delegate user message includes an explicit hint: `Implement this action by calling tasklist("name", context)`. This prevents the model from writing direct code that bypasses the orchestration and leaves the result uncaptured.
- JSX in model output is transpiled to `React.createElement(...)` via `transpileStatement()` before VM eval. A React shim and component stubs are injected at session start.
- Space functions are transpiled and evaled as scripts (not modules) in the VM via `evalScript()`, binding to `globalThis`. When the space has `node_modules` (esbuild bundling ran), the bundled JS is used instead of transpiling from TS source.
- The QuickJS VM uses sync `evalCode` + manual `executePendingJobs` loop — NOT `evalCodeAsync`, which deadlocks when awaiting user input. After draining jobs (and only when no yield is pending), `evalStatement` inspects the module's evaluation promise via `getPromiseState`: a top-level `await` that throws (e.g. `await missingGlobal()`) rejects that promise, which `executePendingJobs` would otherwise swallow as an unhandled rejection — so it is surfaced as a turn error instead of silently continuing.
- `.env` is loaded from `process.cwd()` only (where the script is run, not the package dir).
- `Tracer` (`sandbox/trace.ts`) is the **single event spine**: it writes NDJSON to `--trace <file>` (each event a JSON line) **and** fans out to in-process `subscribe()`rs (sync, error-isolated; the CLI's `TraceHub` subscribes for the web UI). Pass `NULL_TRACER` to disable. Threaded through session → run → fork → delegate → tasklist task → solve, where each scope mints a unique `nodeId`+`parentId` via `tracer.child()/end()` (a structured `TraceScope` generalizing the old flat `context` string — the `context`/label is preserved verbatim so existing jq recipes keep working; all new fields are additive). New event types: `node_start/node_update/node_end`, `fork_queue`, `display` (attributed), `variables`, `llm_progress` (subscriber-only, not written to file), `solve_verify`; `yield`/`yield_resolved` gained an optional `yieldId`. `buildTraceTree(events)` (`sandbox/trace-tree.ts`, pure/dependency-free, browser-safe) reconstructs the execution tree from any event array (live or a replayed file; falls back to context-label grouping for legacy no-`nodeId` traces).

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

## Secrets (Claude Code web)

API keys are stored encrypted in `.env.encrypted` (AES-256-CBC) and decrypted automatically by `.claude/hooks/session-start.sh` on every web session.

**If you are running in Claude Code web and `TAVILY_API_KEY` or other secrets appear to be missing, ask the user for the decryption password (`ENV_DECRYPT_KEY`) before proceeding.** Then decrypt manually:

```bash
ENV_DECRYPT_KEY=<password> openssl enc -d -aes-256-cbc -pbkdf2 -base64 \
  -pass env:ENV_DECRYPT_KEY -in .env.encrypted
```

To add or update secrets locally:
1. Edit `.env` (gitignored — never commit it)
2. Run `ENV_DECRYPT_KEY=<password> ./scripts/encrypt-env.sh`
3. Commit `.env.encrypted`

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

- `fixtures/cooking/` — chef agent with form components, view components, space functions, tasklist DAG. `mock-ask.mjs` = keyless mock that fires an `ask(<ConfirmDish/>)`, used by `web-api.test.ts` to verify space-form rendering + submit in the web UI.
- `fixtures/sommelier/` — pairing agent with delegation target
- `fixtures/research/` — research analyst with simulated web search functions
- `fixtures/deep_research/` — deep research with real Tavily API (requires `TAVILY_API_KEY`)
- `fixtures/browser_use/` — browser agent using chromium headless + Google search
- `fixtures/data_analyst/` — CSV analysis with statistics, grouping, and filtering
- `fixtures/engineer/` — mock harness for engineer agent CLI tests (agent content lives in `system-spaces/engineer`)
- `fixtures/architect/` — placeholder for architect agent CLI tests (agent content lives in `system-spaces/architect`)
- `fixtures/solver/` — scripted mock providers (`mock*.mjs`) for keyless solve-ladder CLI tests (agent content lives in `system-spaces/solver`)
- `fixtures/sauce_master/` — global sauce technique specialist synthesized by the architect; knowledge files for 10 world cuisines; action: `recommend_sauce`
- `fixtures/cursor_ci/` — competitive intelligence analyst synthesized by the architect; knowledge files for 5 AI code editors (Cursor, Copilot, Windsurf, Aider, Codeium); action: `analyze`

See `@.claude/arch/spaces.md` for space file layout.

## System Spaces

Capabilities are **spaces**, not ad-hoc core globals. A set of baseline "system spaces" is **always loaded and merged into every user space** (and into forks/delegates), so every agent gets a coding toolkit for free. The user space wins on any name collision.

- Located in `packages/core/system-spaces/{fs,web,memory,todo,engineer,architect,solver}/` (resolved relative to the built core).
- `fs` — `readFile`, `writeFile`, `editFile`, `glob`, `grep`, `listDir`
- `web` — `webSearch` (Tavily, needs `TAVILY_API_KEY`), `webFetch`
- `memory` — `remember`, `recall`, `recallAll`, `forget` (durable JSON store at `<spaceDir>/.lmthing/memory.json`)
- `todo` — `todoWrite`, `todoRead` (renders a checklist via `display()`, persists to `.lmthing/todos.json`)
- `engineer` — coding agent (agent def + `TaskInput` component); `delegate` to it from any space
- `architect` — meta-agent (`scaffoldSpace`, `validateSpace`, `listScaffoldedSpaces` functions + full `synthesize_and_run` / `iterate_space` tasklists); `delegate` to it to synthesize new agents at runtime
- `solver` — verifier-gated coding agent (no functions; drives the `solve` built-in). `--agent solver` or `delegate` to it; writes its candidate under the space dir. Mock providers for keyless runs live in `fixtures/solver/`.

Loader/merge: `packages/core/src/spaces/system.ts` (`loadSystemSpaces`, `mergeSystemInto`). System functions are injected universally (bypassing the per-agent `functions:` filter). The system prompt lists them under a concise `# Built-in Tools` section (signature + doc, not full source). Configure via `SessionOpts.systemSpaceDirs`, CLI `--system-spaces`/`--no-system-spaces`, or env `LM_SYSTEM_SPACES`.

## Fork roles (subagents)

`fork({ role, instruction, output })` spawns an isolated subagent VM — the parent sees only what it resolves (a context firewall). Roles (`packages/core/src/fork/roles.ts`):

- `explore` / `plan` — **read-only**: `writeFileRaw`/`editFile`, mutating shell commands, and `registerSpace` are withheld at injection (via the host-tools capability profile), not merely discouraged.
- `general` (default) — full toolkit.

Plan mode is just `fork({ role: 'plan' })` + an `ask()` approval gate. Run subagents in parallel with `Promise.all([...])` (bounded by `maxConcurrentForks`).

## Host-injected VM Globals

Beyond library globals (ask, sleep, fork, etc.), the QuickJS VM has these host-injected globals available to space functions. They are the thin substrate the system spaces build on (single source of truth: `packages/core/src/globals/host-tools.ts`, used by both the session VM and fork VMs):

- `process.env` — Node.js environment variables (read-only shim); includes `LMTHING_SPACE_DIR` (an **absolute** path) for state stores
- `fetch(url, opts?)` — Synchronous HTTP using curl under the hood; returns `{ ok, status, text(), json() }`
- `execShell(cmd)` — Synchronous shell command execution; returns `{ ok, stdout, stderr }` (read-only fork roles block mutating commands)
- `readFileRaw(path, {offset?,limit?})` — Binary-safe file read via Node fs; returns `{ ok, content, lines, truncated, error? }`
- `writeFileRaw(path, content)` — File write via Node fs (no shell quoting); returns `{ ok, bytes, error? }`. Withheld in read-only fork roles.

**Path rooting:** `readFileRaw`/`writeFileRaw` resolve **relative** paths against the space dir (`LMTHING_SPACE_DIR`), not `process.cwd()` — the same root `solve()`'s `verifyCommand` runs in (`session.ts` `execCommand` uses `cwd: spaceDir`). So a fork that writes `work/candidate.ts` and a verifier that reads `work/candidate.ts` agree regardless of where the CLI was launched. Absolute paths pass through untouched.
- `console.log/warn/error` — Routes through renderHost.log

Space functions can use these directly. `tasklist(name, seed?)` passes `seed` as context to all fork tasks (injected as `any`-typed variables).

## Context economy

The runtime is built to keep context small over long sessions:
- `display()` output is shown to the user but does NOT enter the VARIABLES block.
- `fork({ role: 'explore' })` is a context firewall — a subagent's reading/searching stays in its own VM; only its resolved summary returns.
- `session.continue()` auto-summarizes history once it exceeds `maxHistoryTurns*2` messages (REPL default 20), keeping the last 6 verbatim (`packages/core/src/context/summarize.ts`).
- **The VARIABLES block is a LOSSY preview.** `serialize()` (`globals/serialize.ts`) truncates long strings/arrays/objects with markers like `… (N chars total)`. The VM holds the real full value under the variable name; the model only sees the truncated head. The `GROUND TRUTH` preamble rule tells the model to *reference the bound variable* (the runtime substitutes the real value at eval time) rather than re-type a truncated value as a literal (which fabricates the tail), and to `inspect([var, { path/slice }])` to pull full content back into scope before consuming it.
- **`inspect(...)` surfaces values to the model even when unbound.** The turn loop folds inspected values into the VARIABLES block via `formatInspectResult` regardless of whether the call is bound — so a bare `inspect(x)` is a valid probe (`eval/turn-loop.ts`).
- The `RUNTIME_PREAMBLE` instructs the model on all of the above.

## Tests

Tests are co-located: `packages/core/src/**/*.test.ts`. Run with `pnpm test`.

Current coverage: `boundary.test.ts`, `serialize.test.ts`, `condition-dsl.test.ts`, `tasklist/orchestrator.test.ts`, `tsc.test.ts`, `sandbox/quickjs.test.ts`, `fork.test.ts`, `fork/roles.test.ts`, `globals/ask.test.ts`, `globals/inspect.test.ts`, `globals/host-tools.test.ts`, `delegate/delegate.test.ts`, `spaces/system.test.ts`, `spaces/system-functions.test.ts`, `spaces/architect-functions.test.ts`, `context/variables.test.ts`, `context/summarize.test.ts`, `eval/turn-loop.test.ts`, `eval/turn-loop-yield.test.ts`, `testing/mock-provider.test.ts`, `testing/mock-session.test.ts`, `testing/harness-features.test.ts` (incl. the execution-tree observability block), `sandbox/trace.test.ts`, `sandbox/trace-tree.test.ts`. CLI/UI: `rpc/trace-hub.test.ts`, `web/agent-api.test.ts`, `testing/web-api.test.ts` (spawns the built CLI with `--web --mock`), `packages/ui/src/store/model.test.ts`.

Live testing: for new runtime features, also drive the built CLI against fixture spaces with a real model and inspect the `--trace` NDJSON — unit tests miss model-behavior and end-to-end integration issues. For a **keyless** deterministic variant, drive a real `Session` (or the CLI via `--mock`) with the scripted mock provider: `testing/mock-session.test.ts` covers budget caps, `progress()`, `solve` escalation, per-role models, and the bug-fix scenarios end-to-end through the turn loop; `testing/harness-features.test.ts` covers the value-yielding globals and orchestration end-to-end (`ask`/`inspect`/`loadKnowledge`/`sleep`/`fork` roles + parallel binding/`tasklist` DAG/`delegate`/`registerSpace`/system spaces/history summarization); and `packages/cli/src/testing/keyless-cli.test.ts` does the same at the CLI level (subprocess + `--mock`).

CLI integration suites (`packages/cli/src/testing/`) spawn the **built** CLI and assert on the `--trace` NDJSON; they self-skip when `dist/` is absent (run `pnpm build` first) and stream the subprocess output live. Saved traces land in `packages/cli/.live-traces/` (gitignored).
- `keyless-cli.test.ts` — mock provider, no API keys, deterministic.
- `web-api.test.ts` — spawns the CLI with `--web --mock`, drives the agent HTTP API + WS trace stream (tree, node detail, space-form ask round-trip). No keys.
- `live-llm.test.ts` — the **real model** (`M` = DeepSeek-V4-Pro for every scenario), gated behind `LM_LIVE=1`. Run: `LM_LIVE=1 pnpm vitest run packages/cli/src/testing/live-llm.test.ts`. Shared harness: `packages/cli/src/testing/live-harness.ts`.

Several suites spin up real QuickJS VMs (forks/delegates/solve) or spawn the CLI as a subprocess, so the global `testTimeout` is raised to 20s (`vitest.config.ts`). Under memory/CPU pressure the cross-file parallelism can still starve these — run `pnpm vitest run --no-file-parallelism` for a clean serial pass.

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
