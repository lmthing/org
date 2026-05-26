# Sandbox Eval — XS

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
interface Budget { tokensRemaining: number; tokensUsed: number; inspectCount: number; nearingLimit: boolean; }
```

## Layer Contracts

**Capture Rule** — a statement is captured into session space (not session.ts) when it matches exactly one of:
1. `function foo(...) { ... }` — named function declaration
2. `class Foo { ... }` — named class declaration
3. `const name = <ArrowFunction>` — e.g. `const add = (a: number, b: number) => a + b;`
4. `const name = function(...) { ... }` — named function expression
5. `const name = class { ... }` — class expression

**NOT captured:** `let`, `var`, multi-declarator const, destructuring, call-expression initializers (`const x = factory()`), object literal initializers.

**Component classification:** a captured function returning JSX is a _view component_. If its first parameter type has a `submit` callable property, it is a _form component_.

**No-redeclaration:** declaring a name that already exists in session space → `kind: "contract"` error. Use `.read()` then `.patch()` or `.write()` to update.

**File-block read-before-diff:** a four-backtick diff block on a file not yet read via `fs.readFile()` this cycle → `kind: "contract"` error; block discarded.

## Eval Instructions

You are writing TypeScript statements into the REPL. Each statement is executed, then `inspect()` is called to commit state.

### What to do

When given a task (in `// User:` comment), write a single TypeScript statement that completes it. Follow the Capture Rule: write capturable declarations as `function`, `class`, or `const name = () =>`.

### Worked examples (study these carefully)

**Task:** Write a function that adds two numbers.
```typescript
function add(a: number, b: number): number {
  return a + b;
}
inspect();
```
✓ Captured as `function` declaration.

**Task:** Write an arrow function that reverses a string.
```typescript
const reverseStr = (s: string): string => s.split('').reverse().join('');
inspect();
```
✓ Captured as `const name = (…) => …`.

**Task:** Write a React view component that shows a greeting.
```typescript
const Greeting = ({ name }: { name: string }) => (
  <div>Hello, {name}!</div>
);
inspect();
```
✓ Captured as view component (returns JSX, no `submit` prop).

**Task:** Write a React form component that collects a name.
```typescript
const NameForm = ({ submit }: { submit: (name: string) => void }) => (
  <TextInput label="Name" placeholder="Enter name" />
);
inspect();
```
✓ Captured as form component (has `submit` prop).

**Task:** Write a variable holding a configuration object.
```typescript
const config = { host: "localhost", port: 3000 };
inspect(config);
```
✓ `config` is NOT captured (object literal initializer) — goes to session.ts.

**BAD examples (do not do these):**
```typescript
// BAD — let is not captured
let add = (a: number, b: number) => a + b;

// BAD — factory call is not captured
const add = Math.max.bind(null);

// BAD — multi-declarator not captured
const add = (a: number) => a, sub = (a: number) => -a;
```

### Output format

Return only the TypeScript statement(s) — no explanation, no prose, no markdown fences.
