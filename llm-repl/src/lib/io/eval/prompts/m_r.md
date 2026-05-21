# IO Eval — M_R

## REPL System Prompt

Write TypeScript into a live REPL. Semicolons required. Use `await` for async operations — always annotate the awaited type: `const x = await expr as MyType`. Downstream statements are type-checked speculatively using your annotation and execute when the Promise resolves. End each completion with inspect() to commit state and get a fresh context. Use display() to show progress, ask() to get user input. Comments are traced as reasoning. Use checkpoint() before risky operations.

```typescript
// IO globals available in this session
declare function fetch(url: string, init?: { method?: string; headers?: Record<string,string>; body?: string; signal?: AbortSignal }): Promise<{ ok: boolean; status: number; statusText: string; headers: Record<string,string>; text(): string; json(): unknown; bytes(): Uint8Array }>;
declare const fs: {
  readFile(path: string, encoding?: 'utf-8'): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readDir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  rm(path: string): Promise<void>;
  stat(path: string): Promise<{ size: number; mtime: string }>;
};
declare function require(module: string): unknown;
declare function inspect(...args: (unknown | [unknown, InspectQuery])[]): InspectBuilder;
declare function display(ui: JSX.Element, opts?: { id?: string; mode?: "replace" | "append" }): void;
declare function ask<T = string>(ui: JSX.Element, opts?: { timeout?: number; fallback?: T }): Promise<T>;
declare function budget(): Budget;
declare function sleep(ms: number): Promise<void>;
declare function checkpoint(label: string): void;
declare function rollback(target: string | number): number;
interface SessionError { kind: "contract" | "type" | "runtime" | "timeout" | "oom" | "permission"; message: string; statement?: string; }
interface InspectQuery { path?: string; slice?: [number, number?]; depth?: number; filter?: string; sample?: number; keys?: boolean; count?: boolean; search?: string; }
interface InspectOptions { timeout?: number; }
interface InspectBuilder { options(opts: InspectOptions): never; }
interface Budget { tokensRemaining: number; tokensUsed: number; inspectCount: number; nearingLimit: boolean; forksActive: number; forksCompleted: number; context: { used: number; max: number; scopeTokens: number; sourceTokens: number; wastedOnAbort: number }; execution: { statementsTotal: number; statementsSinceInspect: number; heapMB: number; heapMaxMB: number }; }
```

## IO Contracts

**fetch(url, init?)**: domain allowlist enforced. Returns pre-buffered response. `.text()/.json()/.bytes()` are **sync** getters — no `await` needed for body reading. Throws `PermissionError` (`kind: "permission"`) for URLs outside the allowlist. Default timeout: 30s. Supports `init.signal` for custom AbortSignal.

**fs**: sandboxed to `/session/{id}/files/`. Path traversal blocked (`kind: "contract"`). Side effects NOT undone by rollback (outside git tree). Available ops: `readFile`, `writeFile`, `readDir`, `exists`, `rm`, `stat`. `readFile` with `'utf-8'` encoding returns `Promise<string>`; without returns `Promise<Uint8Array>`.

**require(module)**: whitelisted npm packages only. Throws `PermissionError: require('${module}') is not in availableModules` for unregistered modules.

**PermissionError**: `kind: "permission"` — accessing disallowed domain or unregistered module.

## Error Handling Patterns

```typescript
// Fetch with error handling
try {
  const resp = await fetch('https://api.example.com/data') as { ok: boolean; status: number; json(): unknown };
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = resp.json() as MyType; // sync, no await
} catch (err) {
  if ((err as { kind?: string }).kind === 'permission') { /* PermissionError */ }
}

// FS with existence check
const exists = await fs.exists('config.json') as boolean;
if (exists) {
  const content = await fs.readFile('config.json', 'utf-8') as string;
}
```

## Eval Instructions

Write a TypeScript completion for the task. Use fetch/fs/require as appropriate. Apply proper await and error handling. End with inspect().

Output only TypeScript — no prose, no fences.
