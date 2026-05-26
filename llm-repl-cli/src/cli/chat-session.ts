/**
 * SpaceChatSession — interactive, multi-turn chat session backed by the
 * full llm-repl engine stack.
 *
 * One sandbox lives for the lifetime of the session. Each `handleUserMessage`
 * call runs one LLM cycle: build prompt → stream → execute statements → inspect
 * boundary. Reconstruction accumulates across turns so the model has full context.
 */
import { EventEmitter } from 'node:events';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
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
  marshalToHost,
  injectJsxRuntime,
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
  type InspectArg,
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
  parseFrontmatter,
} from '@lmthing/llm-repl/lib/spaces/index';
import type { LoadedDiskSpace } from '@lmthing/llm-repl/lib/spaces/disk';
import { runTsc } from '@lmthing/llm-repl/lib/typecheck/index';

import { resolveLLM, type ModelAlias } from '../session/model.js';
import { runSpaceSession } from '../session/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SpaceAgentInfo {
  slug: string;
  title: string;
  requiredKnowledge: Array<{ domain: string; field: string; options: string[]; label?: string }>;
}

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
  /** Inject a pre-built LanguageModel (skips resolveLLM; useful for testing). */
  model?: LanguageModel;
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
  // Set to true just before resolving the inspect deferred — triggers
  // a one-shot QuickJS interrupt that bypasses user try/catch blocks.
  private _interruptInspect = false;

  // Space/agent/flow metadata
  private _agentSlug = '';
  private _flowSlug = '';
  private _slugsExposed = false;
  private _ambientDts = '';
  private _model!: LanguageModel;
  private _pendingInjectArgs: Array<{ name: string; value: unknown }> = [];
  private _inspectVarNames = new Set<string>();
  private _diskSpace: LoadedDiskSpace | undefined;
  private _pendingKnowledge: Record<string, string> | undefined;
  private _knowledgeFormId: string | null = null;

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

    // One-shot interrupt handler: fires when _interruptInspect is true,
    // then immediately resets itself. This stops QuickJS execution at the
    // inspect() call site in a way that bypasses user try/catch blocks.
    ctx.runtime.setInterruptHandler(() => {
      if (this._interruptInspect) {
        this._interruptInspect = false;
        return true;
      }
      return false;
    });

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
        if (this._activeFormId === formId) {
          this._activeFormId = null;
          // Restore executing status when form ends (timeout fallback or external submit)
          if (this._status === 'waiting_for_input') this._setStatus('executing');
        }
        this._emitEvent({ type: 'ask_end', formId });
      },
    });
    this._renderEngine.registerGlobals(ctx);
    injectJsxRuntime(ctx);

    // Override JSX runtime to produce SerializedJSX { component, props, children } format
    // and inject built-in component names as string globals so `<TextInput />` resolves.
    ctx.evalCode(`
(function() {
  function makeNode(type, props) {
    var node = { component: typeof type === 'function' ? (type.displayName || type.name || 'Unknown') : String(type), props: {}, children: [] };
    if (props) {
      var kids = props.children;
      for (var k in props) { if (k !== 'children' && Object.prototype.hasOwnProperty.call(props, k)) node.props[k] = props[k]; }
      if (kids !== undefined) {
        node.children = Array.isArray(kids) ? kids : [kids];
      }
    }
    return node;
  }
  globalThis.__jsxRuntime = { jsx: makeNode, jsxs: makeNode, Fragment: '__Fragment__' };
  // Built-in component name globals
  var comps = ['TextInput','TextArea','NumberInput','Slider','Checkbox','Select','MultiSelect','DatePicker','Markdown','Table','Progress','Badge','Card','Button','Image','Link','Code','Alert','Chart','Form'];
  for (var i = 0; i < comps.length; i++) globalThis[comps[i]] = comps[i];
})();
`, '__jsx-setup.js');

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
      process.stderr.write(`  [fork] starting alias=${forkAlias} budget=${forkOpts?.tokenBudget}\n`);
      const forkModel = await resolveLLM(forkAlias);
      const forkStream = streamText({
        model: forkModel,
        system: 'You are executing a sub-task. Return ONLY valid JSON. No prose, no markdown fences.',
        prompt: cleanInstruction,
        maxOutputTokens: Math.min(forkOpts?.tokenBudget ?? 2000, 4000),
      });
      let text = '';
      for await (const chunk of forkStream.textStream) text += chunk;
      process.stderr.write(`  [fork] completed alias=${forkAlias} chars=${text.length}\n`);
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

    // Override inspect() so that Promise args (e.g. fork handles) are awaited
    // before the call is recorded. This ensures `await inspect(fork(...))` works
    // correctly — the cycle pauses until the fork LLM resolves.
    {
      const inspectFn = ctx.newFunction('inspect', (...argHandles) => {
        // Duplicate handles to keep them alive past this sync call
        const dupHandles = argHandles.map((h) => h.dup());
        const deferred = ctx.newPromise();

        (async () => {
          const args: InspectArg[] = [];
          for (const handle of dupHandles) {
            let value: unknown;
            const thenHandle = ctx.getProp(handle, 'then');
            const isPromise = ctx.typeof(thenHandle) === 'function';
            thenHandle.dispose();

            if (isPromise) {
              // Pump the QuickJS event loop until this Promise resolves
              const pump = setInterval(() => ctx.runtime.executePendingJobs(), 50);
              try {
                const resolved = await ctx.resolvePromise(handle);
                if (resolved.error) {
                  resolved.error.dispose();
                  value = null;
                } else {
                  value = marshalToHost(ctx, resolved.value);
                  resolved.value.dispose();
                }
              } finally {
                clearInterval(pump);
              }
            } else {
              value = marshalToHost(ctx, handle);
            }
            handle.dispose();
            args.push({ name: '', value });
          }

          const call: InspectCall = { args, timeout: 30000 };
          this._inspectCall = call;
          this._trace.write({ type: 'inspect', argCount: args.length });
          process.stderr.write(`  [inspect] recorded ${args.length} args, triggering interrupt\n`);
          // Arm the one-shot interrupt, then resolve the deferred so QuickJS
          // resumes from the `await inspect(...)` call — the very next bytecode
          // instruction hits the interrupt, stopping execution unconditionally.
          // This bypasses user try/catch blocks (unlike throwing a JS Error).
          this._interruptInspect = true;
          deferred.resolve(ctx.undefined);
          ctx.runtime.executePendingJobs();
        })().catch((err) => {
          process.stderr.write(`  [inspect] async error: ${err}\n`);
          deferred.resolve(ctx.undefined);
          ctx.runtime.executePendingJobs();
        });

        return deferred.handle;
      });
      ctx.setProp(ctx.global, 'inspect', inspectFn);
      inspectFn.dispose();
    }

    // ── Load space ──
    const loadedSpace = await loadSpaceFromDisk({
      sourceDir: spaceDir,
      sessionDir: this.sessionDir,
      trace: this._trace,
    });
    this._diskSpace = loadedSpace;

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

    injectGlobal(ctx, '__Space_read', (pathArg: unknown) => {
      const rel = String(pathArg ?? '');
      const abs = join(spaceFilesDir, rel);
      try { return readFileSync(abs, 'utf-8'); } catch { return null; }
    });

    injectGlobal(ctx, '__Space_list', (dirArg: unknown) => {
      const rel = String(dirArg ?? '');
      const abs = join(spaceFilesDir, rel);
      try { return readdirSync(abs); } catch { return []; }
    });

    injectGlobal(ctx, '__Space_delegate', async (spaceNameArg: unknown, agentArg: unknown, methodArg: unknown, instructionArg: unknown) => {
      const spaceName = String(spaceNameArg ?? '');
      const agentSlugArg = String(agentArg ?? '');
      const instruction = String(instructionArg ?? '');
      const currentSpaceName = basename(spaceDir);
      const knownSpaceDirs: Record<string, string> = {
        current: spaceDir,
        [currentSpaceName]: spaceDir,
        research: join(baseDir, '..', 'spaces', 'research'),
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
            write: function(path, content) { return __Space_write(path, content); },
            read: function(path) { return __Space_read(path); },
            list: function(dir) { return __Space_list(dir || ''); },
            loadKnowledge: function() { return undefined; }
          };
        }
        return {
          load: function(name) { return _makeProxy(name); },
          current: function() { return _makeProxy('current'); }
        };
      })();
    `);

    // delegate() — run another agent as a complete sub-session
    const currentSpaceDir = spaceDir;
    const sessionModelAlias = this._opts.modelAlias;
    const sessionBaseDir = baseDir;
    injectGlobal(ctx, 'delegate', async (specRaw: unknown) => {
      const spec = specRaw as {
        space?: string; agent?: string; flow?: string; task: string;
        modelAlias?: string; maxCycles?: number;
      };
      const subSpaceDir = spec.space
        ? (spec.space.startsWith('/') ? spec.space : join(dirname(currentSpaceDir), spec.space))
        : currentSpaceDir;
      this._trace.write({ type: 'delegate_start', space: subSpaceDir, agent: spec.agent ?? '', task: spec.task.slice(0, 100) });
      const sub = await runSpaceSession({
        spaceDir: subSpaceDir,
        task: spec.task,
        agent: spec.agent,
        flow: spec.flow,
        modelAlias: (spec.modelAlias ?? sessionModelAlias) as ModelAlias | undefined,
        maxCycles: spec.maxCycles ?? 6,
        baseDir: sessionBaseDir,
        verbose: false,
      });
      this._trace.write({ type: 'delegate_done', status: sub.manifest.finalStatus, outputBytes: (sub.output ?? '').length });
      return { output: sub.output, sessionDir: sub.manifest.sessionDir, status: sub.manifest.finalStatus };
    });

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

    // Store model reference (injected model takes precedence over env-var resolution)
    this._model = this._opts.model ?? await resolveLLM(this._opts.modelAlias ?? 'L');

    this._trace.write({
      type: 'space_loaded',
      agents: loadedSpace.agents.map((a) => a.slug),
      functions: loadedSpace.functions.map((f) => f.name),
      knowledgeDomains: loadedSpace.knowledge.map((k) => k.domain),
      flow: flow.slug,
      activeAgent: agent.slug,
      sink: flow.sink.name,
    });

    // Emit initial space_info with no pre-selection — user must pick agent/flow explicitly
    this._emitEvent({
      type: 'space_info',
      agentSlug: '',
      flowSlug: '',
      spaceDir: this._opts.spaceDir,
    });

    // Emit space metadata so client can populate @ picker
    this._emitEvent({
      type: 'space_metadata',
      agents: this._buildAgentInfos(),
    });

    this._setStatus('idle');
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async handleUserMessage(text: string): Promise<void> {
    if (this._status === 'executing') return; // debounce
    this._setStatus('executing');

    // Prepend any pending knowledge context selections
    let effectiveText = text;
    if (this._pendingKnowledge) {
      const ctx = Object.entries(this._pendingKnowledge)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      if (ctx) effectiveText = `[Knowledge context: ${ctx}]\n${text}`;
      this._pendingKnowledge = undefined;
    }

    const cycle = ++this._cycle;
    const blockId = `cycle_${cycle}_${Date.now()}`;

    try {
      const spaceDir = this._opts.spaceDir;
      const flowSlug = this._flowSlug || (await listFlows(spaceDir))[0]!;
      const flow = await loadFlow(spaceDir, flowSlug);
      const agentSlug = this._agentSlug || flow.defaultAgent || (await listAgents(spaceDir))[0]!;
      const agent = await loadAgent(spaceDir, agentSlug);

      // Broadcast resolved agent/flow to UI on first cycle (or after explicit switch)
      if (cycle === 1 || !this._slugsExposed) {
        this._agentSlug = agentSlug;
        this._flowSlug = flowSlug;
        this._slugsExposed = true;
        this._emitEvent({ type: 'space_info', agentSlug, flowSlug, spaceDir });
        const actions = this._getAgentActions(agentSlug);
        if (actions.length > 0) this._emitEvent({ type: 'actions', data: actions });
      }

      // Compute which flow step is active based on completed tasks (not raw cycle number)
      const completedTaskIds = this._tasklistEngine.getCompletedTaskIds();
      let stepIndex = 0;
      for (let si = 0; si < flow.steps.length; si++) {
        const stepTasks = Array.isArray(flow.steps[si]!.data.tasks)
          ? (flow.steps[si]!.data.tasks as unknown[]).map(String)
          : [];
        if (stepTasks.length === 0 || stepTasks.some(t => !completedTaskIds.has(t))) {
          stepIndex = si;
          break;
        }
        stepIndex = si + 1 < flow.steps.length ? si + 1 : si;
      }

      const built = await buildAgentPrompt({
        spaceDir,
        agent,
        flow,
        cycle,
        stepIndex,
      });
      this._ambientDts = built.ambientDts;
      if (this._inspectVarNames.size > 0) {
        this._ambientDts += '\n' + [...this._inspectVarNames].map(n => `declare const __${n}: unknown;`).join('\n');
      }

      const userPrompt = buildUserPrompt({
        cycle,
        task: effectiveText,
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

      // Execute the code — with up to 2 typecheck-retry rounds
      let codeToRun = stripModuleArtifacts(stripFences(assistantText.trim()));
      let tscResult = codeToRun.length > 0 ? runTsc(codeToRun, { sessionContext: this._ambientDts, availableModules: ['react', 'react/jsx-runtime'] }) : { diagnostics: [], js: '' };
      for (let tscAttempt = 0; tscAttempt < 2 && tscResult.diagnostics.length > 0; tscAttempt++) {
        const errLines = tscResult.diagnostics.slice(0, 5)
          .map(d => `  TS${d.code} L${d.line}:${d.column}: ${d.message.slice(0, 200)}`).join('\n');
        process.stderr.write(`  [tsc retry ${tscAttempt + 1}] ${tscResult.diagnostics.length} error(s)\n`);
        this._emitEvent({ type: 'code', lines: `\n// [TypeScript errors — retrying]\n`, blockId });
        const fixStream = streamText({
          model: this._model,
          system: built.systemPrompt,
          prompt: `Your previous code had TypeScript errors:\n${errLines}\n\nHere is the code that failed:\n\`\`\`ts\n${codeToRun}\n\`\`\`\n\nOutput corrected TypeScript only — no prose, no fences.`,
        });
        let fixedText = '';
        for await (const chunk of fixStream.textStream) {
          fixedText += chunk;
          this._emitEvent({ type: 'code', lines: chunk, blockId });
        }
        try {
          const usage = await fixStream.usage;
          this._budgetTracker.recordApiUsage(usage.inputTokens ?? 0, usage.outputTokens ?? 0);
        } catch { /* ignore */ }
        codeToRun = stripModuleArtifacts(stripFences(fixedText.trim()));
        tscResult = codeToRun.length > 0 ? runTsc(codeToRun, { sessionContext: this._ambientDts, availableModules: ['react', 'react/jsx-runtime'] }) : { diagnostics: [], js: '' };
      }

      const cleaned = codeToRun;
      await writeFile(join(this.sessionDir, `cycle-${cycle}.ts`), cleaned, 'utf-8');

      if (cleaned.length > 0) {
        const tsc = tscResult;

        // Strip ES module import statements — they're invalid inside an async IIFE in QuickJS.
        // JSX import (react/jsx-runtime) is replaced by binding from the pre-injected global.
        let jsForEval = tsc.js.replace(/^import\s+.*?(?:;|$)/gm, '').trimStart();

        // Guard any __scopeVar references that are NOT locally declared — prevents ReferenceError
        // when LLM references a prior-cycle inspect() variable that was never actually stored.
        // The ?? fallback in the generated code will then handle the undefined gracefully.
        const referencedScopeVars = [...jsForEval.matchAll(/\b(__[a-zA-Z_][a-zA-Z0-9_]*)\b/g)].map(m => m[1]!);
        const declaredScopeVars = new Set([...jsForEval.matchAll(/\b(?:var|let|const)\s+(__[a-zA-Z_][a-zA-Z0-9_]*)\b/g)].map(m => m[1]!));
        const guardPreamble = [...new Set(referencedScopeVars)]
          .filter(v => !declaredScopeVars.has(v))
          .map(v => `if (typeof ${v} === 'undefined') var ${v};`)
          .join('\n');
        if (guardPreamble) jsForEval = guardPreamble + '\n' + jsForEval;
        if (jsForEval.includes('_jsx') || jsForEval.includes('_jsxs')) {
          jsForEval = 'const { jsx: _jsx, jsxs: _jsxs, Fragment: _Fragment } = globalThis.__jsxRuntime;\n' + jsForEval;
        }
        const wrapped = `(async () => {\n${jsForEval}\n})();`;
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
                    setTimeout(() => r({ kind: 'timeout' }), 600000),
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
                    // Suppress errors that are expected inspect() stops:
                    // - InspectSignal: explicit JS throw (legacy path)
                    // - Any error when _inspectCall is set: the QuickJS interrupt fired
                    if (name !== 'InspectSignal' && !this._inspectCall) {
                      process.stderr.write(`  [eval error] ${name}: ${message}\n`);
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
        for (const { name } of inspectArgs) {
          if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
            this._inspectVarNames.add(name);
          }
        }

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

      // Auto-continue: if inspect() fired and the task isn't done, kick off the next cycle.
      // Reset to idle first — handleUserMessage guards against re-entry while executing.
      process.stderr.write(`  [cycle ${cycle}] post-eval: inspectCall=${!!this._inspectCall} status=${this._status}\n`);
      if (this._inspectCall && this._status !== 'complete' && this._status !== 'waiting_for_input') {
        this._setStatus('idle');
        process.stderr.write(`  [cycle ${cycle}] auto-continue → cycle ${cycle + 1}\n`);
        setImmediate(() => void this.handleUserMessage(text));
        return;
      }

      if (this._status !== 'complete' && this._status !== 'waiting_for_input') {
        this._setStatus('idle');
      }
    } catch (e) {
      process.stderr.write(`  [cycle ${this._cycle}] outer catch: ${e instanceof Error ? e.stack : String(e)}\n`);
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
      agentSlug: this._slugsExposed ? this._agentSlug : '',
      flowSlug: this._slugsExposed ? this._flowSlug : '',
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

  switchAgent(slug: string): void {
    if (!this._diskSpace) return;
    const agentEntry = this._diskSpace.agents.find((a) => a.slug === slug);
    if (!agentEntry) return;
    this._agentSlug = slug;
    this._slugsExposed = true;

    // Emit updated space_info
    this._emitEvent({
      type: 'space_info',
      agentSlug: this._agentSlug,
      flowSlug: this._flowSlug,
      spaceDir: this._opts.spaceDir,
    });

    // Emit this agent's actions for the / picker
    const agentActions = this._getAgentActions(slug);
    this._emitEvent({ type: 'actions', data: agentActions });

    // If the agent has dynamic (true) knowledge fields, show a form
    const agentInfo = this._buildAgentInfos().find((a) => a.slug === slug);
    if (agentInfo && agentInfo.requiredKnowledge.length > 0) {
      const formId = `kf_${Date.now()}`;
      this._knowledgeFormId = formId;
      this._emitEvent({
        type: 'knowledge_form',
        id: formId,
        agentSlug: slug,
        fields: agentInfo.requiredKnowledge.map((f) => ({
          domain: f.domain,
          field: f.field,
          label: f.label ?? f.field,
          options: f.options,
        })),
      });
    }
  }

  agentInfos(): SpaceAgentInfo[] {
    return this._buildAgentInfos();
  }

  currentActions(): Array<{ id: string; label: string; description: string }> {
    return this._getAgentActions(this._agentSlug);
  }

  submitKnowledge(id: string, data: Record<string, string>): void {
    if (id !== this._knowledgeFormId) return;
    this._pendingKnowledge = data;
    this._knowledgeFormId = null;
    this._emitEvent({ type: 'knowledge_form_done', id });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _buildAgentInfos(): SpaceAgentInfo[] {
    if (!this._diskSpace) return [];
    return this._diskSpace.agents.map((diskAgent) => {
      const knowledgeCfg = (diskAgent.config['knowledge'] ?? {}) as Record<string, Record<string, unknown>>;
      const requiredKnowledge: SpaceAgentInfo['requiredKnowledge'] = [];
      for (const [domain, fields] of Object.entries(knowledgeCfg)) {
        for (const [field, value] of Object.entries(fields)) {
          // Only include dynamic fields (value === true); array values are pre-loaded automatically
          if (value !== true) continue;
          const domainEntry = this._diskSpace!.knowledge.find((k) => k.domain === domain);
          const fieldEntry = domainEntry?.fields.find((f) => f.field === field);
          const options = fieldEntry?.options.map((o) => o.option) ?? [];
          const label = (fieldEntry?.config?.['label'] as string | undefined) ?? field;
          requiredKnowledge.push({ domain, field, options, label });
        }
      }
      // Parse title from instruct.md frontmatter
      let title = diskAgent.slug;
      try {
        const { data: instructData } = parseFrontmatter(diskAgent.instruct);
        if (typeof instructData['title'] === 'string') title = instructData['title'];
      } catch { /* fall back to slug */ }
      return { slug: diskAgent.slug, title, requiredKnowledge };
    });
  }

  private _getAgentActions(slug: string): Array<{ id: string; label: string; description: string }> {
    if (!this._diskSpace) return [];
    const diskAgent = this._diskSpace.agents.find((a) => a.slug === slug);
    if (!diskAgent) return [];
    try {
      const { data } = parseFrontmatter(diskAgent.instruct);
      const actions = data['actions'] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(actions)) return [];
      return actions
        .filter((a) => a['id'] && a['label'])
        .map((a) => ({
          id: String(a['id']),
          label: String(a['label']),
          description: String(a['description'] ?? ''),
        }));
    } catch {
      return [];
    }
  }

  private _setStatus(status: SessionStatus): void {
    this._status = status;
    this._emitEvent({ type: 'status', status });
  }

  private _emitEvent(event: Record<string, unknown>): void {
    this.emit('event', event);
  }
}
