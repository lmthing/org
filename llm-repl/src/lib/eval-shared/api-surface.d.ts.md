<!-- Layers 0–1 API surface (subset of llm-repl.d.ts).
     Future layers append their globals when they land. -->

```typescript
// ─── Yield ───────────────────────────────────────────────────────────────────

interface InspectQuery {
  path?: string;
  slice?: [number, number?];
  depth?: number;
  filter?: string;
  sample?: number;
  keys?: boolean;
  count?: boolean;
  search?: string;
}
interface InspectOptions { timeout?: number; }
interface InspectBuilder { options(opts: InspectOptions): never; }
declare function inspect(...args: (unknown | [unknown, InspectQuery])[]): InspectBuilder;

// ─── Render ───────────────────────────────────────────────────────────────────

declare function display(ui: JSX.Element, opts?: { id?: string; mode?: "replace" | "append" }): void;
declare function ask<T = string>(ui: JSX.Element, opts?: { timeout?: number; fallback?: T }): Promise<T>;

declare const TextInput: FC<{ label?: string; placeholder?: string }>;
declare const Select: FC<{ options: string[]; label?: string; multi?: boolean }>;
declare const Confirm: FC<{ message: string }>;
declare const Table: FC<{ data: Record<string, unknown>[] }>;
declare const ProgressBar: FC<{ value: number; label?: string }>;
declare const Markdown: FC<{ children: string }>;
declare const CodeBlock: FC<{ language?: string; children: string }>;

// ─── Budget ───────────────────────────────────────────────────────────────────

interface Budget {
  tokensRemaining: number;
  tokensUsed: number;
  inspectCount: number;
  nearingLimit: boolean;
  forksActive: number;
  forksCompleted: number;
  context: {
    used: number;
    max: number;
    scopeTokens: number;
    sourceTokens: number;
    wastedOnAbort: number;
  };
  execution: {
    statementsTotal: number;
    statementsSinceInspect: number;
    heapMB: number;
    heapMaxMB: number;
  };
}
declare function budget(): Budget;
declare function sleep(ms: number): Promise<void>;

// ─── Checkpoints ─────────────────────────────────────────────────────────────

declare function checkpoint(label: string): void;
declare function rollback(target: string | number): number;

// ─── I/O ─────────────────────────────────────────────────────────────────────

declare function fetch(url: string, init?: RequestInit): Promise<Response>;
declare const fs: {
  readFile(path: string, encoding: "utf-8" | "utf8"): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readDir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  rm(path: string): Promise<void>;
  stat(path: string): Promise<{ size: number; mtime: string }>;
};
declare function require(module: string): unknown;

// ─── Errors ───────────────────────────────────────────────────────────────────

interface SessionError {
  kind: "contract" | "type" | "runtime" | "timeout" | "oom" | "permission";
  message: string;
  statement?: string;
  stack?: string;
}
```
