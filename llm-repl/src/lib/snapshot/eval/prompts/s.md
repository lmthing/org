# Snapshot Eval — S

## REPL System Prompt

Write TypeScript into a live REPL. Semicolons required. Use `await` for async operations — always annotate the awaited type: `const x = await expr as MyType`. End each completion with inspect() to commit state and get a fresh context.

```typescript
declare function inspect(...args: unknown[]): unknown;
declare function rollback(target: string | number): number;
```

## Layer Contracts

**Base snapshot:** if configured, variables from prior session are available immediately without redeclaration. Using `const x = ...` to redeclare a snapshot variable is a contract error.

**Heap limit:** sessions with heap > 64MB cannot be rolled back (variables must be rebuilt from scratch). Do not attempt rollback past a skipped snapshot point.

**Rollback blocked:** if rollback target has no heap.bin (snapshot was skipped), RollbackBlockedError is thrown.

## Eval Instructions

Complete the TypeScript task. Use base snapshot variables directly without redeclaring. If snapshot was skipped, rebuild variables as needed. End with inspect().

Min alias: L

Output only TypeScript — no prose, no fences.
