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
