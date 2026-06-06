/**
 * Builds the full context reconstruction string — the single role:"user" message
 * that re-establishes session state after an inspect() call.
 */
import {
  serializeScopeBlock,
  serializeScopeJson,
} from './scope-serializer.js';
import type { PromiseState } from './scope-serializer.js';
import type { MetaJson, SessionError, CompactionRecord, TaskRecord } from '../session/types.js';
import { applyQuery } from '../lib/inspect/index.js';
import { previewSerialize } from '../lib/inspect/serialize.js';

// ── Types ──

export interface InspectQuery {
  path?: string;
  slice?: [number, number?];
  depth?: number;
  filter?: string;
  sample?: number;
  keys?: boolean;
  count?: boolean;
  search?: string;
}

export interface ReconstructionInput {
  inspectNumber: number;
  sessionTs: string;
  scope: Record<string, unknown>;
  meta: MetaJson;
  pins: Set<string>;
  compactions: Map<string, CompactionRecord>;
  promiseStates: Map<string, PromiseState>;
  lastAccessedCycle: Map<string, number>;
  errors: SessionError[];
  expandedArgs: Array<{ name: string; value: unknown; query?: InspectQuery }>;
  git: { head: string; checkpoints: string[]; branch: string };
  speculativeNudge?: string;
  speculativePending?: string;
  forkAsks?: string;
  tasklistNudge?: string;
  currentStep?: string;
  routerFlags?: { budgetWarning?: boolean; heapWarning?: boolean; recoveryContext?: boolean };
  displayEntries?: string[];
  forkStates?: Record<string, { status: string; tokensUsed?: number }>;
  typeFeedback?: string;
  budgetTokensRemaining: number;
  budgetTokensUsed: number;
  budgetInputTokensUsed: number;
  budgetOutputTokensUsed: number;
  budgetCostUsd: number;
  budgetContext: { used: number; max: number; scopeTokens: number; sourceTokens: number; wastedOnAbort: number };
  budgetExecution: { statementsTotal: number; statementsSinceInspect: number; heapMB: number; heapMaxMB: number };
  forksActive: number;
  forksCompleted: number;
  nearingLimit: boolean;
  tokenBudget: number;
}

// ── Helpers ──

function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function normalizeBlock(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s{2}/, '').trimEnd())
    .filter((line) => line.length > 0);
}

function stripCommentPrefix(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/\s?/, '').trimEnd())
    .filter((line) => line.length > 0);
}

function renderIndentedTree(lines: string[]): string[] {
  return lines
    .map((raw) => {
      const indent = Math.floor(raw.match(/^\s*/)?.[0].length ?? 0);
      const level = Math.floor(indent / 2);
      const text = raw.trimStart();
      if (text.length === 0) return '';
      const prefix = '  '.repeat(level + 1);
      return `${prefix}${text}`;
    })
    .filter((line) => line.length > 0);
}

interface TreeBlock {
  label: string;
  lines: string[];
}

function renderBlockLines(block: TreeBlock, isLast: boolean): string[] {
  const branch = '  ';
  const childPrefix = '  ';
  const out: string[] = [`${branch}${block.label}`];
  for (const line of block.lines) out.push(`${childPrefix}${line}`);
  return out;
}

function renderBlock(block: TreeBlock, isLast: boolean): string {
  return renderBlockLines(block, isLast).join('\n');
}

function decayTier(inspectCount: number): 'early' | 'mid' | 'late' {
  if (inspectCount <= 5) return 'early';
  if (inspectCount <= 15) return 'mid';
  return 'late';
}

function sourceTailLines(tier: 'early' | 'mid' | 'late'): number {
  if (tier === 'early') return 100;
  if (tier === 'mid') return 50;
  return 20;
}

function getSourceTail(sessionTs: string, lines: number): string {
  const all = sessionTs.split('\n');
  const tail = all.slice(-lines);
  return tail.join('\n');
}

