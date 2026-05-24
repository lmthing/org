/**
 * SpaceChatSession — interactive, multi-turn chat session backed by the
 * full llm-repl engine stack.
 *
 * One sandbox lives for the lifetime of the session. Each `handleUserMessage`
 * call runs one LLM cycle: build prompt → stream → execute statements → inspect
 * boundary. Reconstruction accumulates across turns so the model has full context.
 */
import { EventEmitter } from 'node:events';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

import { streamText } from 'ai';
import type { LanguageModel } from 'ai';

import {
  createSandboxSession,
  BoundaryDetector,
  TraceWriter,
  ModuleRegistry,
  injectGlobal,
  marshalToQuickJS,
} from '@lmthing/llm-repl/lib/sandbox/index';
import { SessionAssembly } from '@lmthing/llm-repl/session/assembly';
import { BudgetTracker } from '@lmthing/llm-repl/lib/inspect/budget';
import type { ModelPricing } from '@lmthing/llm-repl/lib/inspect/budget';
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
  extractInspectArgNames,
  type InspectCall,
} from '@lmthing/llm-repl/lib/inspect/index';
import { buildReconstruction } from '@lmthing/llm-repl/context/reconstruction';
import {
  loadSpaceFromDisk,
  loadAgent,
  loadFlow,
  listAgents,
  listFlows,
  buildAgentPrompt,
  buildUserPrompt,
} from '@lmthing/llm-repl/lib/spaces/index';
import { runTsc } from '@lmthing/llm-repl/lib/typecheck/index';

import { resolveLLM, type ModelAlias } from '../session/model.js';
import { runSpaceSession } from '../session/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type SessionStatus =
  | 'idle'
  | 'executing'
  | 'waiting_for_input'
  | 'paused'
  | 'complete'
  | 'error';

export interface ChatSessionOptions {
  spaceDir: string;
  agent?: string;
  flow?: string;
  modelAlias?: ModelAlias;
  baseDir?: string;
  verbose?: boolean;
  sessionId?: string;
}

export interface SessionSnapshot {
  status: SessionStatus;
  scope: Array<{ name: string; type: string; value: string }>;
  asyncTasks: Array<{ id: string; label: string; status: string; elapsed: number }>;
  activeFormId: string | null;
  budget: {
    tokensUsed: number;
    tokensRemaining: number;
    costUsd: number;
    forksActive: number;
    forksCompleted: number;
    nearingLimit: boolean;
  };
  agentSlug: string;
  flowSlug: string;
  spaceDir: string;
  cycle: number;
}

// ── EventingTraceWriter ───────────────────────────────────────────────────────

class EventingTraceWriter extends TraceWriter {
  constructor(
    filePath: string,
    private readonly _onEvent: (event: Record<string, unknown>) => void,
  ) {
    super(filePath);
  }

  override write(event: Omit<{ ts: number; type: string; [key: string]: unknown }, 'ts'>): void {
    super.write(event);
    // Forward select trace events to the session event bus
    const t = (event as { type?: string }).type;
    if (
      t === 'fork_spawn' ||
      t === 'fork_resolve' ||
      t === 'fork_reject' ||
      t === 'checkpoint' ||
      t === 'space_loaded' ||
      t === 'space_file_write' ||
      t === 'memory_pin' ||
      t === 'memory_unpin' ||
      t === 'memory_compact'
    ) {
      this._onEvent(event as Record<string, unknown>);
    }
  }
}

// ── Pricing loader ────────────────────────────────────────────────────────────

function loadModelPricing(modelId: string): ModelPricing | null {
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), '../../prices.json'),
    join(dirname(fileURLToPath(import.meta.url)), '../prices.json'),
  ];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, ModelPricing>;
      return raw[modelId] ?? null;
    } catch {
      /* try next */
    }
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FENCE_RE = /^\s*```(?:ts|typescript|js|javascript)?\s*\n([\s\S]*?)\n\s*```\s*$/m;
function stripFences(text: string): string {
  const m = FENCE_RE.exec(text);
  if (m) return m[1]!;
  const start = text.indexOf('```');
  if (start >= 0) {
    const after = text.indexOf('\n', start);
    if (after > 0) {
      const end = text.lastIndexOf('```');
      if (end > after) return text.slice(after + 1, end).trim();
    }
  }
  return text;
}

