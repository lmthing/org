/**
 * Ambient `.d.ts` for the `@lmthing/llm-repl` runtime primitives.
 *
 * This is the "library half" of the type surface the LLM sees inside the
 * QuickJS sandbox. A space contributes the other half via {@link extractOverlayDts}
 * (auto-discovered from `<spaceDir>/functions` and `<spaceDir>/components`).
 *
 * Per `NEW_ARCHITECTURE.md`, the system prompt's `.d.ts` overlay = library DTS
 * + space overlay; both are prepended to `runTsc`'s `sessionContext` so the
 * LLM's TypeScript references resolve cleanly.
 *
 * Anything declared here MUST be wired by a registered engine in the runtime —
 * declarations without an implementation are a contract bug.
 */

export const LIBRARY_AMBIENT_DTS = `\
// ── Yield: inspect ──────────────────────────────────────────────────────────

declare interface InspectQuery {
  path?: string;
  slice?: [number, number?];
  depth?: number;
  filter?: string;
  sample?: number;
  keys?: boolean;
  count?: boolean;
  search?: string;
}

declare interface InspectOptions {
  /** Soft cap in ms; default 30000. */
  timeout?: number;
}

declare interface InspectBuilder {
  options(opts: InspectOptions): never;
}

/**
 * Aborts the LLM stream when called. Awaits Promises passed as arguments;
 * resolved values replace the Promise in the next cycle's scope reconstruction.
 * Pass [var, query] tuples for queried views.
 */
declare function inspect(...args: (unknown | [unknown, InspectQuery])[]): InspectBuilder;

// ── Render surface ──────────────────────────────────────────────────────────

declare function display(
  ui: unknown,
  opts?: { id?: string; mode?: "replace" | "append" }
): void;

declare function ask<T = string>(
  ui: unknown,
  opts?: { timeout?: number; fallback?: T }
): Promise<T>;

// Built-in UI components — descriptors rehydrated by Ink/React in the host.
declare const TextInput: (props: { label?: string; placeholder?: string }) => unknown;
declare const Select: (props: { options: string[]; label?: string; multi?: boolean }) => unknown;
declare const Confirm: (props: { message: string }) => unknown;
declare const Table: (props: { data: Record<string, unknown>[] }) => unknown;
declare const ProgressBar: (props: { value: number; label?: string }) => unknown;
declare const Markdown: (props: { children: string }) => unknown;
declare const CodeBlock: (props: { language?: string; children: string }) => unknown;

// ── Budget & timing ─────────────────────────────────────────────────────────

declare interface Budget {
  tokensRemaining: number;
  tokensUsed: number;
  inputTokensUsed: number;
  outputTokensUsed: number;
  costUsd: number;
  inspectCount: number;
  forksActive: number;
  forksCompleted: number;
  nearingLimit: boolean;
  context: {
    used: number; max: number;
    scopeTokens: number; sourceTokens: number; wastedOnAbort: number;
  };
  execution: {
    statementsTotal: number; statementsSinceInspect: number;
    heapMB: number; heapMaxMB: number;
  };
}
declare function budget(): Budget;

declare function sleep(ms: number): Promise<void>;

// ── Parallelism ─────────────────────────────────────────────────────────────

declare interface ForkResult<T> { value: T; tokensUsed: number; }
declare interface ForkHandle<T> extends Promise<ForkResult<T>> {
  inject(answer: string): void;
}
declare function fork<T>(opts: {
  instruction: string;
  exclude?: string[];
  tokenBudget?: number;
  warnAt?: number;
}): ForkHandle<T>;

// ── Checkpoints ─────────────────────────────────────────────────────────────

declare function checkpoint(label: string): void;
declare function rollback(target: string | number): number;

// ── Memory ──────────────────────────────────────────────────────────────────

declare function pin(name: string, opts?: { maxTokens?: number }): void;
declare function unpin(name: string): void;
declare function compact(name: string, maxTokens?: number): void;
declare function expand(name: string): void;

// ── Tasklist ────────────────────────────────────────────────────────────────

declare interface TasklistResult { value: unknown }
declare interface ActionBuilder extends Promise<TasklistResult> {}
declare interface TasklistHandle {
  start(id: string): void;
  finish(id: string, value?: unknown): void;
  cancel(): void;
}
declare interface TaskDag { [id: string]: { description: string; dependsOn?: string[]; instructions?: string; outputSchema?: unknown } }
declare function tasklist(id: string, dag: TaskDag): TasklistHandle;

// ── I/O ─────────────────────────────────────────────────────────────────────

declare function fetch(url: string, init?: unknown): Promise<{
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

declare const fs: {
  readFile(path: string, encoding?: "utf-8" | "utf8"): Promise<string>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
  stat(path: string): Promise<{ size: number; isFile: boolean; isDirectory: boolean }>;
};

declare function require(name: string): unknown;

// ── Cross-agent / cross-space invocation ────────────────────────────────────

declare interface DelegateSpec {
  /** Absolute path to a different space. Omit to use the current space. */
  space?: string;
  /** Agent slug in the target space. Omit to use the flow's defaultAgent. */
  agent?: string;
  /** Flow slug in the target space. Omit to use the first flow. */
  flow?: string;
  /** Task / prompt for the sub-session. Required. */
  task: string;
  /** Model alias for the sub-session. Inherits if omitted. */
  modelAlias?: "XS" | "S" | "M" | "M_R" | "L" | "L_R";
  /** Override the target flow's default cycle budget. */
  maxCycles?: number;
}

declare interface DelegateResult {
  /** The sub-session's sink output (string), or null if no sink fired. */
  output: string | null;
  /** Filesystem path to the sub-session's manifest/trace dir. */
  sessionDir: string;
  /** Termination reason. */
  status: "sink_fired" | "max_cycles_reached" | "empty_response" | "error";
}

/**
 * Run another agent — in the current space or a different one — as a
 * sub-session and await its terminal sink. The sub-session runs in its own
 * QuickJS sandbox, with its own manifest at \`sessionDir\`. Caller's scope is
 * not affected; only the returned \`output\` value flows back.
 */
declare function delegate(spec: DelegateSpec): Promise<DelegateResult>;

// ── Space ───────────────────────────────────────────────────────────────────

declare interface SpaceHandle {
  loadAgent(role: string): void;
  loadFunction(name: string, opts?: { expand?: boolean }): void;
  loadComponent(name: string): void;
  loadKnowledge(domain: string, field: string, option?: string): void;
  agents: Record<string, unknown>;
  functions: Record<string, unknown>;
  components: Record<string, unknown>;
}

declare class Space {
  static current(): SpaceHandle;
  static load(name: string): SpaceHandle;
  addFunction(name: string, source: string): this;
  addViewComponent(name: string, source: string): this;
  addFormComponent(name: string, source: string): this;
  addAgent(name: string, config: unknown): this;
  addKnowledgeDomain(domain: string, fields: Record<string, unknown>): this;
}

// Force module-mode so top-level await is permitted in user statements.
export {};
`;