function formatErrors(errors: SessionError[], tier: 'early' | 'mid' | 'late'): string {
  if (errors.length === 0) return '[]';
  const count = tier === 'early' ? 3 : tier === 'mid' ? 2 : 1;
  const subset = errors.slice(-count);
  const items = subset.map((e) => {
    if (tier === 'late') {
      return `  { kind: "${e.kind}", message: ${JSON.stringify(e.message)} }`;
    }
    if (tier === 'mid') {
      const stmt = e.statement ? `, statement: ${JSON.stringify(e.statement)}` : '';
      return `  { kind: "${e.kind}", message: ${JSON.stringify(e.message)}${stmt} }`;
    }
    const parts = [
      `kind: "${e.kind}"`,
      `message: ${JSON.stringify(e.message)}`,
    ];
    if (e.statement) parts.push(`statement: ${JSON.stringify(e.statement)}`);
    if (e.stack) parts.push(`stack: ${JSON.stringify(e.stack)}`);
    parts.push(`cycle: ${e.cycle}`);
    if (e.attempt !== undefined) parts.push(`attempt: ${e.attempt}`);
    return `  { ${parts.join(', ')} }`;
  });
  return `[\n${items.join(',\n')}\n]`;
}

function formatTasks(tasks: TaskRecord[]): string {
  const active = tasks.filter(
    (t) => t.status === 'pending' || t.status === 'in_progress',
  );
  if (active.length === 0) return '[]';
  const items = active.map((t) => {
    const parts = [
      `id: ${JSON.stringify(t.id)}`,
      `label: ${JSON.stringify(t.label)}`,
      `status: "${t.status}"`,
    ];
    if (t.deps?.length) parts.push(`deps: ${JSON.stringify(t.deps)}`);
    if (t.optional) parts.push('optional: true');
    return `  { ${parts.join(', ')} }`;
  });
  return `[\n${items.join(',\n')}\n]`;
}

function formatForks(
  forks: Record<string, { status: string; tokensUsed?: number }>,
): string {
  const entries = Object.entries(forks).map(([k, v]) => {
    const parts: string[] = [`status: "${v.status}"`];
    if (v.tokensUsed !== undefined) parts.push(`tokensUsed: ${v.tokensUsed}`);
    return `  ${k}: { ${parts.join(', ')} }`;
  });
  return `{\n${entries.join(',\n')}\n}`;
}

// ── Main builder ──

