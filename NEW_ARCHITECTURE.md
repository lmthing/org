# New Architecture (vNext)

## Purpose
This document defines the updated runtime contract for forks, variable/function injection, and dynamic function authoring.

## Core Model
- The runtime keeps a typed, inspect-driven execution loop.
- User code and LLM-generated code run in the same session model.
- Functions are now first-class runtime artifacts, not only inline values.

## `fork()` Contract Update
`fork()` now accepts an `inject` object with exactly two keys:

```ts
inject: {
  variables: string[]
  functions: string[]
}
```

### Semantics
- `inject.variables`: names of serializable or supported scoped values to copy into the fork context.
- `inject.functions`: names of callable functions to expose inside the fork context.
- Both arrays are optional at call-site, but the object shape is fixed.
- Legacy `inject: string[]` is removed in this architecture.

## Function Lifecycle
The LLM may create new TypeScript functions during execution.

### On creation
1. Function source is captured as TypeScript.
2. Function is registered in runtime function state.
3. Function is persisted to `functions.ts`.

### On next `inspect()`
1. The runtime rebuilds the function type surface.
2. New function signatures are emitted into system declarations.
3. `system.d.ts` is updated so subsequent generation and checking are type-aware.

## Type Surfaces
- `functions.ts`: canonical persisted implementation file for runtime-created functions.
- `system.d.ts`: generated declaration surface that includes all currently known injected/runtime functions.
- Inspect is the synchronization point between implementation persistence and type visibility.

## Execution Flow
1. LLM writes code.
2. Runtime executes statements.
3. If new functions are authored, append/update `functions.ts`.
4. At `inspect()`, regenerate `system.d.ts` from current runtime function registry.
5. Future turns can call these functions with full TypeScript typing.
6. `fork()` can inject both selected variables and selected functions via the new object contract.

## Validation Rules
- `inject` must be an object.
- Unknown keys in `inject` are rejected.
- `variables` and `functions` must be arrays of unique string identifiers.
- Injected function names must resolve to registered callable symbols.
- Type emission must be deterministic from runtime function registry state.

## Migration Notes
- Replace all fork callsites using `inject: string[]` with:
- Migration scope: all runtime and space callsites that invoke `fork()` (search for `fork(` and `inject:` together).

```ts
inject: { variables: [...], functions: [...] }
```

- For variable-only behavior, pass an empty `functions` array.
- For function-only behavior, pass an empty `variables` array.

## Non-Goals
- This change does not redefine task scheduling.
- This change does not alter ask/display interaction semantics.
- This change only updates fork injection shape and function/type persistence behavior.
