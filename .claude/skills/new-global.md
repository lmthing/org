# Skill: Adding a New Value-Yielding Global

Value-yielding globals abort the LLM stream, hand control to the host, and resume the next turn with the resolved value as a VARIABLES block. Examples: `ask`, `sleep`, `inspect`, `fork`, `delegate`.

## Checklist

### 1. Create `packages/core/src/globals/<name>.ts`

```typescript
import type { YieldRequest } from '../eval/yield.js';

export function create<Name>Global(
  pushYield: (req: YieldRequest) => void,
  // ...other host deps
): (arg: InputType) => Promise<OutputType> {
  return function name(arg: InputType): Promise<OutputType> {
    return new Promise((resolve, reject) => {
      pushYield({
        kind: '<name>',
        args: [/* serializable args the host needs */],
        deferred: { resolve: resolve as (v: unknown) => void, reject },
        vmPromiseHandle: undefined,
      });
    });
  };
}
```

Key rules:
- Cast `resolve` to `(v: unknown) => void` to satisfy `YieldRequest.deferred` type.
- Only put serializable values in `args` (strings, numbers, plain objects). The host reads them in `handleYield`.
- The function must return a `Promise` — the VM awaits it, which triggers the yield detection.

### 2. Add the kind to `packages/core/src/eval/yield.ts`

```typescript
export interface YieldRequest {
  kind: 'ask' | 'sleep' | 'inspect' | 'loadKnowledge' | 'fork' | 'delegate' | 'tasklist' | '<name>';
  args: unknown[];
  deferred: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
  vmPromiseHandle: unknown;
}
```

### 3. Register in `packages/core/src/session/session.ts` — `injectGlobals()`

```typescript
import { create<Name>Global } from '../globals/<name>.js';

// inside injectGlobals():
injectGlobal(this.vm.ctx, '<name>', create<Name>Global(pushYield, /* deps */) as AnyFn);
```

### 4. Handle in `session.ts` — `handleYield()`

```typescript
case '<name>': {
  const [arg1, arg2] = req.args;
  return /* host async work that produces the resolved value */;
}
```

The return value from `handleYield` is passed to `yieldReq.deferred.resolve(resolved)` in the turn loop, which resumes the VM promise.

### 5. Declare in `packages/core/src/typecheck/library-dts.ts`

Add a `declare function <name>(...)` line to `LIBRARY_DTS` so the typechecker accepts it in model-generated code.

```typescript
declare function name(arg: InputType): Promise<OutputType>;
```

### 6. Mention in `packages/core/src/context/system-block.ts` — `GLOBALS_SUMMARY`

Add a bullet to the `GLOBALS_SUMMARY` constant so the model knows the global exists:

```
- `name(arg)` — short description (yields)
```

## Non-Yielding (Void) Globals

If the global is fire-and-forget (like `display`), it does NOT push a yield. It calls the host synchronously via a marshalled function and returns `void` or a resolved promise. The turn continues without pausing.

For void globals, just call host methods directly inside the function body — no `pushYield`, no `deferred`.

## Testing

Add a test in `packages/core/src/globals/<name>.test.ts`:
- Create a mock `pushYield` that captures the `YieldRequest`
- Call the global
- Assert `kind`, `args`, and that the promise resolves when `deferred.resolve` is called
