import { randomUUID } from 'node:crypto';
import type { SessionOpts, SessionDeps, RenderHost } from './types.js';
import type { StreamOpts } from '../eval/stream-types.js';
import type { YieldRequest } from '../eval/yield.js';
import { createVM } from '../sandbox/quickjs.js';
import type { VM } from '../sandbox/quickjs.js';
import { injectGlobal, marshalToQuickJS } from '../sandbox/host-bridge.js';
import { MessageHistory } from '../context/history.js';
import { buildSystemBlock } from '../context/system-block.js';
import { loadSpace } from '../spaces/load.js';
import type { Space } from '../spaces/load.js';
import {
  loadSystemSpaces,
  mergeSystemInto,
  defaultSystemSpaceDirs,
  systemFunctionSources,
  systemFunctionsBundled,
} from '../spaces/system.js';
import { createAskGlobal } from '../globals/ask.js';
import { createDisplayGlobal } from '../globals/display.js';
import { createInspectGlobal } from '../globals/inspect.js';
import { createSleepGlobal } from '../globals/sleep.js';
import { createLoadKnowledgeGlobal } from '../globals/load-knowledge.js';
import { createForkGlobal } from '../globals/fork.js';
import { createDelegateGlobal } from '../globals/delegate.js';
import { createTasklistGlobal } from '../globals/tasklist.js';
import { injectHostTools } from '../globals/host-tools.js';
import { runTurnLoop } from '../eval/turn-loop.js';
import { LIBRARY_DTS } from '../typecheck/library-dts.js';
import { buildOverlay } from '../typecheck/overlay.js';
import { transpileStatement } from '../typecheck/transpile.js';
import { getAgentFunctions, getAgentFunctionsBundled, resolveDirectDeps } from '../spaces/agent.js';
import { getAgentComponents } from '../spaces/components.js';
import { loadSnapshot } from './snapshot.js';
import type { Snapshot } from './snapshot.js';
import { Tracer } from '../sandbox/trace.js';

export class Session {
  private opts: SessionOpts;
  private deps: SessionDeps;
  private vm: VM | null = null;
  private history: MessageHistory;
  private space: Space | null = null;
  private sessionId: string;
  private tracer: Tracer;
  private systemBlock: string | null = null;
  private ambientDts: string | null = null;
  private agentFunctions: Record<string, string> = {};
  private agentFunctionsBundled: Record<string, string> = {};
  private systemSpaces: Space[] = [];

  constructor(opts: SessionOpts, deps: SessionDeps) {
    this.opts = opts;
    this.deps = deps;
    this.history = new MessageHistory();
    this.sessionId = randomUUID();
    this.tracer = new Tracer(opts.traceFile ?? null);
  }

  async continue(message: string): Promise<void> {
    if (!this.vm || !this.systemBlock || !this.ambientDts) {
      throw new Error('Session not started — call start() first');
    }
    this.history.append({
      role: 'user',
      content: `Write TypeScript code to accomplish the following task. Respond with TypeScript code only.\n\nTask: ${message}`,
      blockType: 'normal',
    });
    await runTurnLoop({
      vm: this.vm,
      history: this.history,
      systemBlock: this.systemBlock,
      ambientDts: this.ambientDts,
      renderHost: this.opts.renderHost,
      streamFn: this.deps.streamFn,
      processYield: (req) => this.handleYield(req),
      maxRetries: this.opts.maxRetries,
      tracer: this.tracer,
      traceContext: 'session',
    });
  }

