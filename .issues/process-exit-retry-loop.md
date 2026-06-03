# process.exit(1) causes infinite retry loop despite fix

## Summary

`process.exit()` was fixed to throw an error instead of being undefined. But the model still uses `process.exit(1)` as a control-flow pattern (e.g., `if (!ok) { display(...); process.exit(1); }`), and the error-recovery system retries the same code, creating an infinite retry loop.

## Impact

In test R2-Test4, the model used `process.exit(1)` in error guards and retried the exact same code 3 times before exhausting retries. Each retry wastes a full LLM call.

## Reproduction

```bash
node packages/cli/dist/cli/bin.js --space ./fixtures/engineer --claude --model M \
  "Read all .ts files in packages/core/src/ and find ones importing from './yield.js'. Use process.exit for error handling."
```

Model generates `process.exit(1)` → error → retry with same code → repeat.

## Expected behavior

Either:
- **(Best)** The error-recovery should detect that the error is `process.exit()` and NOT retry (it's intentional termination)
- **(Or)** The system prompt should explicitly tell the model to use `throw new Error()` instead of `process.exit()`

## Location

- Error recovery: `packages/core/src/eval/turn-loop.ts` — the retry logic
- System preamble: `packages/core/src/context/system-block.ts` — `RUNTIME_PREAMBLE`
- process.exit impl: `packages/core/src/globals/host-tools.ts:96`
