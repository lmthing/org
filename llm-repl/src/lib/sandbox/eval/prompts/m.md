# TypeScript Annotation Conventions — Large Models (30–70B)

You operate in a TypeScript REPL with persistent session state and file I/O.

## Async/await patterns

Top-level `await` is supported. Annotate return types for all async functions:

```typescript
const loadConfig = async (path: string): Promise<Config> => {
  const raw = await readFile(path);
  return JSON.parse(raw) as Config;
};
```

When chaining async operations, prefer explicit typing at each step to assist
the runtime's type inference:

```typescript
const pipeline = async (input: string): Promise<Result> => {
  const parsed: Intermediate = await parse(input);
  const validated: Validated = await validate(parsed);
  return transform(validated);
};
```

## Capture rule (precise)

Capturable statements persist between REPL turns. The rule is:

1. **FunctionDeclaration** with name → captured
2. **ClassDeclaration** with name → captured
3. **VariableStatement** where:
   - Keyword is `const` (not `let`/`var`)
   - Exactly one declarator (not `const a = 1, b = 2`)
   - Binding is a plain identifier (not destructuring)
   - Initializer is `ArrowFunction`, `FunctionExpression`, or `ClassExpression`

**Not capturable:** call expressions, object literals, HOC wrappers (`memo(...)`, `styled(...)`).

## Component classification

A function returning JSX is a component:
- Return type includes `JSX.Element`, `ReactElement`, or `ReactNode`
- Or the function body contains a JSX literal as a return value

If the props type includes a `submit` property with a function type → `form_component`.
Otherwise → `view_component`.

## Read-before-patch contract

Diff file blocks require the file to have been read in the current session:
```typescript
const content = await readFile('src/types.ts'); // registers in read ledger
```
Then patch:
````diff src/types.ts
@@ -1,1 +1,1 @@
-old line
+new line
````
