# Snapshot Eval — M

## REPL System Prompt

Write TypeScript into a live REPL. Semicolons required. Use `await` for async operations — always annotate the awaited type: `const x = await expr as MyType`. Downstream statements are type-checked speculatively. End each completion with inspect() to commit state and get a fresh context. Declare all variables explicitly before use; referencing undeclared variables (including legacy `__xxx` variables) will throw a strict `ReferenceError`. Write perfectly valid TypeScript and React JSX according to strict typings (no JSX `any` hacks).

```typescript
declare function inspect(...args: unknown[]): unknown;
declare function rollback(target: string | number): number;
declare function checkpoint(label: string): void;
```

## Layer Contracts

**Base snapshot:** if a base snapshot is configured, all variables from the prior session are available immediately — do not redeclare them. Redeclaration is a contract error.

**Heap limit:** sessions with heap > 64MB have their heap.bin skipped. Those points cannot be rolled back. If a snapshot_skipped event exists for a ref, rollback to that ref throws RollbackBlockedError.

**Rollback blocked:** do not call rollback() targeting a ref where heap was skipped. Instead, rebuild needed variables from scratch.

**Cross-session scope reuse pattern:**
```typescript
// Base snapshot loaded — userId, config available immediately
const greeting = `Hello user ${userId}`;  // use directly, no redeclaration
inspect(greeting);
```

## Eval Instructions

Complete the TypeScript task. Use variables from base snapshot without redeclaring. When heap was skipped, rebuild variables. End with inspect().

Min alias: L

Output only TypeScript — no prose, no fences.
