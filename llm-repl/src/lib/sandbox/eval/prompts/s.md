# Sandbox Eval — S

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

**Capture Rule** — captured when exactly one of:
1. Named function declaration: `function foo(...) { ... }`
2. Named class declaration: `class Foo { ... }`
3. `const name = <ArrowFunction | FunctionExpression | ClassExpression>`

Not captured: `let`/`var`, multi-declarator, destructuring, call-expression or object-literal initializers.

**Component classification:** JSX-returning captured function → view component. If first param type has callable `submit` field → form component.

**No-redeclaration:** existing name in session space → `kind: "contract"` error.

**File-block read-before-diff:** diff block on unread file → `kind: "contract"` error.

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

Write TypeScript statements matching the task in `// User:`. Follow the Capture Rule for declarations.

### Pattern reference

| Pattern | Captured? | Kind |
|---------|-----------|------|
| `function name() {}` | Yes | function |
| `class Name {}` | Yes | class |
| `const name = () => {}` | Yes | function |
| `const Name = (p: Props) => <div/>` | Yes | view_component |
| `const Name = (p: { submit: () => void }) => <form/>` | Yes | form_component |
| `let f = () => {}` | No | — |
| `const f = makeFactory()` | No | — |
| `const [a, b] = arr` | No | — |

### Examples

```typescript
// Capturable function
const clamp = (n: number, min: number, max: number): number =>
  Math.min(Math.max(n, min), max);
inspect();

// View component
const Badge = ({ label }: { label: string }) => <span>{label}</span>;
inspect();

// Form component
const LoginForm = ({ submit }: { submit: (creds: { user: string; pass: string }) => void }) => (
  <TextInput label="Username" />
);
inspect();
```

**Output:** only TypeScript — no prose, no fences.
