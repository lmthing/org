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

## Synchronous host primitives (the `host-tools.ts` substrate)

A *third* category exists: synchronous, non-yielding primitives the VM calls and gets an immediate value back (`execShell`, `fetch`, `process.env`, `readFileRaw`, `writeFileRaw`). These are the thin substrate that **system-space functions** build on — prefer adding capability as a system-space function over a new core global (see `@.claude/skills/system-spaces.md`). Add a raw host primitive only when shelling out is fragile (e.g. binary-safe file I/O).

They live in ONE place — `packages/core/src/globals/host-tools.ts` `injectHostTools(vm, opts)` — which both the session VM and every fork VM call (do not duplicate shims in `session.ts`/`fork.ts`). To add one:
1. Add a `setGlobal('<name>', (args) => { ... return plainObject; })` in `injectHostTools`. Return a plain object (functions on it, like `fetch().json`, are marshalled and callable; no prototypes/classes).
2. Honor the read-only `profile` if the primitive mutates (see how `writeFileRaw`/`execShell` gate on `allowWrite`) so `fork({ role: 'explore' })` can't use it.
3. Declare it in `LIBRARY_DTS`.
4. Test it by injecting into a bare VM and `evalCode`-ing a call (see `globals/host-tools.test.ts`).

## How resolved values bind (yielding globals)

The turn loop does NOT rely on the QuickJS post-`await` continuation. It resolves each pending yield, then maps results onto the statement's binding pattern via `extractBindingPattern` and `vm.setVar`. So `const [a,b] = await Promise.all([g(), g()])` binds positionally and `const {x} = await g()` binds by key. If your global is used in such patterns, ensure `handleYield` returns the right shape.

## Testing

Add a test in `packages/core/src/globals/<name>.test.ts`:
- Create a mock `pushYield` that captures the `YieldRequest`
- Call the global
- Assert `kind`, `args`, and that the promise resolves when `deferred.resolve` is called
