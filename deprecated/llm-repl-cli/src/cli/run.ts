/**
 * run.ts — Phase 13 CLI Surface & Cutover
 *
 * Wires all engines together and runs a single agent cycle stub.
 * The full streaming loop with LLM generation lands in a follow-up phase.
 * This phase: accept userMessage → initialize engines → run one cycle →
 *   execute statements → stop at inspect or end → build reconstruction → return.
 */
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import {
  createSandboxSession,
  BoundaryDetector,
  TraceWriter,
  ModuleRegistry,
} from '@lmthing/llm-repl/lib/sandbox/index';

import { SessionAssembly } from '@lmthing/llm-repl/session/assembly';
import { BudgetTracker } from '@lmthing/llm-repl/lib/inspect/budget';
import { CheckpointEngine } from '@lmthing/llm-repl/lib/checkpoint/checkpoint';
import { RenderEngine } from '@lmthing/llm-repl/lib/render/render';
import { MemoryEngine } from '@lmthing/llm-repl/lib/memory/memory';
import { TasklistEngine } from '@lmthing/llm-repl/lib/tasklist/tasklist';
import { IoEngine } from '@lmthing/llm-repl/lib/io/io';
import { ForkEngine } from '@lmthing/llm-repl/lib/fork/fork';
import { SnapshotEngine } from '@lmthing/llm-repl/lib/snapshot/snapshot';
import {
  registerInspectGlobals,
  evalFilter,
} from '@lmthing/llm-repl/lib/inspect/index';
import type { InspectCall } from '@lmthing/llm-repl/lib/inspect/index';
import { buildReconstruction } from '@lmthing/llm-repl/context/reconstruction';

import { Router } from '../router/index.js';

export interface RunConfig {
  sessionId?: string;
  baseDir: string;
  provider: string;
  systemPromptExtra?: string;
  spaceDir?: string;
  contextWindowTokens?: number;
  budgetRatio?: number;
  maxHeapMB?: number;
}

export interface RunResult {
  sessionId: string;
  reconstruction: string;
  decision: ReturnType<Router['decide']>;
}

