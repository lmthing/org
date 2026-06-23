---
name: debug-eval
description: Load when debugging the eval/yield pipeline, the turn loop, statement splitting, yield binding, or trace output.
---

# Skill: Debugging the Eval / Yield Pipeline

## Reading the Log Output

The CLI logs each step. A healthy session looks like:

```
[turn 1] streaming...
[stmt] const dish = await ask(<ConfirmDish dish="pasta" />);   ← statement detected + typechecked + evaled
[model response]
const dish = await ask(<ConfirmDish dish="pasta" />);           ← full model output
[/model response]
Input                                                           ← Ink form rendered
> yes
[variables] dish                                                ← yield resolved, VARIABLES appended
[turn 1] streaming...                                           ← attempt resets to 0, new turn
```

Error paths:
- `[error] Cannot find name 'X'` — typecheck failure; model retries
- `[error] X is not defined` — VM runtime error; variable missing from globalThis
- `[error] [object Object]` — VM error not properly formatted (check `quickjs.ts` error extraction)
- `[warn] failed to inject function "X"` — space function transpile/eval failed

## Common Issues

### "X is not defined" on a variable from a previous statement

`const x = foo(); bar(x);` — two separate module evals. `x` in module A is invisible to module B.

**Fix in turn-loop.ts**: after each successful `evalStatement`, the code appends `globalThis['x'] = x` to the same module eval. This is driven by `extractBindingNames(stmt)`. If the variable name isn't being extracted (e.g. destructuring pattern), extend `extractBindingNames` in `context/variables.ts`.

### "X is not defined" on a yield-resolved variable in the next turn

`const x = await ask(...)` yields. Next turn: `use(x)` → "x is not defined".

**Cause**: `accumulatedContext` was inside the while loop and reset on every iteration. **Fix**: `accumulatedContext` must be declared outside the while loop in `turn-loop.ts`.

After a yield, the turn loop:
1. Calls `vm.setVar('x', resolved)` → injects into VM globalThis
2. Adds the yielding statement to `accumulatedContext` → typechecker sees `const x = await ask(...)`
3. Sets `attempt = 0; continue` → loops, using the preserved `accumulatedContext`

### JSX "unexpected token '<'"

The VM received raw JSX. The turn loop must call `transpileStatement(stmt)` before `vm.evalStatement(jsCode)`.

`transpileStatement` uses `ts.transpileModule` with `jsx: React, jsxFactory: React.createElement`. The output is plain JS with `React.createElement(...)` calls.

### `React is not defined` / `ComponentName is not defined`

The React shim and component stubs must be injected into the VM before any model code runs.

In `session.ts`:
- `injectJSXRuntime(componentNames)` sets `globalThis.React = { createElement: ... }` and `globalThis.ComponentName = { displayName: 'ComponentName' }` for each space component.
- This runs after `createVM()` and `injectGlobals()`, once the agent's components are known.

### Space function not available

`session.ts:injectSpaceFunctions(agentFunctions)` is called after `getAgentFunctions(space, agent)`. Check:
1. The function name is listed in `agents/<slug>/instruct.md` frontmatter under `functions:`.
2. The file `functions/<name>.ts` exists and exports a function with the exact same name.
3. The `[warn] failed to inject function` log message — it will show the actual transpile error.

### Typecheck error on a component's props

The DTS overlay (`overlay.ts`) extracts `interface Props` from the component source and renames it to `<ComponentName>Props`. All function-typed members are made optional (callbacks are injected by the runtime).

If a required data prop is missing, the typecheck error is correct — the model should pass it. If all props are being flagged as missing, check that the component source has an `interface Props` declaration (not a `type Props = ...`).

## Debugging Tools

**Print the generated overlay DTS:**
```typescript
import { buildOverlay } from '@repl/core';
import { getAgentFunctions, getAgentComponents, loadSpace } from '@repl/core';

const space = await loadSpace('./fixtures/cooking');
const agent = space.agents['chef']!;
const fns = getAgentFunctions(space, agent);
const comps = getAgentComponents(space, agent);
console.log(buildOverlay(fns, comps));
```

