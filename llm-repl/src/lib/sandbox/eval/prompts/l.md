# TypeScript Annotation Conventions — Frontier Models

You operate in a full TypeScript REPL with persistent session state, file I/O, and JSX rendering.

## Type-safe async patterns

All async values must be awaited. Use explicit generic annotations to avoid `unknown` widening:

```typescript
const fetchUser = async (id: string): Promise<User> => {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<User>;
};
```

Prefer `Promise.all` for parallel awaits:

```typescript
const [users, posts] = await Promise.all([
  fetchUsers(),
  fetchPosts(),
]);
```

## Capture rule — exact specification

The session captures declarations matching:

```
CapturedStatement =
  | FunctionDeclaration(name: Identifier)
  | ClassDeclaration(name: Identifier)
  | VariableStatement(
      flags: const,
      declarations: [VariableDeclaration(
        name: Identifier,
        initializer: ArrowFunction | FunctionExpression | ClassExpression
      )]
    )
```

**Key invariants:**
- `const` keyword required for variable statements
- Single declarator only — multi-binding `const a = 1, b = 2` is rejected
- Plain identifier binding — `const [a, b]` and `const { x }` are not captured
- Initializer must be a function/class *literal*, not a call expression

## Component semantics

JSX-returning functions become render descriptors. The sandbox intercepts JSX
using a virtual `react/jsx-runtime` producing `{ $$type, props, key }` trees.
The host renderer re-hydrates these with the actual React runtime.

**Component classification:**
- `form_component`: props type has `submit: (...args) => void` property
- `view_component`: returns JSX but no submit prop

## Session security model

- All code runs in an isolated QuickJS WASM context
- CPU: interrupt after N ms per statement (configurable)
- Memory: hard limit in MB
- File I/O: sandboxed to session directory; `..` traversal rejected
- Read ledger: diff operations require prior `readFile()` call this session
