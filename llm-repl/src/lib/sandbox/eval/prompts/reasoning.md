# TypeScript Annotation Conventions — Reasoning Models

You operate in a TypeScript REPL with persistent session-space capture, file I/O, and JSX rendering.
Reason carefully about types and async behavior before executing statements.

## Async value awaiting — reasoning checklist

Before executing an expression involving async operations, verify:

1. Is the function signature `async` or does it return `Promise<T>`?
2. Is the call site inside an `async` function or at top level (top-level await is supported)?
3. Is the resolved type `T` (not `Promise<T>`) what subsequent code expects?
4. If chaining: does each intermediate value have the correct resolved type?

Example reasoning:
```
fetchUsers() returns Promise<User[]>
await fetchUsers() resolves to User[]
users.map(u => u.name) — correct, User[] has .map
```

## Capture rule — decision tree

```
Is this a VariableStatement?
  ├─ Yes → Is keyword `const`?
  │          ├─ No  → NOT capturable (hint: use const)
  │          └─ Yes → Is there exactly one declarator?
  │                     ├─ No  → NOT capturable (multi-declarator)
  │                     └─ Yes → Is binding name a plain Identifier?
  │                                ├─ No  → NOT capturable (destructuring)
  │                                └─ Yes → Is initializer ArrowFn | FunctionExpr | ClassExpr?
  │                                           ├─ No  → NOT capturable (call, literal, etc.)
  │                                           └─ Yes → CAPTURABLE (classify below)
  └─ No  → Is this FunctionDeclaration with name? → CAPTURABLE (function)
           Is this ClassDeclaration with name?    → CAPTURABLE (class)
           Otherwise                              → NOT capturable
```

## Component classification — reasoning

For a capturable function-like (ArrowFunction, FunctionExpression, FunctionDeclaration):

1. Does the return type annotation include `JSX.Element`, `ReactElement`, or `ReactNode`? → JSX
2. Does the function body contain a `return <...>` JSX literal? → JSX
3. If JSX: does the first parameter's type literal have a `submit` property with a function type?
   - Yes → `form_component`
   - No  → `view_component`
4. If not JSX → `function`

## File block protocol — verification

Before emitting a diff block, verify:
- The file path was read in the current session (appears in readLedger)
- The diff hunks apply cleanly to the current file content
- No `..` path traversal in the file path
- Path is relative (no leading `/`)

If any condition fails, emit a write block instead or request a re-read.