  async start(initialMessage: string): Promise<void> {
    // 1. Load space + merge always-on system spaces
    this.space = await this.loadMergedSpace(this.opts.spaceDir);

    // 2. Get agent — fall back to first agent when slug is 'default'
    const agentKeys = Object.keys(this.space.agents);
    const resolvedSlug = this.opts.agentSlug === 'default' && !this.space.agents['default']
      ? agentKeys[0]
      : this.opts.agentSlug;
    if (!resolvedSlug) {
      throw new Error(`No agents found in space at "${this.opts.spaceDir}"`);
    }
    const agent = this.space.agents[resolvedSlug];
    if (!agent) {
      throw new Error(`Agent "${this.opts.agentSlug}" not found in space at "${this.opts.spaceDir}"`);
    }

    // 3. Create VM
    this.vm = await createVM();

    // 4. Inject all globals
    this.injectGlobals();

    // 5. Resolve direct dependencies
    const directDeps = resolveDirectDeps(this.space, agent.dependencies);

    // 6. Build system block (system functions rendered as a concise Built-in Tools list)
    const systemFns = systemFunctionSources(this.systemSpaces);
    const systemBlock = buildSystemBlock({ space: this.space, agent, directDeps, systemFunctions: systemFns });

    // 6b. Build ambient DTS overlay — system functions are always in scope, then agent functions
    const { functions: agentFunctions, functionsBundled: agentFunctionsBundled } =
      this.buildInjectedFunctions(this.space, agent);
    const agentComponents = getAgentComponents(this.space, agent);
    const overlay = buildOverlay(agentFunctions, agentComponents);
    const ambientDts = LIBRARY_DTS + '\n' + overlay;
    this.systemBlock = systemBlock;
    this.ambientDts = ambientDts;
    this.agentFunctions = agentFunctions;
    this.agentFunctionsBundled = agentFunctionsBundled;

    // 6c. Inject space functions and JSX runtime into VM
    this.injectSpaceFunctions(agentFunctions, agentFunctionsBundled);
    const allComponentNames = [
      ...Object.keys(agentComponents.view),
      ...Object.keys(agentComponents.form),
    ];
    this.injectJSXRuntime(allComponentNames);

    // 7. Append initial user message to history
    this.history.append({
      role: 'user',
      content: `Write TypeScript code to accomplish the following task. Respond with TypeScript code only.\n\nTask: ${initialMessage}`,
      blockType: 'normal',
    });

    this.tracer.write({ ts: Date.now(), type: 'session_start', sessionId: this.sessionId, spaceDir: this.opts.spaceDir, agentSlug: resolvedSlug! });

    // 8. Run turn loop until done or error
    await runTurnLoop({
      vm: this.vm,
      history: this.history,
      systemBlock,
      ambientDts,
      renderHost: this.opts.renderHost,
      streamFn: this.deps.streamFn,
      processYield: (req) => this.handleYield(req),
      maxRetries: this.opts.maxRetries,
      tracer: this.tracer,
      traceContext: 'session',
    });
  }

  async resume(snapshotDir: string, message: string): Promise<void> {
    const snapshot = await loadSnapshot(snapshotDir);
    if (!snapshot) {
      throw new Error(`No snapshot found in "${snapshotDir}"`);
    }

    // Load space + merge always-on system spaces
    this.space = await this.loadMergedSpace(snapshot.spaceDir);
    this.sessionId = snapshot.sessionId;

    // Get agent
    const agent = this.space.agents[snapshot.agentSlug];
    if (!agent) {
      throw new Error(`Agent "${snapshot.agentSlug}" not found`);
    }

    // Create VM and restore scope
    this.vm = await createVM();
    this.injectGlobals();

    for (const [name, value] of Object.entries(snapshot.scope)) {
      this.vm.setVar(name, value);
    }

    // Restore history
    this.history = new MessageHistory();
    for (const msg of snapshot.history) {
      this.history.append(msg);
    }

    // Append new user message
    this.history.append({ role: 'user', content: message, blockType: 'normal' });

    // Resolve direct deps and build system block
    const directDeps = resolveDirectDeps(this.space, agent.dependencies);
    const systemFns = systemFunctionSources(this.systemSpaces);
    const systemBlock = buildSystemBlock({ space: this.space, agent, directDeps, systemFunctions: systemFns });
    const { functions: agentFunctions, functionsBundled: agentFunctionsBundled } =
      this.buildInjectedFunctions(this.space, agent);
    const agentComponents = getAgentComponents(this.space, agent);
    const overlay = buildOverlay(agentFunctions, agentComponents);
    const ambientDts = LIBRARY_DTS + '\n' + overlay;
    this.agentFunctions = agentFunctions;
    this.agentFunctionsBundled = agentFunctionsBundled;
    this.injectSpaceFunctions(agentFunctions, agentFunctionsBundled);
    const allComponentNames = [
      ...Object.keys(agentComponents.view),
      ...Object.keys(agentComponents.form),
    ];
    this.injectJSXRuntime(allComponentNames);

    await runTurnLoop({
      vm: this.vm,
      history: this.history,
      systemBlock,
      ambientDts,
      renderHost: this.opts.renderHost,
      streamFn: this.deps.streamFn,
      processYield: (req) => this.handleYield(req),
      maxRetries: this.opts.maxRetries,
      tracer: this.tracer,
      traceContext: 'session',
    });
  }

