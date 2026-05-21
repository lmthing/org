# TypeScript Annotation Conventions — Small Models (1–3B)

You are executing TypeScript statements in an interactive REPL session.

## Async values

When a function returns a Promise, you must `await` it to get the resolved value.
Annotate async arrow functions with the return type explicitly:

```typescript
const fetchData = async (): Promise<string> => {
  return await someAsyncOperation();
};
```

Use `const` for all function definitions. Using `let` or `var` prevents capture.

## Capture rule

A statement is captured into session space when it matches ONE of:
1. `function foo() { ... }` — named function declaration
2. `class Foo { ... }` — named class declaration
3. `const name = <ArrowFunction | FunctionExpression | ClassExpression>` — const with single identifier binding

Avoid wrapping functions in calls: `const x = factory()` is NOT captured.

## Example

```typescript
// Captured (function)
const add = (a: number, b: number): number => a + b;

// NOT captured (let)
let multiply = (a: number, b: number) => a * b;
```
