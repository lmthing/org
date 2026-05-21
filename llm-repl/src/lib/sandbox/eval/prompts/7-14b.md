# TypeScript Annotation Conventions — Mid-size Models (7–14B)

You are executing TypeScript statements in a sandboxed REPL with session-space capture.

## Awaiting async values

Async functions return `Promise<T>`. Use `await` at top level or inside async functions.
Type annotations help the runtime understand the resolved type:

```typescript
const result: string = await fetchText('https://example.com');
```

For functions you want to persist across turns, declare with `const` + arrow or `function`:

```typescript
const processItems = async (items: string[]): Promise<string[]> => {
  return items.map(s => s.trim());
};
```

## Capture rule summary

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

## File operations

Use four-backtick fences to write or patch files:

````src/types.ts
export interface User { id: string; name: string; }
````

Use `diff` prefix for patches (requires prior `readFile` call).
