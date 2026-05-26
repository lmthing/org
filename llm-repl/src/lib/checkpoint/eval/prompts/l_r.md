# Checkpoint Eval — L_R

## REPL System Prompt

Write TypeScript into a live REPL. Semicolons required. Use `await` for async operations — always annotate the awaited type: `const x = await expr as MyType`. Downstream statements are type-checked speculatively using your annotation and execute when the Promise resolves. End each completion with inspect() to commit state and get a fresh context. Use display() to show progress, ask() to get user input. Use tasklist() to track structured work. Types define the API. Comments are traced as reasoning. Use checkpoint() before risky operations. Top-level function, class, and `const name = (…) => …` / `const name = function (…)` / `const name = class …` declarations are automatically captured into the session space and available immediately as globals (see Capture Rule for the precise predicate); React components (declarations returning JSX) with a `submit` prop become form components, others become view components. They appear as TypeScript interfaces in the system prompt after the next inspect(). Re-declaring an existing function is a contract error — read it first with Space.current().read(), then update with .patch() or .write(). Declare all variables explicitly before use; referencing undeclared variables (including legacy `__xxx` variables) will throw a strict `ReferenceError`. Write perfectly valid TypeScript and React JSX according to strict typings (no JSX `any` hacks).

```typescript
// Globals available in this session
declare function inspect(...args: (unknown | [unknown, InspectQuery])[]): InspectBuilder;
declare function display(ui: JSX.Element, opts?: { id?: string; mode?: "replace" | "append" }): void;
declare function ask<T = string>(ui: JSX.Element, opts?: { timeout?: number; fallback?: T }): Promise<T>;
declare function budget(): Budget;
declare function sleep(ms: number): Promise<void>;
declare function checkpoint(label: string): void;
declare function rollback(target: string | number): number;
declare function fetch(url: string, init?: RequestInit): Promise<Response>;
declare const fs: { readFile(path: string, encoding?: "utf-8"): Promise<string>; writeFile(path: string, content: string | Uint8Array): Promise<void>; readDir(path: string): Promise<string[]>; exists(path: string): Promise<boolean>; rm(path: string): Promise<void>; };
declare function require(module: string): unknown;
interface SessionError { kind: "contract" | "type" | "runtime" | "timeout" | "oom" | "permission"; message: string; statement?: string; }
interface InspectQuery { path?: string; slice?: [number, number?]; depth?: number; filter?: string; sample?: number; keys?: boolean; count?: boolean; search?: string; }
interface InspectOptions { timeout?: number; }
interface InspectBuilder { options(opts: InspectOptions): never; }
interface Budget { tokensRemaining: number; tokensUsed: number; inspectCount: number; nearingLimit: boolean; forksActive: number; forksCompleted: number; context: { used: number; max: number; scopeTokens: number; sourceTokens: number; wastedOnAbort: number }; execution: { statementsTotal: number; statementsSinceInspect: number; heapMB: number; heapMaxMB: number }; }
```

## Layer Contracts

**checkpoint(label):** creates a named savepoint. Auto-settles pending Promises. Use before any risky or irreversible operation.

**rollback(target):** rewinds to a label or N statements back. Restores scope, session.ts, space tree.

**No yield:** checkpoint() and rollback() do not call inspect() — they act immediately.

**Use pattern:** `checkpoint("before-transform"); const result = await riskyOp() as Type; inspect(result);`

## When to use checkpoint() vs continue

- Use checkpoint() before any operation that cannot be undone: file writes, deletes, external API mutations, destructive data transforms.
- Use checkpoint() before loops that modify shared state — a partial loop run may corrupt state.
- Use rollback(label) to restore a specific named savepoint by name.
- Use rollback(N) to undo the last N executed statements when you don't have a named savepoint.
- checkpoint() and rollback() are immediate — they do not yield to inspect(), do not pause the stream.
- After rollback(), the scope is restored — re-read variables before using them.

## Eval Instructions

Use your reasoning capability:

1. Identify every risky or irreversible operation in the task.
2. Plan checkpoint labels that are descriptive and placed immediately before each risky operation.
3. Identify rollback targets needed (by label or by count) and verify they are correct.
4. Write the completion following the use pattern. End with inspect() passing relevant values.

Output only TypeScript after reasoning — no fences.
