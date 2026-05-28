# LMThing — Developer Guide

LLM agent runtime where models drive programs by writing TypeScript. The model streams TS statements; the host evaluates them one at a time in a QuickJS WASM sandbox. Value-yielding calls (`ask`, `sleep`, `tasklist`, `fork`, `delegate`, `inspect`, `loadKnowledge`) abort the stream, hand control to the host, and resume the next turn with resolved values injected as a VARIABLES block.

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
```

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
  sandbox/     quickjs.ts host-bridge.ts boundary.ts    ← VM + marshalling + statement splitting
  eval/        turn-loop.ts yield.ts error-rewind.ts     ← the execution engine
  typecheck/   tsc.ts library-dts.ts overlay.ts transpile.ts
  globals/     ask.ts sleep.ts display.ts inspect.ts fork.ts delegate.ts tasklist.ts load-knowledge.ts serialize.ts
  spaces/      load.ts frontmatter.ts agent.ts components.ts
  tasklist/    dag.ts orchestrator.ts condition-dsl.ts schema.ts
  fork/        fork.ts
  delegate/    delegate.ts registry.ts
  context/     history.ts system-block.ts variables.ts summarize.ts
  session/     session.ts snapshot.ts types.ts

packages/cli/src/
  providers/   resolve.ts aliases.ts
  stream/      stream.ts
  render/      ink-renderer.tsx
  rpc/         server.ts events.ts
  cli/         bin.ts args.ts

packages/ui/src/
  client/      rpc-client.ts useReplSession.ts
  components/  DisplayBlock.tsx AskBlock.tsx VariablesBlock.tsx
```

## Key Invariants

- Each `evalStatement(code)` call is an isolated ES module. Variables do not persist between evals — the turn loop appends `globalThis['x'] = x` assignments after each statement so the next module can read them as globals.
- `accumulatedContext` in the turn loop persists across yield continuations (variables stay in typecheck scope). Only error retries start fresh.
- JSX in model output is transpiled to `React.createElement(...)` via `transpileStatement()` before VM eval. A React shim and component stubs are injected at session start.
- Space functions are transpiled and evaled as scripts (not modules) in the VM via `evalScript()`, binding to `globalThis`.
- The QuickJS VM uses sync `evalCode` + manual `executePendingJobs` loop — NOT `evalCodeAsync`, which deadlocks when awaiting user input.
- `.env` is loaded from `process.cwd()` only (where the script is run, not the package dir).

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

## Fixtures

Two reference spaces for end-to-end testing:

- `fixtures/cooking/` — chef agent with form components, view components, space functions, tasklist DAG
- `fixtures/sommelier/` — pairing agent with delegation target

See `@.claude/arch/spaces.md` for space file layout.

## Tests

Tests are co-located: `packages/core/src/**/*.test.ts`. Run with `pnpm test`.

Current coverage: `boundary.test.ts`, `serialize.test.ts`, `condition-dsl.test.ts`, `tsc.test.ts`.

No linting or formatting config — TypeScript strict mode is the sole quality gate.

## Skills

Load these when working on specific areas:

- Adding a new value-yielding global → `@.claude/skills/new-global.md`
- Adding a new AI provider → `@.claude/skills/new-provider.md`
- Creating or modifying a space → `@.claude/skills/new-space.md`
- Debugging the eval/yield pipeline → `@.claude/skills/debug-eval.md`
- Writing tests for core modules → `@.claude/skills/writing-tests.md`

## Architecture References

- Turn loop + yield protocol (deep) → `@.claude/arch/turn-loop.md`
- Typecheck + transpile + DTS overlay pipeline → `@.claude/arch/typecheck.md`
- Spaces: loading, validation, agent config → `@.claude/arch/spaces.md`
- Fork + tasklist orchestration → `@.claude/arch/fork-tasklist.md`
- Delegate + registry → `@.claude/arch/delegate.md`
