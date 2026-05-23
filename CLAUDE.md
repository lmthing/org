# CLAUDE.md — sdk/org

This is a **git submodule** (`lmthing/org`) containing the open-source packages that power the LMThing agent runtime. It is a self-contained pnpm monorepo.

---

## Packages

| Package | Name | Purpose |
|---------|------|---------|
| `llm-repl/` | `@lmthing/llm-repl` | Core runtime: QuickJS sandbox, 11 capability layers (L0–L10), session assembly, context reconstruction |
| `llm-repl-cli/` | `@lmthing/llm-repl-cli` | CLI binary (`llm-repl`), orchestration router, providers, Ink/web renderers, RPC server |
| `repl/` | `@lmthing/repl` | **Legacy** — kept running until parity; deleted in Phase 13 cutover |
| `cli/` | `lmthing` | **Legacy** — kept running until parity; deleted in Phase 13 cutover |
| `ui/` | `@lmthing/thing-ui` | React components for the web view render surface (consumed by `cli` via path alias) |

`llm-repl` is the standalone core runtime (no CLI, no renderer) — embeddable in a browser app. `llm-repl-cli` bundles it inline at build time along with the Ink terminal renderer and WebSocket server.

---

## Architecture

The runtime is a **QuickJS WASM sandbox** executing TypeScript. An LLM streams tokens; each statement is type-checked by `tsc` strict before evaluation. Every `inspect()` call commits state to git and reconstructs the LLM context. The host router selects the model/role on each `post_inspect` event.

```
sdk/org/
├── llm-repl/                  — Core runtime (no CLI, no renderer)
│   src/
│   ├── lib/                   ← One directory per capability layer
│   │   ├── sandbox/           — L0: QuickJS isolate, boundary detector, capture rule, file blocks, trace.jsonl
│   │   ├── typecheck/         — L1: tsc strict, type inference, 3-retry loop, speculative execution
│   │   ├── inspect/           — L2: inspect(), budget tracking, context reconstruction
│   │   ├── checkpoint/        — L3: checkpoint(), rollback(), auto-settle
│   │   ├── fork/              — L4: fork(), resolve(), fork-scoped display slots
│   │   ├── memory/            — L5: pin(), compact(), expand(), auto-compact
│   │   ├── tasklist/          — L6: tasklist(), DAG enforcement, __tasks section
│   │   ├── io/                — L7: fetch() allowlist, fs.*, require()
│   │   ├── render/            — L8: display(), ask(), JSX descriptor tree, submit bridge
│   │   ├── snapshot/          — L9: base snapshots, scope re-seeding across sessions
│   │   └── spaces/            — L10: Space class, .d.ts overlay, knowledge preload
│   ├── session/               — Session assembly: git repo, scope.json, heap.bin, meta.json
│   ├── context/               — Context reconstruction, scope serializer, knowledge decay
│   ├── hooks/                 — Hook registry, executor, pattern matcher
│   ├── knowledge/             — Domain/field/option tree, decay tiers, loadKnowledge()
│   ├── security/              — JSX sanitizer
│   └── index.ts               — Assembles lib modules into a Session
└── llm-repl-cli/              — CLI binary + browser server
    src/
    ├── providers/             — Vercel AI SDK v6, provider:modelId resolution, model alias env vars
    ├── router/                — Orchestration router (ANALYZER + 13 routing rules)
    ├── cli/                   — Arg parsing, agent loop, TypeScript export classifier
    ├── rpc/                   — WebSocket server, RPC client, session event stream
    └── index.ts
```

Each `lib/{name}/` directory is self-contained: implementation, unit tests, and an `eval/` subdirectory with a real LLM interaction dataset (`dataset.jsonl`), a grader (`grade.ts`), and per-alias prompt variants (`xs.md`, `s.md`, `m.md`, `m_r.md`, `l.md`, `l_r.md`).

---

## Workspace Config

```
sdk/org/
├── llm-repl/
├── llm-repl-cli/
├── spaces/        (runtime directories, not packages — loaded via --space flag)
│   └── research/  — deep_research flow (3 steps, 8-node DAG)
├── cli/           (legacy)
├── repl/          (legacy)
├── ui/            (legacy, consumed via path alias)
└── pnpm-workspace.yaml   # declares: cli, repl, llm-repl, llm-repl-cli
```

---

## Build

Both new packages build with **tsup**.