  dispose(): void {
    if (this.vm) {
      this.vm.dispose();
      this.vm = null;
    }
  }

  /**
   * Load the user space and merge the always-on system spaces (fs, web, memory,
   * todo, agents) into it. The user space wins on name collisions. Stores the
   * loaded system spaces on the instance for function/overlay derivation.
   */
  private async loadMergedSpace(spaceDir: string): Promise<Space> {
    const userSpace = await loadSpace(spaceDir);
    const dirs = this.opts.systemSpaceDirs ?? defaultSystemSpaceDirs();
    this.systemSpaces = await loadSystemSpaces(dirs);
    return mergeSystemInto(userSpace, this.systemSpaces);
  }

  /**
   * Build the function maps injected into the VM: system functions are always
   * present (universal capability), agent-declared functions overlay them.
   */
  private buildInjectedFunctions(space: Space, agent: import('../spaces/load.js').AgentDef): {
    functions: Record<string, string>;
    functionsBundled: Record<string, string>;
  } {
    return {
      functions: { ...systemFunctionSources(this.systemSpaces), ...getAgentFunctions(space, agent) },
      functionsBundled: {
        ...systemFunctionsBundled(this.systemSpaces),
        ...getAgentFunctionsBundled(space, agent),
      },
    };
  }

  private injectGlobals(): void {
    if (!this.vm) throw new Error('VM not initialized');

    const pushYield = (req: YieldRequest) => {
      this.vm!.pendingYields.push(req);
    };

    const renderHost: RenderHost = this.opts.renderHost;

    type AnyFn = (...args: unknown[]) => unknown;
    injectGlobal(this.vm.ctx, 'ask', createAskGlobal(pushYield, renderHost) as AnyFn);
    injectGlobal(this.vm.ctx, 'display', createDisplayGlobal(renderHost) as AnyFn);
    injectGlobal(this.vm.ctx, 'inspect', createInspectGlobal(pushYield) as AnyFn);
    injectGlobal(this.vm.ctx, 'sleep', createSleepGlobal(pushYield, this.opts.clock) as AnyFn);
    injectGlobal(
      this.vm.ctx,
      'loadKnowledge',
      createLoadKnowledgeGlobal(pushYield, this.opts.spaceDir + '/knowledge') as AnyFn,
    );
    injectGlobal(this.vm.ctx, 'fork', createForkGlobal(pushYield) as AnyFn);
    injectGlobal(this.vm.ctx, 'delegate', createDelegateGlobal(pushYield) as AnyFn);
    injectGlobal(this.vm.ctx, 'tasklist', createTasklistGlobal(pushYield) as AnyFn);

    // Shared synchronous host substrate: console, execShell, process.env, fetch,
    // readFileRaw, writeFileRaw. Single source of truth (also used by fork VMs).
    injectHostTools(this.vm, { renderHost: this.opts.renderHost, spaceDir: this.opts.spaceDir });
  }

  private injectSpaceFunctions(functions: Record<string, string>, functionsBundled: Record<string, string>): void {
    if (!this.vm) throw new Error('VM not initialized');
    for (const name of Object.keys(functions)) {
      const bundled = functionsBundled[name];
      let js: string;
      if (bundled) {
        // Already bundled JS — strip ESM exports so it lands in script scope
        js = bundled
          .replace(/^export\s+default\s+function\s+/gm, `function ${name} `)
          .replace(/^export\s+default\s+/gm, `const ${name} = `)
          .replace(/^export\s+/gm, '');
      } else {
        // Transpile TS source to JS
        js = transpileStatement(functions[name]!)
          .replace(/^export\s+default\s+function\s+/gm, `function ${name} `)
          .replace(/^export\s+default\s+/gm, `const ${name} = `)
          .replace(/^export\s+/gm, '');
      }
      const result = this.vm.evalScript(`${js}\nglobalThis['${name}'] = ${name};`);
      if (!result.ok) {
        this.opts.renderHost.log(`[warn] failed to inject function "${name}": ${result.error}`);
      }
    }
  }

