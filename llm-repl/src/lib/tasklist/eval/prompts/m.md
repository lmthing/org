# Tasklist Eval — M

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
interface TaskNode { id: string; label: string; deps?: string[]; optional?: boolean; condition?: string; outputSchema?: unknown; }
type TasklistHandle = { start(id: string): void; finish(id: string, value?: unknown): void; fail(id: string): void; skip(id: string): void; status(id: string): 'pending'|'in_progress'|'done'|'failed'|'skipped'; getAll(): unknown[]; nudge(): string | null; };
declare function tasklist(id: string, dag: Record<string, TaskNode>): TasklistHandle;
```

## Tasklist Contracts

**tasklist(id, dag)**: register a structured task DAG. Returns TasklistHandle.

**start(id)**: begin a task. Fails with contract error if deps not done. Condition expression auto-skips.

**finish(id, value?)**: complete a task. Validates outputSchema if defined.

**fail(id)**: mark failed. optional:true unblocks dependents; false blocks them.

**skip(id)**: skip without running. Unblocks dependents.

**__tasklist_nudge**: injected at every inspect() when unfinished tasks exist.

**outputSchema**: JSON Schema for the variable named after the task id, validated on finish().

## When to use tasklist

- Register a DAG at the start of multi-step work with clear deliverables.
- Call start() before beginning each task — if deps aren't done it errors, catching mistakes early.
- Call finish() with the result value when outputSchema is specified.
- Use optional:true for non-critical steps whose failure shouldn't block the pipeline.
- Use condition to skip tasks that don't apply to the current run.
- Check nudge() return value to see remaining work between inspect() cycles.

## Eval Instructions

Write a TypeScript completion for the task. Register the DAG, complete tasks in valid topological order (respecting deps), and end with inspect().

Output only TypeScript — no prose, no fences.
