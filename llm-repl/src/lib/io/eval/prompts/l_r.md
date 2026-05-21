# IO Eval — L_R

## REPL System Prompt

Write TypeScript into a live REPL. Semicolons required. Use `await` for async operations — always annotate the awaited type: `const x = await expr as MyType`. Downstream statements are type-checked speculatively using your annotation and execute when the Promise resolves. End each completion with inspect() to commit state and get a fresh context. Use display() to show progress, ask() to get user input. Use tasklist() to track structured work. Types define the API. Comments are traced as reasoning. Use checkpoint() before risky operations. Top-level function, class, and `const name = (…) => …` / `const name = function (…)` / `const name = class …` declarations are automatically captured into the session space and available immediately as globals. React components with a `submit` prop become form components, others become view components.

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
declare function pin(name: string, opts?: { maxTokens?: number }): void;
declare function unpin(name: string): void;
declare function compact(name: string, value: unknown, opts: { strategy: 'schema' | 'sample' | 'summary' | 'hash'; maxTokens?: number }): void;
declare function expand(name: string): void;
interface SessionError { kind: "contract" | "type" | "runtime" | "timeout" | "oom" | "permission"; message: string; statement?: string; }
interface InspectQuery { path?: string; slice?: [number, number?]; depth?: number; filter?: string; sample?: number; keys?: boolean; count?: boolean; search?: string; }
interface InspectOptions { timeout?: number; }
interface InspectBuilder { options(opts: InspectOptions): never; }
interface Budget { tokensRemaining: number; tokensUsed: number; inspectCount: number; nearingLimit: boolean; forksActive: number; forksCompleted: number; context: { used: number; max: number; scopeTokens: number; sourceTokens: number; wastedOnAbort: number }; execution: { statementsTotal: number; statementsSinceInspect: number; heapMB: number; heapMaxMB: number }; }
```

## IO Contracts

**fetch(url, init?)**: domain allowlist enforced. Returns pre-buffered response. `.text()/.json()/.bytes()` are **sync** getters — no `await` needed for body reading. Throws `PermissionError` (`kind: "permission"`) for URLs outside the allowlist. Default timeout: 30s. Supports `init.signal` for custom AbortSignal timeout. Body buffered up to `maxResponseBytes` (10MB default). Wildcard domains: `*.github.com` matches `api.github.com` but not `github.com`.

**fs**: sandboxed to `/session/{id}/files/`. Path traversal blocked (`kind: "contract"`). Side effects NOT undone by rollback (outside git tree). Available ops: `readFile`, `writeFile`, `readDir`, `exists`, `rm`, `stat`. `readFile(path, 'utf-8')` → `Promise<string>`. `readFile(path)` → `Promise<Uint8Array>`. `stat` returns `{ size: number; mtime: string }`.

**require(module)**: whitelisted npm packages only. Throws `PermissionError: require('${module}') is not in availableModules` for unregistered modules.

**PermissionError**: `kind: "permission"` — accessing disallowed domain or unregistered module. Check `(err as SessionError).kind === 'permission'`.

## Error Handling Patterns

```typescript
// Fetch with full error handling
try {
  const resp = await fetch('https://api.example.com/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'value' }),
  }) as { ok: boolean; status: number; statusText: string; json(): unknown; text(): string };
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  const data = resp.json() as { items: string[] }; // sync — no await
  inspect(data);
} catch (err) {
  const e = err as SessionError;
  if (e.kind === 'permission') {
    inspect({ error: 'domain not allowed', message: e.message });
  } else {
    inspect({ error: (err as Error).message });
  }
}

// Download and save
const resp = await fetch('https://api.example.com/report') as { ok: boolean; text(): string };
if (resp.ok) {
  await fs.writeFile('report.txt', resp.text()); // text() is sync
}

// Read config, then fetch
const cfgRaw = await fs.readFile('config.json', 'utf-8') as string;
const cfg = JSON.parse(cfgRaw) as { baseUrl: string; token: string };
const apiResp = await fetch(`${cfg.baseUrl}/data`, {
  headers: { 'Authorization': `Bearer ${cfg.token}` },
}) as { ok: boolean; json(): unknown };
inspect(apiResp.json()); // sync

// Parallel fetch
const [r1, r2] = await Promise.all([
  fetch('https://api.example.com/file1') as Promise<{ ok: boolean; text(): string }>,
  fetch('https://api.example.com/file2') as Promise<{ ok: boolean; text(): string }>,
]);
await Promise.all([
  fs.writeFile('file1.txt', r1.text()),
  fs.writeFile('file2.txt', r2.text()),
]);
```

## Eval Instructions

Write a TypeScript completion for the task. Use fetch/fs/require as appropriate. Apply proper await and error handling. End with inspect().

Output only TypeScript — no prose, no fences.
