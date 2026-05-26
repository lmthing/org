# Fork Eval — M_R

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
interface ForkOptions { instruction: string; exclude?: string[]; tokenBudget?: number; warnAt?: number; }
interface ForkResult<T> { status: 'resolved'|'rejected'; value?: T; error?: string; tokensUsed: number; forkId: string; }
interface ForkHandle<T> extends Promise<ForkResult<T>> { forkId: string; inject(answer: string): void; }
declare function fork<T = unknown>(opts: ForkOptions): ForkHandle<T>;
// Inside fork context only:
declare function resolve<T>(value: T): never;
```

## Layer Contracts

**Fork:** spawns parallel completion on git branch `fork/{id}`. Returns `ForkHandle<T>` which extends `Promise<ForkResult<T>>` and adds `.forkId: string` and `.inject(answer: string): void`.

**resolve():** terminates the fork with a typed value. Only available inside fork context (registered via registerGlobals(ctx, isFork=true)). Typed as `never` — the host throws to halt execution. Any code after resolve() is unreachable and constitutes a correctness error.

**fork() not available in fork context:** attempting nested fork() is a TypeScript error. registerGlobals(ctx, isFork=true) omits fork() registration.

**Seeded scope:** child fork starts with a copy of parent's heap.bin scope minus `exclude` vars. Session-space functions are re-injected as host-bridged globals.

**Budget:** fork token usage debits parent's tokensRemaining in real time. When `tokensRemaining ≤ warnAt` (default: max(20% of tokenBudget, 500)): `Budget.nearingLimit = true`, trace emits `fork_budget_warning`, and a warning comment is injected. Fork is rejected with `BudgetExceeded` if cap exhausted before resolve().

**Fork ask:** fork's ask() stays pending until parent calls `forkHandle.inject(answer: string)`. inject() only accepts strings — non-string is `kind: "contract"` error. inject() when no pending ask is silently ignored. 5-min timeout resolves with empty string.

**Await fork:** pass ForkHandle directly to inspect() to block until fork completes before next reconstruct.

## Eval Instructions

Complete the given TypeScript task. Follow these rules:

1. Use `fork({ instruction: '...' })` to spawn parallel completions. The handle is a Promise<ForkResult<T>> with `.forkId` and `.inject()`.
2. Inside fork context: always call `resolve(value)` to terminate. Do not write any code after resolve().
3. When `budget().nearingLimit` is true inside a fork, resolve immediately with partial results.
4. Pass fork handles to `inspect()` to await completion before the next cycle.
5. For concurrent forks, pass all handles to a single `inspect()` call.
6. Use `forkHandle.inject(answer)` to respond to a fork's pending ask(). Only strings are valid — non-string throws a contract error.

Output only TypeScript — no prose, no fences.
