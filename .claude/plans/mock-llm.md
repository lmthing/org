# Plan: Mock LLM Mechanism (test without API keys)

Status: proposed
Branch: `claude/agentic-framework-paper-ideas-CGzXp`
Goal: run the runtime end-to-end — including the live-testing plan's Phase 1–4 and
`solve` scenarios — with **no provider credentials**, by injecting a scripted
`streamFn` instead of calling the AI SDK.

## Why this is the right seam

The model is reached through exactly one function, injected at the `Session`
boundary and threaded unchanged into every fork and delegate:

```
streamFn: (opts: StreamOpts) => Promise<StreamSession>
  StreamOpts    = { system, messages, model? }
  StreamSession = { textStream: AsyncIterable<string>, abort() }
```

- `packages/cli/src/cli/bin.ts:127` builds the real `streamFn` from `resolveModel` +
  `createStream` (the AI SDK). That is the **only** place credentials are used.
- `session.ts` passes the same `streamFn` to the turn loop, `ForkEngine`, and
  `runDelegate` (verified: `session.ts:104/180/248/321/485`, `fork.ts:275`,
  `delegate.ts:180/191`). One mock therefore covers session + forks + delegates.
- The turn loop calls `streamFn` once per episode and treats the emitted text as the
  model's TypeScript program. A mock just emits scripted TS strings.
- Crucially, `streamFn` is **upstream of the tracer** — the `llm_request` /
  `llm_response` / `yield` events still fire, so every `jq` assertion in
  `live-testing.md` §2 works unchanged against mock runs. Only the *content* is
  scripted; the wiring is real.

`packages/core/src/eval/turn-loop-yield.test.ts:13` already has a one-shot
`scriptedStream` helper — this plan generalizes that into a reusable, multi-turn,
fork-aware mock and exposes it from the CLI.

## Design

A mock is a `streamFn` driven by a **handler**:

```ts
type MockHandler = (opts: StreamOpts, ctx: { callIndex: number })
  => string | string[] | AsyncIterable<string>;
```

The handler inspects the incoming prompt (`opts.system`, `opts.messages`,
`opts.model`) and returns the TypeScript the "model" should emit for that turn.
Returning `string[]` emits the chunks in sequence (to exercise streaming/parsing);
returning a string emits it whole. `callIndex` increments per `streamFn` call so a
handler can branch on turn number.

Discriminating forks/delegates from the main loop: the handler sees the full
`system` block (forks carry the role preamble) and the user `messages` (forks carry
their `instruction`, `solve` retries carry the verifier feedback). Matching on those
strings is how a mock returns a fork's answer vs. the orchestrator's next step.

Three builders cover the ergonomics, all returning a ready `streamFn`:

- `mockScript(turns: string[])` — sequential queue, one entry per call. Simplest;
  good for linear single-agent runs.
- `mockMatch(rules: { when: RegExp | (opts) => boolean; respond: MockHandler }[],
  fallback?)` — first matching rule wins. Robust when forks interleave with the
  main loop.
- `createMockStreamFn(handler)` — the raw escape hatch.

## Steps

### 1. Core test utility — `packages/core/src/testing/mock-provider.ts` (new)
- Implement `createMockStreamFn`, `mockScript`, `mockMatch` per the design above.
- Each returns `(opts) => Promise<StreamSession>`; the `textStream` is an async
  generator that yields the resolved chunks and honors `abort()` (mirror the
  existing `scriptedStream` abort flag at `turn-loop-yield.test.ts:13`).
- An empty/whitespace response ends the loop (the turn loop already treats
  "no statements" as done — `turn-loop.ts:260`), so a handler returns `''` to stop.
- Export the three builders + `MockHandler` type from `packages/core/src/index.ts`.

### 2. Unit tests — `packages/core/src/testing/mock-provider.test.ts` (new)
- `mockScript` drives a real `Session` over multiple `continue()` turns; assert the
  scripted statements are evaluated in order and the loop ends on `''`.
- `mockMatch` selects by `opts` (e.g. a fork instruction substring routes to the
  fork response while the default rule answers the orchestrator).
- `abort()` stops mid-stream without unhandled rejections.
- Reuse the minimal `RenderHost`/`SessionDeps` pattern from `session.test.ts`.

### 3. CLI wiring — `--mock <file>` flag (+ `LM_MOCK` env)
- `packages/cli/src/cli/args.ts`: add `--mock <path>` → `CliArgs.mock`; add a unit
  test in `args.test.ts`.
- `packages/cli/src/cli/bin.ts`: if `args.mock ?? process.env.LM_MOCK` is set, build
  `streamFn` by dynamically `import()`ing that module instead of calling
  `resolveModel`/`createStream`. **Skip `resolveModel` entirely in mock mode** so no
  key is required. The mock module's default export is a `MockHandler` (or an array
  → wrapped in `mockScript`); wrap it with `createMockStreamFn` and pass to all three
  `new Session(...)` sites in place of the live `streamFn`.
- Mock files are authored as plain ESM (`.mjs`) so they load with no transpile step;
  the scripted TS lives inside them as ordinary strings. Document this.

### 4. Mock fixtures for the live-testing scenarios — `fixtures/*/mock.mjs`
Make `live-testing.md` runnable without keys. Author a mock per phase:
- `fixtures/solver/mock.mjs` — `mockMatch`: when the user message contains the
  verifier feedback marker, emit a *correct* `work/candidate.ts` (passes the tsc
  `verifyCommand`); otherwise emit a deliberately broken candidate. This drives
  3A (pass first try, separate mock), 3B (one retry → `rung:1`), and 3C
  (race) deterministically.
- `fixtures/engineer/mock.mjs` — a handler that emits a tool-call-producing statement
  every turn so the budget caps (Phase 1: episodes / tool-calls) trip on schedule,
  and a `progress()` call for Phase 2.
- Keep them tiny and commented; they double as worked examples of the mock API.

### 5. `scripts/live-test.sh` (closes live-testing.md §9)
- A wrapper that runs each scenario with `--mock fixtures/<space>/mock.mjs --trace`,
  captures exit code + stderr, and asserts on the trace with the §2 `jq` recipes.
- Because it uses mocks, it needs no credentials and can run in ordinary CI — the
  deterministic counterpart to the credentialed live runs.

### 6. Docs
- CLAUDE.md: add `--mock <file>` / `LM_MOCK` to the CLI invocation list and a one-line
  "Testing without keys" note pointing at `packages/core/src/testing/mock-provider.ts`.
- `.claude/skills/`: a short note (or extend `writing-tests.md`) on driving a full
  `Session`/CLI run with a mock handler.

## What this explicitly does NOT change
- No change to `StreamOpts`/`StreamSession`, the turn loop, fork, or delegate — the
  mock is a drop-in `streamFn`. Zero production-path risk.
- The real provider path (`resolve.ts`, `createStream`) is untouched; mock mode is
  an alternate branch selected only when `--mock`/`LM_MOCK` is present.

## Verification
- `pnpm --filter @repl/core test` (new mock-provider tests green) + `pnpm typecheck`.
- `pnpm build`, then run a solver scenario with **no `.env`**:
  `node packages/cli/dist/cli/bin.js --space fixtures/solver --claude --mock fixtures/solver/mock.mjs --trace /tmp/t.jsonl "<task>"`
  and confirm the trace shows the expected `rung`/`attempts` and fork parallelism —
  i.e. the live-testing assertions pass against a keyless run.