export async function runSession(config: RunConfig, userMessage: string): Promise<RunResult> {
  const sessionId = config.sessionId ?? randomUUID();
  const sessionDir = join(config.baseDir, `session-${sessionId}`);
  await mkdir(sessionDir, { recursive: true });

  // ── Trace ──
  const trace = new TraceWriter(join(sessionDir, 'trace.jsonl'));

  // ── Assembly ──
  const assembly = new SessionAssembly(config.baseDir, sessionId);
  await assembly.init();

  // ── Budget ──
  const contextWindowTokens = config.contextWindowTokens ?? 32000;
  const maxHeapMB = config.maxHeapMB ?? 64;
  const budgetTracker = new BudgetTracker({
    contextWindowTokens,
    budgetRatio: config.budgetRatio ?? 0.8,
  });
  budgetTracker.setHeap(0, maxHeapMB);

  // ── Sandbox ──
  const sandbox = await createSandboxSession({
    maxHeapMB,
    maxStackSizeMb: 4,
    maxStatementMs: 10000,
  });
  const { ctx } = sandbox;

  // ── Checkpoint ──
  const checkpointEngine = new CheckpointEngine({
    assembly,
    trace,
    onSettle: async () => ({ pendingCount: 0, elapsedMs: 0, timeouts: [] }),
  });
  checkpointEngine.registerGlobals(ctx);

  // ── Render ──
  const renderEngine = new RenderEngine({
    trace,
    config: { maxEntries: 50, maxTokens: 2000 },
  });
  renderEngine.registerGlobals(ctx);

  // ── Memory ──
  const memoryEngine = new MemoryEngine({
    trace,
    budgetTracker,
  });
  memoryEngine.registerGlobals(ctx);

  // ── Tasklist ──
  const tasklistEngine = new TasklistEngine({
    trace,
    evalFilter: (filterExpr: string, el: unknown) => evalFilter(
      { type: 'literal', value: true }, // noop placeholder
      el,
    ),
  });
  tasklistEngine.registerGlobals(ctx);

  // ── IO ──
  const moduleRegistry = new ModuleRegistry(ctx);
  const ioEngine = new IoEngine({
    trace,
    fetch: {
      allowedDomains: ['*'],
      maxResponseBytes: 5 * 1024 * 1024,
      defaultTimeoutMs: 30000,
    },
    fs: {
      sandboxRoot: sessionDir,
      maxFileSizeBytes: 10 * 1024 * 1024,
    },
    moduleRegistry,
  });
  ioEngine.registerGlobals(ctx);

  // ── Fork ──
  const forkEngine = new ForkEngine({
    assembly,
    budgetTracker,
    trace,
    seedChildScope: (_exclude: string[]) => ({}),
    onBudgetWarning: (_forkId: string, _remaining: number) => {},
  });
  forkEngine.registerGlobals(ctx);

  // ── Snapshot ──
  const _snapshotEngine = new SnapshotEngine({
    assembly,
    trace,
    config: { maxHeapMB },
  });

  // ── Inspect ──
  let inspectCall: InspectCall | null = null;
  registerInspectGlobals(ctx, {
    budget: budgetTracker,
    trace,
    onInspect: (call) => { inspectCall = call; },
  });

  // ── Boundary detector ──
  const detector = new BoundaryDetector();

  // ── Router ──
  const router = new Router({
    trace,
    resolveAlias: (alias) => {
      const envVar = `LM_MODEL_${alias}`;
      return process.env[envVar] ?? `alias:${alias}`;
    },
  });

  // Routing decision
  const decision = router.decide({
    trigger: 'new_message',
    cycle: 1,
    tokensRemaining: budgetTracker.tokensRemaining,
    heapMB: 0,
    heapMaxMB: maxHeapMB,
    errorStreak: 0,
    annotationMismatchStreak: 0,
    hasTasklist: false,
    hasInProgressTask: false,
    tasksCompleted: 0,
    totalTasks: 0,
    state: {
      errorStreak: 0,
      annotationMismatchStreak: 0,
      analyzerRefires: 0,
      cachedDifficulty: null,
      lastInstructionCycle: 0,
      budgetWarning: false,
      heapWarning: false,
      recoveryContext: false,
    },
  });

  trace.write({ type: 'session_start', sessionId, userMessage, decision: decision.role });

  // ── Stub agent loop (single cycle) ──
  // Phase 13: wire components conceptually.
  // Real streaming loop with LLM generation lands in follow-up phase.
  // Feed user message through boundary detector, execute any extracted statements.
  const stmts = detector.feed(userMessage);
  const remaining = detector.flush();
  const allStmts = remaining ? [...stmts, remaining] : stmts;

  for (const stmt of allStmts) {
    budgetTracker.recordStatement();
    budgetTracker.recordStatementSinceInspect();

    if (inspectCall) break;

    try {
      const result = await ctx.evalCodeAsync(stmt);
      if (result.error) {
        result.error.dispose();
      } else {
        result.value.dispose();
      }
    } catch {
      // Ignore execution errors in stub cycle
    }
  }

  // ── Build reconstruction ──
  const budget = budgetTracker.snapshot();

  const reconstruction = buildReconstruction({
    inspectNumber: 1,
    sessionTs: userMessage,
    scope: {},
    meta: {
      budgetTokensUsed: budget.tokensUsed,
      budgetTokensRemaining: budget.tokensRemaining,
      inspectCount: 1,
      annotationGraceUsed: false,
      pins: {},
      compactions: {},
      errors: [],
      tasks: [],
    },
    pins: new Set(),
    compactions: new Map(),
    promiseStates: new Map(),
    lastAccessedCycle: new Map(),
    errors: [],
    expandedArgs: inspectCall != null
      ? (inspectCall as InspectCall).args.map((a) => ({
          name: a.name,
          value: a.value,
          query: a.query,
        }))
      : [],
    git: { head: 'HEAD', checkpoints: [], branch: 'main' },
    budgetTokensRemaining: budget.tokensRemaining,
    budgetTokensUsed: budget.tokensUsed,
    budgetInputTokensUsed: budget.inputTokensUsed,
    budgetOutputTokensUsed: budget.outputTokensUsed,
    budgetCostUsd: budget.costUsd,
    budgetContext: budget.context,
    budgetExecution: budget.execution,
    forksActive: budget.forksActive,
    forksCompleted: budget.forksCompleted,
    nearingLimit: budget.nearingLimit,
    tokenBudget: contextWindowTokens,
    routerFlags: decision.flags,
  });

  // Cleanup
  sandbox.dispose();

  trace.write({ type: 'session_end', sessionId });

  return { sessionId, reconstruction, decision };
}