  private injectJSXRuntime(componentNames: string[]): void {
    if (!this.vm) throw new Error('VM not initialized');
    const ctx = this.vm.ctx;

    // Inject React shim for classic JSX transform (React.createElement → JSXDescriptor)
    const reactShim = {
      createElement: (type: unknown, props: unknown, ...children: unknown[]) => {
        const typeName =
          typeof type === 'string'
            ? type
            : type && typeof type === 'object' && 'displayName' in type
              ? (type as { displayName: string }).displayName
              : String(type);
        return {
          type: typeName,
          props: (props as Record<string, unknown>) ?? {},
          children: children.flat(Infinity).filter((c) => c !== null && c !== undefined),
        };
      },
      Fragment: 'fragment',
    };
    const reactHandle = marshalToQuickJS(ctx, reactShim);
    ctx.setProp(ctx.global, 'React', reactHandle);
    reactHandle.dispose();

    // Inject each component as a stub object with displayName so createElement resolves to the name
    for (const name of componentNames) {
      const stub = marshalToQuickJS(ctx, { displayName: name });
      ctx.setProp(ctx.global, name, stub);
      stub.dispose();
    }
  }

  private async handleYield(req: YieldRequest): Promise<unknown> {
    switch (req.kind) {
      case 'ask': {
        // args: [id, descriptor] — call renderHost.ask and await user input
        const [askId, descriptor] = req.args;
        return this.opts.renderHost.ask(askId as string, descriptor);
      }
      case 'inspect': {
        // inspect args already processed in globals/inspect.ts; value is in args[0]
        return req.args[0];
      }
      case 'loadKnowledge': {
        // args: resolved knowledge value
        return req.args[0];
      }
      case 'sleep': {
        const ms = req.args[1] as number;
        return new Promise<void>((resolve) => {
          if (this.opts.clock) {
            this.opts.clock.setTimeout(resolve, ms);
          } else {
            setTimeout(resolve, ms);
          }
        });
      }
      case 'tasklist': {
        const name = req.args[0] as string;
        const seed = req.args[1] as Record<string, unknown> | undefined;
        if (!this.space) throw new Error('Space not loaded');
        const { runTasklist } = await import('../tasklist/orchestrator.js');
        const { ForkEngine } = await import('../fork/fork.js');
        const forkEngine = new ForkEngine({
          maxConcurrentForks: this.opts.maxConcurrentForks ?? 4,
          parentHistory: this.history.messages,
          parentSpaceDir: this.opts.spaceDir,
          parentAgentSlug: this.opts.agentSlug,
          renderHost: this.opts.renderHost,
          streamFn: this.deps.streamFn,
          clock: this.opts.clock,
          tracer: this.tracer,
          agentFunctions: this.agentFunctions,
          agentFunctionsBundled: this.agentFunctionsBundled,
        });
        return runTasklist({ name, space: this.space, forkEngine, seed });
      }
      case 'fork': {
        const forkOpts = req.args[0] as import('../globals/fork.js').ForkGlobalOpts;
        if (!this.space) throw new Error('Space not loaded');
        const { ForkEngine } = await import('../fork/fork.js');
        const forkEngine = new ForkEngine({
          maxConcurrentForks: this.opts.maxConcurrentForks ?? 4,
          parentHistory: this.history.messages,
          parentSpaceDir: this.opts.spaceDir,
          parentAgentSlug: this.opts.agentSlug,
          renderHost: this.opts.renderHost,
          streamFn: this.deps.streamFn,
          clock: this.opts.clock,
          tracer: this.tracer,
          agentFunctions: this.agentFunctions,
          agentFunctionsBundled: this.agentFunctionsBundled,
        });
        return forkEngine.fork(forkOpts);
      }
      case 'delegate': {
        const [packageName, agentName, action, delegateOpts] = req.args as [
          string,
          string,
          string,
          import('../globals/delegate.js').DelegateOpts | undefined,
        ];
        if (!this.space) throw new Error('Space not loaded');
        const { runDelegate } = await import('../delegate/delegate.js');
        const { DelegateRegistry } = await import('../delegate/registry.js');
        const spaceMap = new Map<string, Space>([[this.opts.spaceDir, this.space]]);
        for (const [pkgName, depSpace] of Object.entries(this.space.dependentSpaces)) {
          spaceMap.set(pkgName, depSpace);
          spaceMap.set(depSpace.dir, depSpace);
        }
        const registry = new DelegateRegistry(spaceMap);
        return runDelegate({
          packageName,
          agentName,
          action,
          delegateOpts,
          registry,
          renderHost: this.opts.renderHost,
          streamFn: this.deps.streamFn,
          depth: 0,
          maxDepth: 5,
          maxConcurrentForks: this.opts.maxConcurrentForks ?? 4,
          clock: this.opts.clock,
          tracer: this.tracer,
        });
      }
      default:
        return undefined;
    }
  }
}