export function buildReconstruction(input: ReconstructionInput): string {
  const tier = decayTier(input.inspectNumber);
  const tailLines = sourceTailLines(tier);
  let remainingTokens = input.tokenBudget;

  const blocks: TreeBlock[] = [];

  // ── Hard-pinned: __budget (always) ──
  const budgetBlock: TreeBlock = {
    label: '__budget',
    lines: renderIndentedTree([
      `tokensRemaining: ${input.budgetTokensRemaining}`,
      `tokensUsed: ${input.budgetTokensUsed}`,
      `inputTokensUsed: ${input.budgetInputTokensUsed}`,
      `outputTokensUsed: ${input.budgetOutputTokensUsed}`,
      `costUsd: ${input.budgetCostUsd.toFixed(6)}`,
      `inspectCount: ${input.inspectNumber}`,
      `forksActive: ${input.forksActive}`,
      `forksCompleted: ${input.forksCompleted}`,
      `nearingLimit: ${input.nearingLimit}`,
      `context`,
      `  used: ${input.budgetContext.used}`,
      `  max: ${input.budgetContext.max}`,
      `  scopeTokens: ${input.budgetContext.scopeTokens}`,
      `  sourceTokens: ${input.budgetContext.sourceTokens}`,
      `  wastedOnAbort: ${input.budgetContext.wastedOnAbort}`,
      `execution`,
      `  statementsTotal: ${input.budgetExecution.statementsTotal}`,
      `  statementsSinceInspect: ${input.budgetExecution.statementsSinceInspect}`,
      `  heapMB: ${input.budgetExecution.heapMB}`,
      `  heapMaxMB: ${input.budgetExecution.heapMaxMB}`,
    ]),
  };
  blocks.push(budgetBlock);
  remainingTokens -= approxTokens(renderBlock(budgetBlock, false));

  // ── Hard-pinned: __tasklist_nudge ──
  if (input.tasklistNudge) {
    const block: TreeBlock = {
      label: '__tasklist_nudge',
      lines: renderIndentedTree(stripCommentPrefix(input.tasklistNudge)),
    };
    blocks.push(block);
    remainingTokens -= approxTokens(renderBlock(block, false));
  }

  // ── Hard-pinned: __currentStep ──
  if (input.currentStep) {
    const block: TreeBlock = { label: `__currentStep (comment): ${JSON.stringify(input.currentStep)}`, lines: [] };
    blocks.push(block);
    remainingTokens -= approxTokens(renderBlock(block, false));
  }

  // ── Hard-pinned: __speculative_nudge ──
  if (input.speculativeNudge) {
    const block: TreeBlock = { label: `__speculative_nudge (comment): ${JSON.stringify(input.speculativeNudge)}`, lines: [] };
    blocks.push(block);
    remainingTokens -= approxTokens(renderBlock(block, false));
  }

  // ── Hard-pinned: __speculative_pending ──
  if (input.speculativePending) {
    const block: TreeBlock = { label: `__speculative_pending (comment): ${JSON.stringify(input.speculativePending)}`, lines: [] };
    blocks.push(block);
    remainingTokens -= approxTokens(renderBlock(block, false));
  }

  // ── Hard-pinned: __fork_asks ──
  if (input.forkAsks) {
    const block: TreeBlock = { label: `__fork_asks (comment): ${JSON.stringify(input.forkAsks)}`, lines: [] };
    blocks.push(block);
    remainingTokens -= approxTokens(renderBlock(block, false));
  }

  // ── Priority 1: __scope ──
  const scopeOpts = {
    depth: 2,
    pins: input.pins,
    compactions: input.compactions,
    promiseStates: input.promiseStates,
    decayTier: tier,
    lastAccessedCycle: input.lastAccessedCycle,
    inspectCount: input.inspectNumber,
  };
  const scopeBody = normalizeBlock(serializeScopeBlock(input.scope, scopeOpts));
  const scopeBlock: TreeBlock = { label: '__scope', lines: renderIndentedTree(scopeBody) };
  if (remainingTokens > approxTokens(renderBlock(scopeBlock, false))) {
    blocks.push(scopeBlock);
    remainingTokens -= approxTokens(renderBlock(scopeBlock, false));
  }

  // ── Priority 2: __errors ──
  if (input.errors.length > 0) {
    const errLines: string[] = [];
    const count = tier === 'early' ? 3 : tier === 'mid' ? 2 : 1;
    const subset = input.errors.slice(-count);
    for (let i = 0; i < subset.length; i++) {
      const e = subset[i]!;
      errLines.push(`[${i}]`);
      errLines.push(`  kind: "${e.kind}"`);
      errLines.push(`  message: ${JSON.stringify(e.message)}`);
      if (e.statement) errLines.push(`  statement: ${JSON.stringify(e.statement)}`);
      if (tier === 'early' && e.stack) errLines.push(`  stack: ${JSON.stringify(e.stack)}`);
      if (tier !== 'late') errLines.push(`  cycle: ${e.cycle}`);
      if (tier === 'early' && e.attempt !== undefined) errLines.push(`  attempt: ${e.attempt}`);
    }
    const errBlock: TreeBlock = { label: '__errors', lines: renderIndentedTree(errLines) };
    if (remainingTokens > approxTokens(renderBlock(errBlock, false))) {
      blocks.push(errBlock);
      remainingTokens -= approxTokens(renderBlock(errBlock, false));
    }
  }

  // ── Priority 3: expanded vars (truncated preview; LLM re-queries to drill in) ──
  for (const arg of input.expandedArgs) {
    // Apply InspectQuery if provided (slice/path/filter/sample/keys/count/search)
    // to narrow the value first, THEN preview-truncate what remains.
    const narrowed = arg.query ? applyQuery(arg.value, arg.query) : arg.value;
    const name = arg.name && arg.name.length > 0 ? arg.name : `arg${input.expandedArgs.indexOf(arg)}`;
    const repr = previewSerialize(narrowed, {}, name);
    const block: TreeBlock = {
      label: `__${name} (inspect preview)`,
      lines: renderIndentedTree(repr.split('\n')),
    };
    if (remainingTokens > approxTokens(renderBlock(block, false))) {
      blocks.push(block);
      remainingTokens -= approxTokens(renderBlock(block, false));
    }
  }

  // ── Priority 4: source tail ──
  if (input.sessionTs) {
    const tail = getSourceTail(input.sessionTs, tailLines);
    const block: TreeBlock = {
      label: 'sourceTail',
      lines: renderIndentedTree(tail.split('\n').map((line) => line.trimEnd())),
    };
    if (remainingTokens > approxTokens(renderBlock(block, false))) {
      blocks.push(block);
      remainingTokens -= approxTokens(renderBlock(block, false));
    }
  }

  // ── Priority 5: __tasks ──
  const taskLines = normalizeBlock(formatTasks(input.meta.tasks));
  const taskBlock: TreeBlock = { label: '__tasks', lines: renderIndentedTree(taskLines) };
  if (remainingTokens > approxTokens(renderBlock(taskBlock, false))) {
    blocks.push(taskBlock);
    remainingTokens -= approxTokens(renderBlock(taskBlock, false));
  }

  // ── Priority 6: __forks ──
  if (input.forkStates && Object.keys(input.forkStates).length > 0) {
    const forkLines = normalizeBlock(formatForks(input.forkStates));
    const block: TreeBlock = { label: '__forks', lines: renderIndentedTree(forkLines) };
    if (remainingTokens > approxTokens(renderBlock(block, false))) {
      blocks.push(block);
      remainingTokens -= approxTokens(renderBlock(block, false));
    }
  }

  // ── Priority 7: __display ──
  if (input.displayEntries && input.displayEntries.length > 0) {
    const maxEntries =
      tier === 'early'
        ? input.displayEntries.length
        : tier === 'mid'
          ? Math.ceil(input.displayEntries.length / 2)
          : Math.ceil(input.displayEntries.length / 4);
    const entries = input.displayEntries.slice(0, maxEntries);
    const block: TreeBlock = {
      label: '__display',
      lines: renderIndentedTree(entries.map((e) => `- ${e}`)),
    };
    if (remainingTokens > approxTokens(renderBlock(block, false))) {
      blocks.push(block);
      remainingTokens -= approxTokens(renderBlock(block, false));
    }
  }

  // ── Priority 8: __git ──
  {
    const cpList = input.git.checkpoints.length > 0
      ? ` cp: ${input.git.checkpoints.join(', ')}`
      : '';
    const gitBlock: TreeBlock = {
      label: 'git',
      lines: renderIndentedTree([`HEAD ${input.git.head} (${input.git.branch})${cpList}`]),
    };
    if (remainingTokens > approxTokens(renderBlock(gitBlock, false))) {
      blocks.push(gitBlock);
      remainingTokens -= approxTokens(renderBlock(gitBlock, false));
    }
  }

  // ── Priority 9: type feedback ──
  if (input.typeFeedback) {
    const block: TreeBlock = {
      label: '__type_feedback',
      lines: renderIndentedTree([input.typeFeedback]),
    };
    if (remainingTokens > approxTokens(renderBlock(block, false))) {
      blocks.push(block);
    }
  }

  const outLines: string[] = [`Reconstruction (inspect #${input.inspectNumber})`];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const isLast = i === blocks.length - 1;
    outLines.push(...renderBlockLines(block, isLast));
  }
  return outLines.join('\n');
}

// Re-export for consumers
export type { PromiseState } from './scope-serializer.js';
export { serializeScopeBlock, serializeScopeJson } from './scope-serializer.js';
