# Architecture: Turn Loop + Yield Protocol

## Files

- `libs/core/src/eval/turn-loop.ts` — main loop
- `libs/core/src/eval/yield.ts` — `YieldRequest` type
- `libs/core/src/eval/error-rewind.ts` — error block formatting
- `libs/core/src/sandbox/boundary.ts` — statement splitter
- `libs/core/src/typecheck/transpile.ts` — JSX/TS → JS

## The Loop

```
outer: while (attempt < maxRetries)
  attempt++
  stream = streamFn(system, history)
  detector = new BoundaryDetector()

  for each chunk in stream.textStream:
    statements = detector.feed(chunk)
    for each stmt:
      tscResult = runTsc(ambientDts, accumulatedContext, stmt)
      if tscResult error → abort stream, set turnError, break

      boundNames = extractBindingNames(stmt)
      jsCode = transpileStatement(stmt)
      jsCode += "globalThis['x'] = x;" per bound name
      evalResult = vm.evalStatement(jsCode)
      if evalResult error → abort stream, set turnError, break

      if vm.pendingYields.length > 0:
        pendingYield = last yield
        yieldingStatement = stmt
        abort stream, break

      accumulatedContext += stmt

  // flush remaining buffer
  trailing = detector.flush()
  // same tsc → transpile → eval for trailing

  // append assistant message to history
  history.append(assistantContent)

  if turnError:
    history.append(buildErrorBlock(failingStmt, err, attempt, maxRetries))
    if attempt >= maxRetries → return 'error'
    continue  // retry (accumulatedContext unchanged — stale statements NOT removed)

  if pendingYield:
    resolvedValues = []
    for each yield in vm.pendingYields:        // may be >1 (Promise.all of forks)
      resolved = await processYield(yieldReq)
      yieldReq.deferred.resolve(resolved)
      resolvedValues.push(resolved)
      await Promise.resolve()                  // flush microtasks
    vm.drivePendingJobs()
    // Map results onto the binding pattern (the post-await continuation does NOT
    // re-run in sync eval, so the host binds): extractBindingPattern(stmt) →
    //   simple  → variables[name] = (single value | the array for Promise.all)
    //   array   → positional from the resolved-values array
    //   object  → by key from the single resolved object
    // then vm.setVar(name, value) for each.
    accumulatedContext += yieldingStatement
    history.append(emitVariables(variables))
    attempt = 0
    continue  // new turn — accumulatedContext persists!

  if !hadStatements → return 'done'
  return 'done'
```

## Key Variables

| Variable | Scope | Reset on? | Purpose |
|----------|-------|-----------|---------|
| `attempt` | outer | yield (`= 0`) | retry counter |
| `accumulatedContext` | outer | never | typecheck context for current session |
| `detector` | inner | every iteration | statement buffering |
| `pendingYield` | inner | every iteration | pending yield from this turn |
| `yieldingStatement` | inner | every iteration | the stmt that caused yield |
| `turnError` | inner | every iteration | error from this turn |

`accumulatedContext` is deliberately **outside the while loop** so yield-resolved variables stay in typecheck scope across turns.

## Error Rewind

On typecheck or runtime error:
1. The failing statement is NOT added to `accumulatedContext` (rewind).
2. `buildErrorBlock(stmt, err, attempt, maxRetries)` → a synthetic `user` message like:
   ```
   ERROR (attempt 2 of 3)
   Failing statement:
   // const x = badCall();
   Error: badCall is not defined
   ```
3. Model gets this in history on the next turn and regenerates.
4. After `maxRetries` failures → `return 'error'`.

## Stream Abort

When a yield or error is detected mid-stream, `stream.abort()` is called. The `for await` loop catches an `AbortError` — this is expected and swallowed. Any chunks already buffered in `detector` are flushed.

A NON-abort stream error (a dropped/"terminated" provider connection) that produced no statements is **retried**, not treated as completion: `streamErrored && !hadStatements && !aborted` re-issues the request (within `maxRetries`, with a short backoff) instead of returning `'done'`. Without this, one flaky stream silently strands the whole run (it looked identical to "the model finished").

## Module Isolation and globalThis