function stripModuleArtifacts(text: string): string {
  return text
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/^(\s*)export\s+default\s+/gm, '$1')
    .replace(/^(\s*)export\s+(function|const|let|var|class|interface|type|enum|async)\b/gm, '$1$2')
    .trim();
}

interface SpaceModule {
  hostFunctions: Record<string, (...args: unknown[]) => unknown>;
}

async function importSpaceModule(spaceDir: string): Promise<SpaceModule> {
  const indexPath = join(spaceDir, 'index.ts');
  const mod = (await import(pathToFileURL(indexPath).href)) as Partial<SpaceModule>;
  if (!mod.hostFunctions) {
    throw new Error(`Space at ${spaceDir} does not export hostFunctions from index.ts`);
  }
  return mod as SpaceModule;
}

// ── SpaceChatSession ──────────────────────────────────────────────────────────

export class SpaceChatSession extends EventEmitter {
  readonly sessionId: string;
  readonly sessionDir: string;

  private _status: SessionStatus = 'idle';
  private _cycle = 0;
  private _reconstruction: string | undefined;
  private _activeFormId: string | null = null;

  // Engines (set during init)
  private _sandbox!: Awaited<ReturnType<typeof createSandboxSession>>;
  private _assembly!: SessionAssembly;
  private _trace!: EventingTraceWriter;
  private _budgetTracker!: BudgetTracker;
  private _renderEngine!: RenderEngine;
  private _tasklistEngine!: TasklistEngine;
  private _inspectCall: InspectCall | null = null;

  // Space/agent/flow metadata
  private _agentSlug = '';
  private _flowSlug = '';
  private _ambientDts = '';
  private _model!: LanguageModel;
  private _pendingInjectArgs: Array<{ name: string; value: unknown }> = [];

