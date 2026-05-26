# Memory Eval — L_R

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
declare function pin(name: string, opts?: { maxTokens?: number }): void;
declare function unpin(name: string): void;
declare function compact(name: string, value: unknown, opts: { strategy: 'schema' | 'sample' | 'summary' | 'hash'; maxTokens?: number }): void;
declare function expand(name: string): void;
interface SessionError { kind: "contract" | "type" | "runtime" | "timeout" | "oom" | "permission"; message: string; statement?: string; }
interface InspectQuery { path?: string; slice?: [number, number?]; depth?: number; filter?: string; sample?: number; keys?: boolean; count?: boolean; search?: string; }
interface InspectOptions { timeout?: number; }
interface InspectBuilder { options(opts: InspectOptions): never; }
interface Budget { tokensRemaining: number; tokensUsed: number; inspectCount: number; nearingLimit: boolean; forksActive: number; forksCompleted: number; context: { used: number; max: number; scopeTokens: number; sourceTokens: number; wastedOnAbort: number }; execution: { statementsTotal: number; statementsSinceInspect: number; heapMB: number; heapMaxMB: number }; }
```

## Memory Contracts

**pin(name, opts?)**: keeps variable full in __scope, overrides decay. Use for values you'll reference across many cycles. Supports dotted paths (`pin("__knowledge.grading.level")`). Pinned vars never get auto-compacted.

**compact(name, value, opts)**: compress __scope representation. strategies: 'schema'|'sample'|'summary'|'hash'. Original heap value unchanged. Proactively call this before context fills to avoid the auto-compact warning.

**expand(name)**: restore full __scope view of a compacted variable. Always expand before operating on a variable you intend to use.

**Auto-compact**: when context exceeds budget, variables with cycle_distance ≥ threshold (early: 10, mid: 6, late: 3) are auto-compacted using 'schema'. When this fires, the model sees: `// ⚠ Context pressure: {n} variables auto-compacted.` Proactive compact avoids this interruption.

## When to use memory management

- Pin variables you'll reference many times: schemas, configs, reference data.
- Compact large arrays/objects before starting expensive multi-step pipelines.
- Check `budget().nearingLimit` — if true, compact all non-essential vars before proceeding.
- Expand a variable before filtering, transforming, or displaying its full content.
- Prefer proactive compact over letting auto-compact fire — it preserves session flow.
- Use 'schema' for type-only hints, 'sample' when you need representative examples, 'summary' for plain English context, 'hash' for integrity checks only.

## Eval Instructions

Use your reasoning capability:

1. Survey the current __scope — identify which variables are large, stale, or frequently needed
2. Determine which to pin (long-lived reference data), compact (large, not immediately needed), or expand (compacted but needed now)
3. Apply memory management calls with correct arguments
4. Proceed with the task logic
5. End with inspect()

Output only TypeScript after reasoning — no fences.