```bash
# From sdk/org/llm-repl/
pnpm build          # tsup → dist/index.js + .d.ts
pnpm eval           # run layer eval suite (--lib <layer> --model <ALIAS>)

# From sdk/org/llm-repl-cli/
pnpm build          # tsup → dist/index.js + dist/bin.js
pnpm fetch-prices   # download latest Azure retail prices → prices.json
```

**Build outputs:**

| Package | Entry | Output |
|---------|-------|--------|
| `llm-repl` | `src/index.ts` | `dist/index.js` + `.d.ts` |
| `llm-repl-cli` | `src/index.ts` | `dist/index.js` + `.d.ts` |
| `llm-repl-cli` | `src/cli/bin.ts` | `dist/bin.js` (executable: `llm-repl`) |

Always build `llm-repl` before `llm-repl-cli` when making changes to both.

**Legacy packages** (`repl/`, `cli/`) still build independently — do not modify them until Phase 13 cutover.

---

## Testing

```bash
pnpm test           # run all tests across all packages
pnpm test:watch     # watch mode
pnpm typecheck      # tsc --noEmit
```

Test framework: **Vitest**. Each `lib/<layer>/` has a co-located `<layer>.test.ts`. The eval runner is at `llm-repl/scripts/eval.ts`.

**Eval model aliases** (resolved from env vars `LM_MODEL_<ALIAS>`):

| Alias | Class |
|-------|-------|
| `XS` | Classification / boolean decisions |
| `S`  | Fast code gen, short sessions |
| `M`  | Multi-step code, task graphs |
| `M_R` | M + reasoning |
| `L`  | Full spec coverage, long sessions |
| `L_R` | L + reasoning |

---

## Key Entry Points

| Entry | File | Use |
|-------|------|-----|
| `createSandboxSession()` | `llm-repl/src/lib/sandbox/quickjs.ts` | Boot a QuickJS isolate for a session |
| `inspect()` | `llm-repl/src/lib/inspect/index.ts` | Yield primitive: abort stream → git commit → context reconstruct |
| `Session` (assembly) | `llm-repl/src/session/assembly.ts` | Assembles git repo, scope.json, heap.bin, meta.json |
| `reconstruction` | `llm-repl/src/context/reconstruction.ts` | Priority-ordered context sections → single `role: "user"` message |
| `Space` | `llm-repl/src/lib/spaces/index.ts` | L10 — Space class, .d.ts overlay, class deletion cascade |
| Router | `llm-repl-cli/src/router/router.ts` | ANALYZER + 13 routing rules, fires at `new_message` / `post_inspect` |
| `BudgetTracker` | `llm-repl/src/lib/inspect/budget.ts` | Token + dollar cost tracking per session; accepts `ModelPricing` |
| `loadModelPricing()` | `llm-repl-cli/src/session/session.ts` | Loads per-model prices from `prices.json` at session start |

---

## Model Orchestration (Router)

The router in `llm-repl-cli/src/router/` fires at two points:

1. **`new_message`** — always runs `ANALYZER` (XS, single-turn) to classify difficulty, then selects a planner role
2. **`post_inspect`** — first-match routing rules select the executor role; may escalate to `RECOVERY`

Routing decisions are logged to `trace.jsonl` as `router_decision` events and never injected into the executor context. Context flags (`budget_warning`, `heap_warning`, `recovery_context`) inject specific blocks into context reconstruction.

Roles: `ANALYZER` · `PLANNER_SHALLOW` · `PLANNER_STANDARD` · `PLANNER_DEEP` · `EXEC_TRIVIAL` · `EXEC_STANDARD` · `EXEC_COMPLEX` · `RECOVERY`

---

## Provider Resolution

Providers are resolved in `llm-repl-cli/src/providers/`. Uses **Vercel AI SDK v6 (`streamText()`)**.

Supported: `openai/*`, `anthropic/*`, `google/*`, `azure/*`, `groq/*`, `mistral/*`, `cohere/*`, `bedrock/*`, or any OpenAI-compatible endpoint.

Model aliases resolved from `LM_MODEL_{ALIAS}` env vars. `-R` suffix enables extended thinking via `providerOptions`.

**Active model assignments** (Azure deployments on `lmthing-resource`, swedencentral):

