# Architecture: Turn Loop + Yield Protocol

## Files

- `packages/core/src/eval/turn-loop.ts` — main loop
- `packages/core/src/eval/yield.ts` — `YieldRequest` type
- `packages/core/src/eval/error-rewind.ts` — error block formatting
- `packages/core/src/sandbox/boundary.ts` — statement splitter
- `packages/core/src/typecheck/transpile.ts` — JSX/TS → JS

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
    for each yield in vm.pendingYields:
      resolved = await processYield(yieldReq)
      yieldReq.deferred.resolve(resolved)
      await Promise.resolve()         // flush microtasks
      vm.drivePendingJobs()           // run VM continuation
      vm.setVar(name, resolved)       // ensure globalThis binding
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

## Module Isolation and globalThis

Each `vm.evalStatement(code)` call uses `ctx.evalCode(code, '_session.tsx', { type: 'module' })`. Module scope is isolated — variables declared in module A are not visible in module B.

**Workaround**: after each successful non-yield eval, the code appends:
```javascript
if (typeof x !== 'undefined') globalThis['x'] = x;
```
for each name extracted by `extractBindingNames(stmt)`. This makes the variable accessible from any subsequent module.

After a yield resolves, `vm.setVar(name, resolved)` is also called directly as a backup (uses `marshalToQuickJS` to set on `ctx.global`).

## Sync eval vs. evalCodeAsync

The VM uses sync `ctx.evalCode` (NOT `evalCodeAsync`). `evalCodeAsync` deadlocks when the VM awaits a host promise that only resolves after user input — it blocks the Node.js event loop indefinitely.

With sync `evalCode`:
1. The module dispatches synchronously.
2. If it hits `await ask(...)`, the VM creates a pending job and returns.
3. `drivePendingJobs()` runs pending jobs one at a time. After each batch, checks `pendingYields.length`. When a yield is detected, returns immediately.
4. The host processes the yield externally, then calls `yieldReq.deferred.resolve(value)` → VM resumes via microtask.
