# Variable scoping — `let` across eval statements still fails

## Summary

The model declares a variable with `let` in one eval statement and references it in a later statement. Since each eval is an isolated ES module, the variable is not in scope for the next statement. The globalThis propagation only happens after a statement completes successfully, but `let` without an assignment doesn't get propagated.

## Impact

In test R2-Test8, the model wrote:
```ts
// Statement N:
let parsed;
try { parsed = JSON.parse(readResult.content); ... } catch { display("fail"); }

// Statement N+1:
display("Still failed from raw: " + parsed);  // ← ReferenceError: 'parsed' is not defined
```

The `let parsed` was declared in statement N, but since the try/catch ran and the statement completed, `parsed` should have been propagated to globalThis. However, the `try` block assigned to `parsed` inside the catch — meaning `parsed` was declared but the assignment was in the catch path. The globalThis propagation does `try { globalThis['parsed'] = parsed; } catch {}` which should work if `parsed` was assigned.

Actually, looking more carefully: the catch path called `display("fail")` but didn't assign `parsed`. So after statement N, `parsed` is `undefined` (declared but never assigned because the try failed). The globalThis propagation would set `globalThis['parsed'] = undefined`. Then in statement N+1, `parsed` should be `undefined`, not "not defined".

This needs investigation — the `let parsed` case may actually be a different bug than originally thought. It could be that the model's statement split put the `let` in one eval and the try/catch in a separate eval.

## Reproduction

```bash
node packages/cli/dist/cli/bin.js --space ./fixtures/engineer --claude --model M \
  "Write a JSON file, read it with readFile, use let parsed in one statement and try to JSON.parse in a later statement"
```

## Location

`packages/core/src/eval/turn-loop.ts` — variable propagation after each statement eval