| Alias | Model | Role |
|-------|-------|------|
| `XS` | `azure:gpt-5.4-mini` | Classification, boolean decisions — cheapest |
| `S`  | `azure:gpt-4.1-mini` | Fast code gen, short sessions |
| `M`  | `azure:DeepSeek-V4-Flash` | Multi-step code, task graphs |
| `L`  | `azure:gpt-5.4` | Full spec coverage, long sessions |
| `M_R` | `azure:grok-4-1-fast-reasoning` | M + reasoning (recovery, replanning) |
| `L_R` | `azure:Kimi-K2.6` | L + reasoning (deep planning, forks) |

## Pricing

Per-model prices are stored in `llm-repl-cli/prices.json` and loaded at session start by `loadModelPricing()`. The `BudgetTracker` uses them to accumulate `inputTokensUsed`, `outputTokensUsed`, and `costUsd` as API calls are made.

**Current prices (GlobalStandard, swedencentral, per 1K tokens):**

| Model | Input | Output |
|-------|-------|--------|
| `gpt-5.4-mini` | $0.000250 | $0.002000 |
| `gpt-4.1-mini` | $0.000400 | $0.001600 |
| `DeepSeek-V4-Flash` | $0.000190 | $0.000510 |
| `gpt-5.4` | $0.001250 | $0.010000 |
| `grok-4-1-fast-reasoning` | $0.000200 | $0.000500 |
| `Kimi-K2.6` | $0.000950 | $0.004000 |
| `DeepSeek-R1-0528` | $0.001350 | $0.005400 |

Run `pnpm fetch-prices` from `llm-repl-cli/` to refresh prices from the Azure retail API. To add a new model, append an entry to `MODEL_MAP` in `scripts/fetch-prices.ts` and re-run.

**Session cost logging** — `session.ts` logs to stderr after every cycle:
```
  cost: $0.000423 cycle · $0.000814 total
```
and at session end:
```
── session complete · 3 cycles · $0.001237 total cost ──
```

`budget()` inside the sandbox also exposes `costUsd`, `inputTokensUsed`, and `outputTokensUsed` so the running model can observe its own spend.

---

## Capability Layer Summary

| Layer | Global(s) | Key contract |
|-------|-----------|-------------|
| L0 `sandbox` | — | QuickJS isolate; boundary detector (TS scanner); Capture Rule; file blocks; `trace.jsonl` |
| L1 `typecheck` | — | tsc strict; 3-retry on error; speculative buffer for `await`; annotation grace |
| L2 `inspect` | `inspect()` `budget()` | Aborts stream; awaits passed Promises; git commit; context reconstruction |
| L3 `checkpoint` | `checkpoint()` `rollback()` | git tag + heap.bin savepoint; auto-settle; count-mode rollback via `trace.jsonl` |
| L4 `fork` | `fork()` `resolve()` | Fresh QuickJS on git branch; fork-scoped display; `inject()` for parent-routed `ask()` |
| L5 `memory` | `pin()` `unpin()` `compact()` `expand()` | Dotted-path support; auto-compact under context pressure |
| L6 `tasklist` | `tasklist()` | DAG enforcement; `condition` grammar; `outputSchema` validation; `__tasklist_nudge` |
| L7 `io` | `fetch()` `fs.*` `require()` | Domain allowlist; pre-buffered response; FS sandboxed to `/session/{id}/files/` |
| L8 `render` | `display()` `ask()` | Descriptor tree; stable-id replace; 5-min `ask()` timeout; `SessionEnded` fallback |
| L9 `snapshot` | — | `baseSnapshot` reuse; skip path when heap > 64MB |
| L10 `spaces` | `Space` | `new Space()` / `Space.current()` / `Space.load()`; .d.ts overlay; class deletion cascade |

---

## Submodule Notes

- This directory is a git submodule. Changes here are committed separately from the parent monorepo.
- The parent repo references this submodule at `sdk/org/` — update the parent's submodule pointer after committing here.
- The parent `pnpm-workspace.yaml` picks up `sdk/org/llm-repl` and `sdk/org/llm-repl-cli` directly.

---

## Detailed Reference

| Topic | Document |
|-------|----------|
| v4.3 spec: full architecture, API, contracts, trace events | [NEW_ARCHITECTURE.md](NEW_ARCHITECTURE.md) |
| Implementation plan: phases L0–L10 + router + CLI cutover | [PLAN.md](PLAN.md) |
| Self-growing THING agent plan (repl package) | [repl/PLAN.md](repl/PLAN.md) |
| Legacy agent system, hooks, session lifecycle, spaces | [cli/CLAUDE.md](cli/CLAUDE.md) |
| Legacy neural harness model, cognitive loop | [repl/README.md](repl/README.md) |
