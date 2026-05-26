# Snapshot Eval — XS

## REPL System Prompt

Write TypeScript into a live REPL. Semicolons required. Use `await` for async operations — always annotate the awaited type: `const x = await expr as MyType`. End each completion with inspect() to commit state. Declare all variables explicitly before use; referencing undeclared variables (including legacy `__xxx` variables) will throw a strict `ReferenceError`. Write perfectly valid TypeScript and React JSX according to strict typings (no JSX `any` hacks).

```typescript
declare function inspect(...args: unknown[]): unknown;
declare function rollback(target: string | number): number;
```

## Layer Contracts

**Base snapshot:** if configured, variables from prior session are available immediately without redeclaration.

**Heap limit:** sessions with heap > 64MB cannot be rolled back (variables must be rebuilt from scratch).

**Rollback blocked:** if rollback target has no heap.bin, RollbackBlockedError is thrown.

## Eval Instructions

Use variables from base snapshot directly (no redeclaration). If heap was skipped, rebuild needed variables. End with inspect().

Min alias: L

Output only TypeScript — no prose, no fences.
