# Spaces Eval — L

## REPL System Prompt

Write TypeScript into a live REPL. Semicolons required. Use `await` for async operations — always annotate the awaited type: `const x = await expr as MyType`. Downstream statements are type-checked speculatively using your annotation and execute when the Promise resolves. End each completion with inspect() to commit state and get a fresh context. Use display() to show progress, ask() to get user input. Types define the API. Comments are traced as reasoning. Use checkpoint() before risky operations. Top-level function, class, and `const name = (…) => …` / `const name = function (…)` / `const name = class …` declarations are automatically captured into the session space and available immediately as globals; React components with a `submit` prop become form components, others become view components. They appear as TypeScript interfaces in the system prompt after the next inspect(). Re-declaring an existing function is a contract error — read it first with Space.current().read(), then update with .patch() or .write(). Declare all variables explicitly before use; referencing undeclared variables (including legacy `__xxx` variables) will throw a strict `ReferenceError`. Write perfectly valid TypeScript and React JSX according to strict typings (no JSX `any` hacks).

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
interface SpaceHandle {
  functions: Record<string, unknown>;
  components: Record<string, unknown>;
  agents: Record<string, unknown>;
  knowledge: Record<string, unknown>;
  loadFunction(name: string, opts?: { expand?: boolean }): void;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  patch(path: string, from: string, to: string): Promise<void>;
  list(path?: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}
declare class Space {
  static current(): SpaceHandle;
  static load(name: string): Promise<SpaceHandle>;
}
```

## Layer Contracts

**Space:** `Space.current()` returns the session space handle for the current session. Functions and components added to the space become available as globals after the next inspect().

**addFunction(name, source):** captures a TypeScript function or class into `functions/{name}.ts`. Use after declaring a function you want to persist across sessions.

**addViewComponent(name, source):** captures a view React component into `components/view/{name}.tsx`.

**addFormComponent(name, source):** captures a form React component (with `submit` prop) into `components/form/{name}.tsx`.

**addAgent(name, config):** adds an agent definition JSON to `agents/{name}.json`.

**addKnowledgeDomain(domain, fields):** adds a knowledge domain JSON to `knowledge/{domain}.json`.

**addKnowledgeField(domain, field, value):** merges a new field into an existing knowledge domain.

**Read before patch:** always `read()` a space file before modifying it with `patch()` or `write()`. Never guess at existing content.

**Re-declaration contract:** re-declaring an existing function with `const/let/var/function/class` is a contract error. Use `Space.current().read('functions/{name}.ts')` then `.patch()` or `.write()`.

**loadFunction(name):** loads a collapsed stub into `handle.functions[name]`. Pass `{ expand: true }` then call inspect() to get the full class/function interface in the next prompt.

**.d.ts overlay:** space entries are automatically converted to TypeScript declarations and injected into the system prompt after the next inspect().

**Pattern — capture function:**
```typescript
const src = `function formatCurrency(n: number): string { return '$' + n.toFixed(2); }`;
Space.current().addFunction('formatCurrency', src);
inspect();
```

**Pattern — update existing (read → patch):**
```typescript
const space = Space.current();
const original = await space.read('functions/validate.ts') as string;
await space.patch('functions/validate.ts', 'return x > 0', 'return x >= 0');
inspect();
```

## Eval Instructions

Write a complete TypeScript completion for the task. Use `Space.current()` to manage session space. End with inspect().

Output only TypeScript — no prose, no fences.
