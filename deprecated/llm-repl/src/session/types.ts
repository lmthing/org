/**
 * Core session types shared across llm-repl modules.
 * This is a carry-over from repl/src/session/types.ts, trimmed to the subset
 * needed by the ported modules (hooks, context, security).
 */

// ── Serialization ──

export interface SerializedValue {
  value: unknown
  display: string
}

// ── Payloads ──

export interface StopPayload {
  [argNameOrExpression: string]: SerializedValue
}

// ── Hooks ──

export type ASTPattern =
  | { type: string; [property: string]: unknown }
  | { oneOf: ASTPattern[] }
  | { type: string; not: ASTPattern }

export interface HookMatch {
  node: unknown
  source: string
  captures: Record<string, unknown>
}

export interface HookContext {
  lineNumber: number
  sessionId: string
  scope: ScopeEntry[]
}

export type HookAction =
  | { type: 'continue' }
  | { type: 'side_effect'; fn: () => void | Promise<void> }
  | { type: 'transform'; newSource: string }
  | { type: 'interrupt'; message: string }
  | { type: 'skip'; reason?: string }

export interface Hook {
  id: string
  label: string
  pattern: ASTPattern
  phase: 'before' | 'after' | 'before-tsc' | 'on-function-capture'
  handler: (match: HookMatch, ctx: HookContext) => HookAction | Promise<HookAction>
}

// ── Scope ──

export interface ScopeEntry {
  name: string
  type: string
  value: string
}

// ── JSX ──

export interface SerializedJSX {
  component: string
  props: Record<string, unknown>
  children?: (SerializedJSX | string)[]
}

// ── Session meta ──

export interface MetaJson {
  budgetTokensUsed: number;
  budgetTokensRemaining: number;
  inspectCount: number;
  annotationGraceUsed: boolean;
  pins: Record<string, { maxTokens?: number }>;
  compactions: Record<string, { strategy: string; value: string }>;
  errors: SessionError[];
  tasks: TaskRecord[];
}

export interface TaskRecord {
  tasklistId: string;
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  deps?: string[];
  optional?: boolean;
}

export interface SessionError {
  kind: 'contract' | 'type' | 'runtime' | 'timeout' | 'oom' | 'permission';
  message: string;
  statement?: string;
  stack?: string;
  cycle: number;
  attempt?: number;
}

export interface PinRecord {
  name: string;
  cycleAdded: number;
  maxTokens?: number;
  gitRef: string;
}

export interface CompactionRecord {
  name: string;
  strategy: 'schema' | 'sample' | 'summary' | 'hash';
  compressed: string;
}
