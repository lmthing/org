# Architecture: Typecheck + Transpile + DTS Overlay

## Files

- `packages/core/src/typecheck/tsc.ts` — incremental TypeScript typechecker
- `packages/core/src/typecheck/library-dts.ts` — ambient declarations for built-in globals
- `packages/core/src/typecheck/overlay.ts` — DTS generation from space functions/components
- `packages/core/src/typecheck/transpile.ts` — TypeScript/JSX → JavaScript

## Typecheck Pipeline (`tsc.ts`)

```
runTsc({ ambientDts, sessionContext, statement })
  → create in-memory virtual filesystem
  → files: __ambient__.d.ts (ambientDts), __session__.tsx (sessionContext + statement)
  → run ts.createProgram with:
      jsx: React (classic transform)
      jsxFactory: React.createElement
      strict: true
      module: NodeNext
  → filter diagnostics to lines belonging to the current statement only
  → return { ok: true } or { ok: false, diagnostics }
```

The session file has `export {};\n` prepended (MODULE_HEADER) to enable top-level `await`.

The `statementStartLine` calculation accounts for both the header lines and the accumulated context lines so diagnostics are correctly attributed to the current statement.

## Library DTS (`library-dts.ts`)

`LIBRARY_DTS` is a compile-time string constant declaring all built-in globals:

```typescript
declare function ask(descriptor: JSXDescriptor): Promise<unknown>;
declare function display(descriptor: JSXDescriptor): void;
declare function inspect(...values: unknown[]): Promise<unknown>;
declare function sleep(duration: string): Promise<void>;
declare function loadKnowledge(...path: string[]): Promise<unknown>;
declare function fork(opts: ForkOpts): Promise<unknown>;
declare function delegate(target: string, queryOrAction: ...): Promise<unknown>;
declare function tasklist(name: string): Promise<unknown>;

interface JSXDescriptor {
  type: string;
  props: Record<string, unknown>;
  children?: JSXDescriptor[];
}

declare namespace React {
  function createElement(type: any, props?: Record<string, unknown> | null, ...children: any[]): JSXDescriptor;
  const Fragment: string;
}
declare namespace JSX {
  interface Element extends JSXDescriptor {}
  interface IntrinsicElements { [elemName: string]: Record<string, unknown>; }
}
```

## Overlay DTS (`overlay.ts`)

`buildOverlay(functions, components)` generates ambient declarations for agent-specific symbols:

**For functions:**
```typescript
declare function addIngredient(name: string, amount: string): void;
declare async function getPotTemperature(): Promise<number>;
```
Extracted by parsing the TypeScript source with `ts.createSourceFile`, finding the exported function declaration, and re-emitting its parameter types and return type.

**For components:**
```typescript
interface ConfirmDishProps {
  dish: string;
  onSubmit?: (confirmed: boolean) => void;  // function props made optional
}
declare function ConfirmDish(props: ConfirmDishProps): JSXDescriptor;
```
The `Props` interface is extracted from the component source (renamed to `<Name>Props`). All function-typed properties are made optional — the runtime injects callbacks; the model should never pass them.

Fallback when no Props interface found: `declare function Name(props?: Record<string, unknown>): JSXDescriptor;`

## Transpile (`transpile.ts`)

`transpileStatement(code)` uses `ts.transpileModule` with:
- `jsx: React` (classic transform)
- `jsxFactory: React.createElement`
- `module: ESNext`
- `target: ES2022`

Output is plain JavaScript with JSX converted to `React.createElement(...)` calls. Type annotations are stripped.

This output is what gets passed to `vm.evalStatement` (not the raw TypeScript).

## JSX Flow Example

Model writes: `const x = await ask(<ConfirmDish dish="pasta" />);`

1. **Typecheck**: `runTsc` sees it as `.tsx`, checks `ConfirmDish` has `dish: string` prop ✓
2. **Transpile**: → `const x = await ask(React.createElement(ConfirmDish, { dish: "pasta" }));`
3. **Append globalThis**: → `+ if (typeof x !== 'undefined') globalThis['x'] = x;`
4. **VM eval**: `React.createElement(ConfirmDish, { dish: 'pasta' })` → `{ type: 'ConfirmDish', props: { dish: 'pasta' }, children: [] }` (via the React shim injected at session start)
5. **ask()**: validates descriptor, pushes yield with the descriptor
