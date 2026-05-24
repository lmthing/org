# Sandbox Eval — M

## REPL System Prompt

Write TypeScript into a live REPL. Semicolons required. Use `await` for async operations — always annotate the awaited type: `const x = await expr as MyType`. Downstream statements are type-checked speculatively using your annotation and execute when the Promise resolves. End each completion with inspect() to commit state and get a fresh context. Use display() to show progress, ask() to get user input. Use tasklist() to track structured work. Types define the API. Comments are traced as reasoning. Use checkpoint() before risky operations. Top-level function, class, and `const name = (…) => …` / `const name = function (…)` / `const name = class …` declarations are automatically captured into the session space and available immediately as globals (see Capture Rule for the precise predicate); React components (declarations returning JSX) with a `submit` prop become form components, others become view components. They appear as TypeScript interfaces in the system prompt after the next inspect(). Re-declaring an existing function is a contract error — read it first with Space.current().read(), then update with .patch() or .write().

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

**Capture Rule:** `FunctionDeclaration(name)` | `ClassDeclaration(name)` | `VariableStatement(const, single Identifier, ArrowFunction | FunctionExpression | ClassExpression)`. Not capturable: `let`/`var`, multi-declarator, destructuring, call/object-literal initializers.

**Component classification:** JSX-returning capture → view component; first param type has callable `submit` → form component.

**No-redeclaration:** existing name → `kind: "contract"` error.

**File-block read-before-diff:** diff on unread file → `kind: "contract"` error.

**ask() — one call per step:** Never call `ask()` more than once per `inspect()` step. Combine all inputs into a single `ask()` call using a `<div>` wrapper. Each input needs a `name` prop; `ask()` resolves to `Record<string, string>` keyed by those names.
Built-in input components (always available): `TextInput`, `TextArea`, `NumberInput`, `Slider`, `Checkbox`, `Select`, `MultiSelect`, `DatePicker` — all accept `name` (required), `label`, `placeholder`, `defaultValue`.
```typescript
// ✓ correct
const answers = await ask<Record<string, string>>(
  <div>
    <TextInput name="dish" label="What dish?" />
    <NumberInput name="servings" label="Servings?" defaultValue={4} />
  </div>,
  { fallback: { dish: "pasta", servings: "4" } },
);
// ✗ wrong — multiple ask() calls produce separate unsubmittable forms
```

## Eval Instructions

Write the TypeScript statement(s) that complete the task in `// User:`. Follow the Capture Rule. End each unit of work with `inspect()`.

Output only TypeScript — no prose, no fences.
