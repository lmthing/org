---
name: debug-eval
description: Load when debugging the eval/yield pipeline, the turn loop, statement splitting, yield binding, or trace output.
---

# Skill: Debugging the Eval / Yield Pipeline

Use this when a run misbehaves inside the runtime itself: the model's statement failed to
split/typecheck/eval, a variable is "not defined", a yield never resolved or came back bound to the
wrong value, a fork/delegate/tasklist node ended in error, or the trace output doesn't say what you
expect. This skill is the **procedure**; the grounded explanation of every symptom and every tool
lives in `org/docs`.

## Read first (this is where the knowledge is)

- `org/docs/contributing/debugging.md` — the one event spine (`Tracer`) and its five readers.
  §1 every log line and what emits it · §2 the `--trace` NDJSON file + jq recipes · §3 the DevTools
  HTTP API (no browser) · §4 the browser DevPanel · §5 deterministic repro with `--mock` ·
  **§6 the failure playbook** (`X is not defined`, `unexpected token '<'`, `React is not defined`,
  space function not injected, component-props typecheck errors, `BudgetExceededError`, VM teardown) ·
  §7 a session on disk · §8 scenarios · §9 a live user pod.
- `org/docs/runtime/turn-loop.md` — what a yield *is* (§4) and **how it is serviced and bound** (§5:
  sequential batches, `MAX_SEQUENTIAL_YIELDS`, parallel `Promise.all` per batch, host-side
  `bindYieldResults`, `vm.getVar` winning over the raw resolved value), the yield router (§6),
  budgets/episodes (§7), error handling and retries (§8), the trace events emitted (§11), gotchas (§13).
- `org/docs/runtime/typecheck.md` — the per-statement gate: DTS composition, the function/component
  overlay, transpile, retry-on-type-error, forward-reference repair.
- `sdk/org/libs/cli/src/web/AGENT.md` — the agent-facing quickstart for the DevTools HTTP API.

## Procedure

**1. Reproduce with a trace.** Run the CLI headless and write the NDJSON spine:

```bash
cd sdk/org
node libs/cli/dist/cli/bin.js --space <spaceDir> --agent <slug> \
  --claude --trace /tmp/run.jsonl "<message>"
```

**2. Read the spine.** Histogram first, then the errored nodes — recipes in
`org/docs/contributing/debugging.md` §2:

```bash
jq -r '.type' /tmp/run.jsonl | sort | uniq -c
jq -c 'select(.type=="node_end" and .status=="error") | {nodeId, error}' /tmp/run.jsonl
```

**3. For anything deep in a tree** (a fork/delegate/tasklist that failed), run with `--web [port]`
(default 3000) and drive the HTTP API instead — `GET /api/help` is self-describing; `GET /api/state`
prints the ASCII execution tree, then `GET /api/node/<id>?tab=statements|llm` shows exactly what that
node wrote and what the model returned per attempt. Routes → debugging.md §3. Note: `lmthing serve`
writes **no** trace file — on a server/pod the spine is in-memory and read over HTTP.

**4. Match the symptom to the playbook** (debugging.md §6) before reading code. Nearly every eval/yield
failure is one of the entries there, each cited to the file and line that causes it.

**5. Pin it down deterministically** with `--mock <file>` / `LM_MOCK=<file>` (scripted `streamFn`, no
API key, no nondeterminism) → debugging.md §5. When hunting a genuine QuickJS handle leak, set
`LM_QJS_DEBUG=1` to load the assertion-tracking debug WASM.

**6. Inspect the generated artifacts** when the failure is in the typecheck gate:

```ts
// print the per-agent overlay DTS the model is checked against
import { loadSpace, getAgentFunctions, getAgentComponents, buildOverlay } from '@lmthing/core';
const space = await loadSpace('<spaceDir>');
const agent = space.agents['<slug>']!;
console.log(buildOverlay(getAgentFunctions(space, agent), getAgentComponents(space, agent)));
```

`transpileStatement` (JSX → `React.createElement`) is **not** re-exported from the package index —
import it from `sdk/org/libs/core/src/typecheck/transpile.ts` if you need to print transpiled JS.
To see VM state after an eval, add a temporary `console.log(vm.getScope())` in `turn-loop.ts`.

**7. Write the test.** No fix is done until a test would have caught it →
`org/docs/contributing/testing.md`. Run from `sdk/org` (`pnpm test <path>`), never the repo root.

## Keep the docs true

GROUND TRUTH IS THE CODE. If you change the implementation, update the matching org/docs page in the
same change (see `org/docs/SYNC.md`).
