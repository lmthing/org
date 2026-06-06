// llm-repl.d.ts — canonical surface API for llm-repl v4.3
// Each capability layer (L0–L10) fills in the runtime behind these declarations.

// ─── React types shim ────────────────────────────────
// Minimal FC type so declarations below compile without importing react.
type FC<P = {}> = (props: P) => JSX.Element | null;
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { [key: string]: unknown }
}

// ─── Yield ──────────────────────────────────────────

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

interface InspectOptions {
  timeout?: number;
}

interface InspectBuilder {
  options(opts: InspectOptions): never;
}

declare function inspect(...args: (unknown | [unknown, InspectQuery])[]): InspectBuilder;

// ─── Render Surface ─────────────────────────────────

declare function display(
  ui: JSX.Element,
  opts?: { id?: string; mode?: "replace" | "append" },
): void;

declare function ask<T = string>(
  ui: JSX.Element,
  opts?: { timeout?: number; fallback?: T },
): Promise<T>;

// ─── Built-in UI Components ─────────────────────────

declare const TextInput: FC<{ label?: string; placeholder?: string }>;
declare const Select: FC<{ options: string[]; label?: string; multi?: boolean }>;
declare const Confirm: FC<{ message: string }>;
declare const Table: FC<{ data: Record<string, unknown>[] }>;
declare const ProgressBar: FC<{ value: number; label?: string }>;
declare const Markdown: FC<{ children: string }>;
declare const CodeBlock: FC<{ language?: string; children: string }>;

interface AskProps<T> {
  submit: (value: T) => void;
}

// ─── Budget ─────────────────────────────────────────

interface Budget {
  tokensRemaining: number;
  tokensUsed: number;
  inspectCount: number;
  forksActive: number;
  forksCompleted: number;
  nearingLimit: boolean;
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

// ─── Parallelism ────────────────────────────────────

declare function fork<T>(opts: {
  instruction: string;
  exclude?: string[];
  tokenBudget?: number;
  warnAt?: number;
}): ForkHandle<T>;

interface ForkResult<T> {
  value: T;
  tokensUsed: number;
  statementsExecuted: number;
}

interface ForkHandle<T> extends Promise<ForkResult<T>> {
  inject(answer: string): void;
}

// ─── Checkpoints & Rollback ─────────────────────────

declare function checkpoint(label: string): void;
declare function rollback(target: string | number): number;

// ─── Memory ─────────────────────────────────────────

declare function pin(name: string, opts?: { maxTokens?: number }): void;
declare function unpin(name: string): void;
declare function compact(name: string, maxTokens?: number): void;
declare function expand(name: string): void;

// ─── Space Editing ──────────────────────────────────

interface SpaceTaskNode {
  description: string;
  dependsOn?: string[];
  instructions?: string;
  outputSchema?: {
    type: "object" | "array" | "string" | "number" | "boolean";
    properties?: Record<string, { type: string; [k: string]: unknown }>;
    items?: { type: string; [k: string]: unknown };
    required?: string[];
    [k: string]: unknown;
  };
}

interface KnowledgeDomainMeta {
  label: string;
  icon?: string;
  color?: string;
}

interface KnowledgeFieldConfig {
  type: "select" | "multiSelect" | "text" | "number";
  variableName: string;
  default?: unknown;
}

interface KnowledgeOptionMeta {
  title: string;
  description?: string;
}

interface AgentConfig {
  title: string;
  model?: string;
  actions?: string[];
  knowledge?: string[];
  components?: string[];
  functions?: string[];
}

interface ActionBuilder extends Promise<TasklistResult> {}

interface SpaceHandle {
  loadAgent(role: string): void;
  loadFunction(name: string, opts?: { expand?: boolean }): void;
  loadComponent(name: string): void;
  loadKnowledge(domain: string, field: string, option?: string): void;
  agents:     Record<string, unknown>;
  functions:  Record<string, unknown>;
  components: Record<string, unknown>;
}

declare class Space {
  constructor(name: string);
  static current(): Space;
  static load(name: string): SpaceHandle;
  addFunction(name: string, code: string): this;
  addViewComponent(name: string, code: string): this;
  addFormComponent(name: string, code: string): this;
  addTaskList(name: string, dag: Record<string, SpaceTaskNode>): this;
  addKnowledgeDomain(domain: string, meta: KnowledgeDomainMeta): this;
  addKnowledgeField(domain: string, field: string, config: KnowledgeFieldConfig): this;
  addKnowledgeOption(domain: string, field: string, option: string, content: string, meta?: KnowledgeOptionMeta): this;
  addAgent(role: string, instruct: string, config: AgentConfig): this;
  loadKnowledge(domain: string, field: string, option?: string): void;
  read(path: string): string;
  patch(path: string, diff: string): this;
  list(path?: string): string[];
  write(path: string, content: string): this;
  remove(path: string): this;
}

// ─── Tasks ──────────────────────────────────────────

interface TaskNode {
  description: string;
  dependsOn?: string[];
  optional?: boolean;
  condition?: string;
}

type TaskDag = Record<string, TaskNode>;
type TaskStatus = "pending" | "in_progress" | "done" | "blocked" | "failed" | "skipped";

interface TasklistResult {
  id: string;
  status: TaskStatus;
  outputs: Record<string, unknown>;
}

interface TasklistHandle {
  start(id: string): void;
  finish(id: string): void;
  block(id: string, reason?: string): void;
  fail(id: string, error?: string): void;
  progress(id: string, value: number): void;
}

interface ActionTasklistHandle extends TasklistHandle {}

declare function tasklist(id: string, dag: TaskDag): TasklistHandle;

// ─── I/O ────────────────────────────────────────────

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

// ─── Fork Resolution ────────────────────────────────

declare function resolve<T>(value: T): never;

// ─── Session Errors ──────────────────────────────────

interface SessionError {
  kind: "contract" | "type" | "runtime" | "timeout" | "oom" | "permission";
  message: string;
  statement?: string;
  stack?: string;
}

// ─── Session Config ──────────────────────────────────

interface SessionConfig {
  model?: string;
  maxHeapMB?: number;
  maxStackSizeMb?: number;
  maxFetchResponseBytes?: number;
  availableModules?: string[];
  baseSnapshot?: string;
  fetchAllowlist?: string[];
  askEnabled?: boolean;
}