  constructor(private readonly _opts: ChatSessionOptions) {
    super();
    this.sessionId = _opts.sessionId ?? randomUUID();
    const baseDir = _opts.baseDir ?? join(tmpdir(), 'llm-repl-sessions');
    this.sessionDir = join(baseDir, `session-${this.sessionId}`);
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });

    const baseDir = this._opts.baseDir ?? join(tmpdir(), 'llm-repl-sessions');

    this._trace = new EventingTraceWriter(
      join(this.sessionDir, 'trace.jsonl'),
      (ev) => {
        // Forward trace events that have UI significance
        this._emitEvent({ ...ev, type: ev['type'] as string });
      },
    );

    this._assembly = new SessionAssembly(baseDir, this.sessionId);
    await this._assembly.init();

    // ── Load space/agent/flow ──
    const spaceDir = this._opts.spaceDir;
    const flowSlug = this._opts.flow ?? (await listFlows(spaceDir))[0];
    if (!flowSlug) throw new Error(`Space at ${spaceDir} has no flows/`);
    const flow = await loadFlow(spaceDir, flowSlug);

    const agentSlug = this._opts.agent ?? flow.defaultAgent ?? (await listAgents(spaceDir))[0];
    if (!agentSlug) throw new Error(`Space at ${spaceDir} has no agents/`);
    const agent = await loadAgent(spaceDir, agentSlug);

    this._agentSlug = agentSlug;
    this._flowSlug = flowSlug;

    // ── Budget ──
    const modelAlias: ModelAlias = this._opts.modelAlias ?? 'L';
    const modelId = (process.env[`LM_MODEL_${modelAlias}`] ?? '').replace(/^[^:]+:/, '');
    const pricing = loadModelPricing(modelId);
    this._budgetTracker = new BudgetTracker({
      contextWindowTokens: 64000,
      budgetRatio: 0.85,
      pricing: pricing ?? undefined,
    });
    this._budgetTracker.setHeap(0, 128);

    // ── Sandbox ──
    this._sandbox = await createSandboxSession({
      maxHeapMB: 128,
      maxStackSizeMb: 4,
      maxStatementMs: 120000,
    });
    const ctx = this._sandbox.ctx;

    // ── Engines ──
    new CheckpointEngine({
      assembly: this._assembly,
      trace: this._trace,
      onSettle: async () => ({ pendingCount: 0, elapsedMs: 0, timeouts: [] }),
    }).registerGlobals(ctx);

    this._renderEngine = new RenderEngine({
      trace: this._trace,
      config: { maxEntries: 100, maxTokens: 4000 },
      onDisplay: (id, descriptor) => {
        const componentId = id ?? `display_${Date.now()}`;
        this._emitEvent({ type: 'display', componentId, jsx: descriptor });
      },
      onAskStart: (formId, descriptor) => {
        this._activeFormId = formId;
        this._setStatus('waiting_for_input');
        this._emitEvent({ type: 'ask_start', formId, jsx: descriptor });
      },
      onAskEnd: (formId) => {
        if (this._activeFormId === formId) this._activeFormId = null;
        this._emitEvent({ type: 'ask_end', formId });
      },
    });
    this._renderEngine.registerGlobals(ctx);

    new MemoryEngine({ trace: this._trace, budgetTracker: this._budgetTracker }).registerGlobals(ctx);

    this._tasklistEngine = new TasklistEngine({
      trace: this._trace,
      evalFilter: (_f: string, el: unknown) => evalFilter({ type: 'literal', value: true }, el),
    });
    this._tasklistEngine.registerGlobals(ctx);

    const moduleRegistry = new ModuleRegistry(ctx);
    new IoEngine({
      trace: this._trace,
      fetch: { allowedDomains: ['*'], maxResponseBytes: 5 * 1024 * 1024, defaultTimeoutMs: 30000 },
      fs: { sandboxRoot: this.sessionDir, maxFileSizeBytes: 10 * 1024 * 1024 },
      moduleRegistry,
    }).registerGlobals(ctx);

    new ForkEngine({
      assembly: this._assembly,
      budgetTracker: this._budgetTracker,
      trace: this._trace,
      seedChildScope: (_exclude: string[]) => ({}),
      onBudgetWarning: (_forkId: string, _remaining: number) => {},
    }).registerGlobals(ctx);

    // Override fork() with real single-turn LLM executor
    injectGlobal(ctx, 'fork', async (optsArg: unknown) => {
      const forkOpts = optsArg as { instruction?: string; tokenBudget?: number };
      const instruction = forkOpts?.instruction ?? '';
      const modelMatch = instruction.match(/^\[model:(\w+)\]\s*/);
      const forkAlias = (modelMatch?.[1] as ModelAlias) ?? 'XS';
      const cleanInstruction = instruction.replace(/^\[model:\w+\]\s*/, '');
      const forkModel = await resolveLLM(forkAlias);
      const forkStream = streamText({
        model: forkModel,
        system: 'You are executing a sub-task. Return ONLY valid JSON. No prose, no markdown fences.',
        prompt: cleanInstruction,
        maxOutputTokens: forkOpts?.tokenBudget ?? 2000,
      });
      let text = '';
      for await (const chunk of forkStream.textStream) text += chunk;
      try {
        const usage = await forkStream.usage;
        this._budgetTracker.recordApiUsage(usage.inputTokens ?? 0, usage.outputTokens ?? 0);
      } catch {
        /* ignore */
      }
      const cleaned = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '').trim();
      let value: unknown;
      try {
        value = JSON.parse(cleaned);
      } catch {
        value = cleaned || null;
      }
      this._trace.write({ type: 'fork_resolve', alias: forkAlias, chars: cleanInstruction.length });
      return value;
    });

    new SnapshotEngine({
      assembly: this._assembly,
      trace: this._trace,
      config: { maxHeapMB: 128 },
    });

    registerInspectGlobals(ctx, {
      budget: this._budgetTracker,
      trace: this._trace,
      onInspect: (call) => {
        this._inspectCall = call;
      },
    });

    // ── Load space ──
    const loadedSpace = await loadSpaceFromDisk({
      sourceDir: spaceDir,
      sessionDir: this.sessionDir,
      trace: this._trace,
    });

    // Load host functions
    const spaceModule = await importSpaceModule(spaceDir);
    for (const [name, fn] of Object.entries(spaceModule.hostFunctions)) {
      injectGlobal(ctx, name, fn);
    }

    // Space file writer shim
    const spaceFilesDir = join(this.sessionDir, 'space', 'files');
    await mkdir(spaceFilesDir, { recursive: true });

    injectGlobal(ctx, '__Space_write', async (pathArg: unknown, contentArg: unknown) => {
      const rel = String(pathArg ?? '');
      const content = String(contentArg ?? '');
      const abs = join(spaceFilesDir, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf-8');
      this._trace.write({ type: 'space_file_write', method: 'write', path: abs });
      return undefined;
    });

    injectGlobal(ctx, '__Space_delegate', async (spaceNameArg: unknown, agentArg: unknown, methodArg: unknown, instructionArg: unknown) => {
      const spaceName = String(spaceNameArg ?? '');
      const agentSlugArg = String(agentArg ?? '');
      const instruction = String(instructionArg ?? '');
      const knownSpaceDirs: Record<string, string> = {
        research: join(baseDir, '..', 'spaces', 'research'),
        cooking: spaceDir,
      };
      const subSpaceDir = knownSpaceDirs[spaceName] ?? join(dirname(spaceDir), spaceName);
      this._trace.write({ type: 'space_delegate', space: spaceName, agent: agentSlugArg, method: String(methodArg), instructionLen: instruction.length });
      const sub = await runSpaceSession({
        spaceDir: subSpaceDir,
        task: instruction,
        agent: agentSlugArg,
        modelAlias: this._opts.modelAlias,
        maxCycles: 4,
        baseDir,
        verbose: false,
      });
      return { output: sub.output, status: sub.manifest.finalStatus };
    });

    ctx.evalCode(`
      var Space = (function() {
        function _makeProxy(spaceName) {
          return {
            loadAgent: function(slug) { return this; },
            agents: new Proxy({}, {
              get: function(_, agentSlug) {
                return new Proxy({}, {
                  get: function(__, method) {
                    return function(opts, instruction) {
                      var instr = typeof instruction === 'string' ? instruction : (typeof opts === 'string' ? opts : JSON.stringify(opts));
                      return __Space_delegate(spaceName, agentSlug, method, instr);
                    };
                  }
                });
              }
            }),
            write: function(path, content) { return __Space_write(path, content); }
          };
        }
        return {
          load: function(name) { return _makeProxy(name); },
          current: function() { return _makeProxy('current'); }
        };
      })();
    `);

    // Sink: when the flow's sink fires, mark the session complete
    injectGlobal(ctx, flow.sink.name, (...a: unknown[]) => {
      const output = String(a[0] ?? '');
      this._trace.write({ type: 'sink_fired', sink: flow.sink.name, bytes: output.length });
      this._setStatus('complete');
      this._emitEvent({ type: 'session_output', output });
      return undefined;
    });

    // Build the ambient DTS from the loaded space for type-checking
    const built = await buildAgentPrompt({
      spaceDir,
      agent,
      flow,
      cycle: 1,
    });
    this._ambientDts = built.ambientDts;

    // Store model reference
    this._model = await resolveLLM(this._opts.modelAlias ?? 'L');

    this._trace.write({
      type: 'space_loaded',
      agents: loadedSpace.agents.map((a) => a.slug),
      functions: loadedSpace.functions.map((f) => f.name),
      knowledgeDomains: loadedSpace.knowledge.map((k) => k.domain),
      flow: flow.slug,
      activeAgent: agent.slug,
      sink: flow.sink.name,
    });

    // Emit initial space_info block for the UI
    this._emitEvent({
      type: 'space_info',
      agentSlug: this._agentSlug,
      flowSlug: this._flowSlug,
      spaceDir: this._opts.spaceDir,
    });

    this._setStatus('idle');
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async handleUserMessage(text: string): Promise<void> {
    if (this._status === 'executing') return; // debounce
    this._setStatus('executing');

    const cycle = ++this._cycle;
    const blockId = `cycle_${cycle}_${Date.now()}`;

    try {
      const spaceDir = this._opts.spaceDir;
      const flowSlug = this._opts.flow ?? (await listFlows(spaceDir))[0]!;
      const flow = await loadFlow(spaceDir, flowSlug);
      const agentSlug = this._opts.agent ?? flow.defaultAgent ?? (await listAgents(spaceDir))[0]!;
      const agent = await loadAgent(spaceDir, agentSlug);

      const built = await buildAgentPrompt({
        spaceDir,
        agent,
        flow,
        cycle,
      });
      this._ambientDts = built.ambientDts;

      const userPrompt = buildUserPrompt({
        cycle,
        task: text,
        ...(this._reconstruction ? { reconstruction: this._reconstruction } : {}),
      });

      // Stream LLM
      const stream = streamText({ model: this._model, system: built.systemPrompt, prompt: userPrompt });

      let assistantText = '';
      const ctx = this._sandbox.ctx;
      this._inspectCall = null;

      // Inject values from previous inspect into QuickJS scope
      for (const { name, value } of this._pendingInjectArgs) {
        try {
          const handle = marshalToQuickJS(ctx, value);
          ctx.setProp(ctx.global, name, handle);
          handle.dispose();
        } catch {
          /* ignore unmarshalable values */
        }
      }
      this._pendingInjectArgs = [];

      // Stream and emit code events
      for await (const chunk of stream.textStream) {
        assistantText += chunk;
        this._emitEvent({ type: 'code', lines: chunk, blockId });
      }
      this._emitEvent({ type: 'code_complete', blockId, lineCount: assistantText.split('\n').length });

      // Record LLM usage
      const costBefore = this._budgetTracker.costUsd;
      try {
        const usage = await stream.usage;
        this._budgetTracker.recordApiUsage(usage.inputTokens ?? 0, usage.outputTokens ?? 0);
      } catch {
        /* ignore */
      }

      // Execute the code
      const cleaned = stripModuleArtifacts(stripFences(assistantText.trim()));
      await writeFile(join(this.sessionDir, `cycle-${cycle}.ts`), cleaned, 'utf-8');

      if (cleaned.length > 0) {
        const tsc = runTsc(cleaned, { sessionContext: this._ambientDts });

        if (this._opts.verbose && tsc.diagnostics.length > 0) {
          for (const d of tsc.diagnostics.slice(0, 5)) {
            process.stderr.write(`  ⚠ TS${d.code} L${d.line}:${d.column} ${d.message.slice(0, 200)}\n`);
          }
        }

        const wrapped = `(async () => {\n${tsc.js}\n})();`;
        try {
          const result = await ctx.evalCodeAsync(wrapped);
          ctx.runtime.executePendingJobs();
          if (result.error) {
            const errVal = ctx.dump(result.error) as { name?: string; message?: string };
            result.error.dispose();
            this._emitEvent({
              type: 'error',
              blockId: `err_${blockId}`,
              error: { type: errVal.name ?? 'Error', message: errVal.message ?? String(errVal), line: 0 },
            });
          } else {
            const valTypeof = ctx.typeof(result.value);
            if (valTypeof === 'object') {
              const thenHandle = ctx.getProp(result.value, 'then');
              const thenTypeof = ctx.typeof(thenHandle);
              thenHandle.dispose();
              if (thenTypeof === 'function') {
                const pump = setInterval(() => ctx.runtime.executePendingJobs(), 100);
                const resolvedPromise = ctx.resolvePromise(result.value);
                const winner = await Promise.race([
                  resolvedPromise.then((v) => ({ kind: 'ok' as const, v })),
                  new Promise<{ kind: 'timeout' }>((r) =>
                    setTimeout(() => r({ kind: 'timeout' }), 120000),
                  ),
                ]);
                clearInterval(pump);
                if (winner.kind === 'timeout') {
                  this._emitEvent({
                    type: 'error',
                    blockId: `err_${blockId}`,
                    error: { type: 'Timeout', message: 'Execution timed out after 120s', line: 0 },
                  });
                } else {
                  const resolved = winner.v;
                  if (resolved.error) {
                    const errVal = ctx.dump(resolved.error) as { name?: string; message?: string } | string;
                    resolved.error.dispose();
                    const name = typeof errVal === 'object' && errVal ? (errVal as { name?: string }).name : undefined;
                    const message = typeof errVal === 'string' ? errVal : (errVal as { message?: string })?.message ?? JSON.stringify(errVal);
                    if (name !== 'InspectSignal') {
                      this._emitEvent({
                        type: 'error',
                        blockId: `err_${blockId}`,
                        error: { type: name ?? 'Error', message, line: 0 },
                      });
                    }
                  } else {
                    resolved.value.dispose();
                  }
                }
              }
            }
            result.value.dispose();
            ctx.runtime.executePendingJobs();
          }
        } catch (e) {
          this._emitEvent({
            type: 'error',
            blockId: `err_${blockId}`,
            error: { type: 'HostError', message: e instanceof Error ? e.message : String(e), line: 0 },
          });
        }
      }

      // Build reconstruction if inspect fired
      if (this._inspectCall) {
        let recoveredNames: string[] = [];
        const extracted = extractInspectArgNames(cleaned);
        if (extracted) recoveredNames = extracted.names;
        const nameFor = (idx: number, runtimeName: string): string => {
          if (recoveredNames[idx] && recoveredNames[idx]!.length > 0) return recoveredNames[idx]!;
          if (runtimeName && runtimeName.length > 0) return runtimeName;
          return `arg${idx}`;
        };

        const inspectArgs = (this._inspectCall as InspectCall).args.map((a, i) => ({
          name: nameFor(i, a.name),
          value: a.value,
          ...(a.query ? { query: a.query } : {}),
        }));

        this._pendingInjectArgs = inspectArgs.map(({ name, value }) => ({
          name: `__${name}`,
          value,
        }));

        // Emit read event
        const readPayload: Record<string, unknown> = {};
        for (const { name, value } of inspectArgs) {
          readPayload[name] = value;
        }
        this._emitEvent({ type: 'read', blockId: `read_${blockId}`, payload: readPayload });

        const budget = this._budgetTracker.snapshot();
        const taskNudge = this._tasklistEngine.getAllNudges() ?? undefined;

        this._reconstruction = buildReconstruction({
          inspectNumber: cycle,
          sessionTs: text,
          scope: {},
          meta: {
            budgetTokensUsed: budget.tokensUsed,
            budgetTokensRemaining: budget.tokensRemaining,
            inspectCount: cycle,
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
          expandedArgs: inspectArgs,
          git: { head: 'HEAD', checkpoints: [], branch: 'main' },
          tasklistNudge: taskNudge,
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
          tokenBudget: 64000,
          routerFlags: {},
        });
      }

      // Emit budget update
      const budget = this._budgetTracker.snapshot();
      const cycleCost = this._budgetTracker.costUsd - costBefore;
      this._emitEvent({
        type: 'budget_update',
        tokensUsed: budget.tokensUsed,
        tokensRemaining: budget.tokensRemaining,
        costUsd: budget.costUsd,
        cycleCostUsd: cycleCost,
        inputTokens: budget.inputTokensUsed,
        outputTokens: budget.outputTokensUsed,
        forksActive: budget.forksActive,
        forksCompleted: budget.forksCompleted,
        nearingLimit: budget.nearingLimit,
      });

      if (this._status !== 'complete' && this._status !== 'waiting_for_input') {
        this._setStatus('idle');
      }
    } catch (e) {
      this._emitEvent({
        type: 'error',
        blockId: `err_${blockId}`,
        error: { type: 'SessionError', message: e instanceof Error ? e.message : String(e), line: 0 },
      });
      this._setStatus('idle');
    }
  }

  submitForm(formId: string, data: Record<string, unknown>): void {
    this._renderEngine.submitAsk(formId, data);
    if (this._activeFormId === formId) {
      this._activeFormId = null;
      if (this._status === 'waiting_for_input') this._setStatus('executing');
    }
  }

  cancelAsk(formId: string): void {
    this._renderEngine.submitAsk(formId, { _cancelled: true });
    if (this._activeFormId === formId) {
      this._activeFormId = null;
      if (this._status === 'waiting_for_input') this._setStatus('executing');
    }
  }

  // pause / resume are best-effort (checked between async boundaries)
  pause(): void {
    if (this._status === 'executing') this._setStatus('paused');
  }

  resume(): void {
    if (this._status === 'paused') this._setStatus('executing');
  }

  handleIntervention(text: string): void {
    // Append to reconstruction so next cycle sees it
    const marker = `\n// [user intervention] ${text}\n`;
    this._reconstruction = (this._reconstruction ?? '') + marker;
    this._emitEvent({ type: 'intervention', text });
  }

  snapshot(): SessionSnapshot {
    const budget = this._budgetTracker?.snapshot();
    return {
      status: this._status,
      scope: [],
      asyncTasks: [],
      activeFormId: this._activeFormId,
      budget: budget
        ? {
            tokensUsed: budget.tokensUsed,
            tokensRemaining: budget.tokensRemaining,
            costUsd: budget.costUsd,
            forksActive: budget.forksActive,
            forksCompleted: budget.forksCompleted,
            nearingLimit: budget.nearingLimit,
          }
        : { tokensUsed: 0, tokensRemaining: 64000, costUsd: 0, forksActive: 0, forksCompleted: 0, nearingLimit: false },
      agentSlug: this._agentSlug,
      flowSlug: this._flowSlug,
      spaceDir: this._opts.spaceDir,
      cycle: this._cycle,
    };
  }

  dispose(): void {
    try {
      this._renderEngine?.endSession();
      this._sandbox?.dispose();
    } catch {
      /* ignore */
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _setStatus(status: SessionStatus): void {
    this._status = status;
    this._emitEvent({ type: 'status', status });
  }

  private _emitEvent(event: Record<string, unknown>): void {
    this.emit('event', event);
  }
}