**Print transpiled JS for a statement:**
```typescript
import { transpileStatement } from '@repl/core';
console.log(transpileStatement('const x = await ask(<ConfirmDish dish="pasta" />);'));
```

**Inspect VM state after an eval:**
Add temporary `console.log(vm.getScope())` calls in `turn-loop.ts` after `evalStatement`.

## Live observability (the fastest way to debug a real run)

Every run emits a hierarchical trace spine (`sandbox/trace.ts`): each scope
(session→run→fork→delegate→tasklist→task→solve) is a node with `nodeId`/`parentId`,
and per-node statements / LLM requests+responses (with retry `attempt`) / yields /
variables / errors. Two ways to read it:

**Headless via the web agent API** — `--web <port>` then `curl` (no browser):
```bash
node packages/cli/dist/cli/bin.js --space ./fixtures/architect --agent architect \
  --model M --claude --web 3480 --trace /tmp/run.jsonl &
curl -s -X POST localhost:3480/api/message -d '{"content":"…"}' -H 'content-type: application/json'
curl -s localhost:3480/api/state                              # ASCII tree: status/duration/retries
curl -s "localhost:3480/api/node/<forkId>?tab=statements"     # the exact code a failing fork emitted
curl -s "localhost:3480/api/node/<forkId>?tab=llm"            # its raw model responses per attempt
curl -s "localhost:3480/api/events?since=<seq>"               # incremental tail
```
This is the quickest way to see WHY a fork failed (e.g. "no resolve called" → open its
`statements`/`llm` tab to find the model wrote prose, or a multi-line `function` decl that
the boundary detector split into "Function implementation is missing"). Full API: `packages/cli/src/web/AGENT.md`.

**From a `--trace` file with jq** (or replay it in the browser at `?trace=/trace.jsonl`):
```bash
jq -r '.type' /tmp/run.jsonl | sort | uniq -c                                  # event histogram
jq -rc 'select(.type=="llm_response" and (.context|test("fork:"))) | {attempt, text: .text[0:200]}' /tmp/run.jsonl
jq -c 'select(.type=="node_end" and .status=="error") | {nodeId, error}' /tmp/run.jsonl
```
Note: `llm_progress` is subscriber-only (never written to the file). `buildTraceTree(events)`
(`@repl/core`) rebuilds the whole tree from a parsed trace array for programmatic inspection.

## The Yield Protocol Step-by-Step

1. Model outputs: `const x = await ask(<Foo />);`
2. BoundaryDetector yields the statement as complete.
3. `runTsc(...)` validates the statement (JSX type, arg shape). If error → retry.
4. `transpileStatement(stmt)` → `const x = await ask(React.createElement(Foo, {}));` + `globalThis['x'] = x;`
5. `vm.evalStatement(jsCode)` — sync eval. The module dispatches, hits `await ask(...)`.
6. `ask(...)` calls `pushYield({ kind: 'ask', args: [id, descriptor], deferred: { resolve, reject } })`.
7. `drivePendingJobs()` runs — sees `pendingYields.length > 0`, returns immediately.
8. `evalStatement` returns `{ ok: true }`.
9. Turn loop detects `pendingYields.length > 0` → sets `pendingYield`, aborts stream.
10. `processYield(yieldReq)` calls `renderHost.ask(id, descriptor)` → awaits user input.
11. `yieldReq.deferred.resolve(userValue)` → VM promise resolves (microtask).
12. `await Promise.resolve()` — flushes microtask queue.
13. `vm.drivePendingJobs()` — runs VM continuation. The `globalThis['x'] = x` line executes, binding `x`.
14. `vm.setVar('x', userValue)` — also sets it directly for safety.
15. `emitVariables({ x: userValue })` → appends VARIABLES block to history.
16. `attempt = 0; continue` → new turn with `accumulatedContext` containing the yield statement.
