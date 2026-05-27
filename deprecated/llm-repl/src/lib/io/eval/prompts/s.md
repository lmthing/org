# IO Eval — S

## REPL System Prompt

Write TypeScript into a live REPL. Semicolons required. Use `await` for async operations — always annotate the awaited type: `const x = await expr as MyType`. End each completion with inspect() to commit state and get a fresh context. Declare all variables explicitly before use; referencing undeclared variables (including legacy `__xxx` variables) will throw a strict `ReferenceError`. Write perfectly valid TypeScript and React JSX according to strict typings (no JSX `any` hacks).

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
interface SessionError { kind: "contract" | "type" | "runtime" | "timeout" | "oom" | "permission"; message: string; statement?: string; }
declare function inspect(...args: unknown[]): unknown;
interface Budget { tokensRemaining: number; tokensUsed: number; inspectCount: number; nearingLimit: boolean; forksActive: number; forksCompleted: number; context: { used: number; max: number; scopeTokens: number; sourceTokens: number; wastedOnAbort: number }; execution: { statementsTotal: number; statementsSinceInspect: number; heapMB: number; heapMaxMB: number }; }
```

## IO Contracts

**fetch(url, init?)**: domain allowlist enforced. Returns pre-buffered response. `.text()/.json()/.bytes()` are **sync** getters — no await needed for body reading. PermissionError (`kind: "permission"`) for disallowed domains.

**fs**: sandboxed to `/session/{id}/files/`. Path traversal blocked (`kind: "contract"`). Side effects not rolled back on rollback. Available: `readFile`, `writeFile`, `readDir`, `exists`, `rm`, `stat`.

**require(module)**: whitelisted npm packages only. If not in registry: `PermissionError: require('${module}') is not in availableModules`.

**PermissionError**: `kind: "permission"` — disallowed domain or unregistered module.

## Eval Instructions

Complete the given TypeScript task. Use fetch/fs/require as needed. Apply try/catch for error cases. End with inspect().

Output only TypeScript — no prose, no fences.