Each `vm.evalStatement(code)` call uses `ctx.evalCode(code, '_session.tsx', { type: 'module' })`. Module scope is isolated — variables declared in module A are not visible in module B.

**Workaround**: after each successful non-yield eval, the code appends:
```javascript
try { globalThis['x'] = x; } catch {}
```
for each name extracted by `extractBindingNames(stmt)` (the `try/catch` form propagates even `undefined` values). This makes the variable accessible from any subsequent module.

After a yield resolves, the post-`await` continuation does **not** re-run in this sync eval model, so it does NOT bind the variable. Binding is done entirely host-side: the turn loop maps the resolved value(s) onto the statement's binding pattern (`extractBindingPattern`) and calls `vm.setVar(name, value)` (which `marshalToQuickJS`-sets on `ctx.global` and records the host scope). This is what makes parallel `Promise.all([fork(),fork()])` and `const {a,b} = await ask()` bind correctly.

## Sync eval vs. evalCodeAsync

The VM uses sync `ctx.evalCode` (NOT `evalCodeAsync`). `evalCodeAsync` deadlocks when the VM awaits a host promise that only resolves after user input — it blocks the Node.js event loop indefinitely.

With sync `evalCode`:
1. The module dispatches synchronously.
2. If it hits `await ask(...)`, the VM creates a pending job and returns.
3. `drivePendingJobs()` runs pending jobs one at a time. After each batch, checks `pendingYields.length`. When a yield is detected, returns immediately.
4. The host processes the yield externally, then calls `yieldReq.deferred.resolve(value)` → VM resumes via microtask.

After draining jobs (and only when no yield is pending), `evalStatement` inspects the module's evaluation promise via `getPromiseState`: a top-level `await` that throws (e.g. `await missingGlobal()`) rejects that promise, which `executePendingJobs` would otherwise swallow as an unhandled rejection — so it is surfaced as a turn error instead of silently continuing.

## Invariants / gotchas

- **`accumulatedContext` persists across yield continuations** (variables stay in typecheck scope). Only error retries start fresh — and even then the stale statements are NOT removed from `accumulatedContext`.
- **The turn loop drops narrated prose.** `looksLikeProse(stmt)` detects a natural-language sentence the model emitted instead of code (e.g. "Based on the query, I will…") and skips it — it never parses as TS, so dropping it (like a stray fence tag) avoids burning a retry on a guaranteed typecheck error. Conservative: bails on any code punctuation and requires an English function word — but ALSO flags apostrophe contractions ("I'll start by…"). The boundary detector cooperates: it won't carve a bare identifier (`I`) out of an apostrophe prose line, surfacing the whole line so the drop can catch it. The system prompts tell the model to narrate inside `// comments` (comments are valid TS), not as bare prose.
- **Budget near-limit nudge.** `Budget.nearLimitWarning()` (`eval/budget.ts`) returns a "wrap up and resolve now" message when within ~2 episodes / ≥80% of the tool-call or wall-clock cap (null otherwise); the turn loop appends it to the VARIABLES block after each yield resolves, so a model approaching a limit is told to finish before the hard `BudgetExceededError` fires.
- **Yield errors surface to the model instead of binding `undefined`.** When a `processYield` throws a non-budget error (e.g. `delegate()` to a hallucinated space key, a space function that errored), the turn loop injects it as a normal retryable turn error (with the actionable message) so the model self-corrects — rather than silently binding `undefined`. Hard caps (`BudgetExceededError`) still short-circuit; on the final attempt it falls through to bind `undefined` so the run can still limp forward. (The `DelegateRegistry` error lists the real space keys + agent slugs, so a hallucinated key self-corrects on the next attempt.)
- **The continuation nudge fires after ANY non-yielding *call* binding, not just `await` ones.** Sync space functions (`writeTaskFile`/`validateSpace`/`listScaffoldedSpaces`) bind a result without `await`; a model that stops right after one is stranded mid-program. `lastStmtNonYieldBinding` = bound a value AND the statement contains a call — so the runtime re-prompts (bounded by `maxContinueNudges`, default 4) to finish validate→register→delegate. Literal bindings (`const x = 5`) don't nudge.
