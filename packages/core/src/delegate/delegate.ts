import type { RenderHost, Clock } from '../session/types.js';
import type { StreamOpts, StreamSession } from '../eval/stream-types.js';
import type { DelegateOpts } from '../globals/delegate.js';
import type { DelegateRegistry } from './registry.js';
import type { Tracer, TraceScope } from '../sandbox/trace.js';
import { NULL_TRACER } from '../sandbox/trace.js';
import { resolveDirectDeps, getAgentFunctions, getAgentFunctionsBundled } from '../spaces/agent.js';
import { getAgentComponents } from '../spaces/components.js';
import { CATALOG_NAMES } from '../ui/catalog.js';
import { createVM } from '../sandbox/quickjs.js';
import { injectGlobal, marshalToQuickJS } from '../sandbox/host-bridge.js';
import { MessageHistory } from '../context/history.js';
import { buildSystemBlock } from '../context/system-block.js';
import { runTurnLoop } from '../eval/turn-loop.js';
import { routeCommonYield } from '../eval/yield-router.js';
import { LIBRARY_DTS } from '../typecheck/library-dts.js';
import { buildOverlay } from '../typecheck/overlay.js';
import { injectSpaceFunctions } from '../sandbox/inject-functions.js';
import { injectHostTools } from '../globals/host-tools.js';
import { systemFunctionSources, systemFunctionsBundled } from '../spaces/system.js';
import type { Space } from '../spaces/load.js';

export interface RunDelegateOpts {
  packageName: string;
  agentName: string;
  action: string;
  delegateOpts?: DelegateOpts;
  registry: DelegateRegistry;
  renderHost: RenderHost;
  streamFn: (opts: StreamOpts) => Promise<StreamSession>;
  depth: number;
  maxDepth: number;
  maxConcurrentForks: number;
  clock?: Clock;
  tracer?: Tracer;
  /** Parent execution scope for hierarchical observability. */
  scope?: TraceScope;
  systemSpaces?: Space[];
}

export async function runDelegate(opts: RunDelegateOpts): Promise<unknown> {
  const target = `${opts.packageName}/${opts.agentName}`;

  if (opts.depth >= opts.maxDepth) {
    throw new Error(
      `Maximum delegation depth (${opts.maxDepth}) exceeded at target "${target}"`,
    );
  }

  const { space, agent } = await opts.registry.resolveLazy(target);

  // Seed registry with this space's npm deps so nested delegates can resolve them
  for (const [pkgName, depSpace] of Object.entries(space.dependentSpaces)) {
    opts.registry.addSpace(pkgName, depSpace);
    opts.registry.addSpace(depSpace.dir, depSpace);
  }

  const tracer = opts.tracer ?? NULL_TRACER;
  const delegateLabel = `delegate:${opts.packageName}/${opts.agentName}/${opts.action}`;
  // Mint a delegate scope for full observability; end() in finally below
  const delegateScope = tracer.child(opts.scope, 'delegate', delegateLabel, {
    pkg: opts.packageName,
    agent: opts.agentName,
    action: opts.action,
    depth: opts.depth,
  });

  const directDeps = resolveDirectDeps(space, agent.dependencies);

  const systemBlock = buildSystemBlock({ space, agent, directDeps });

  const vm = await createVM();

  try {
    const history = new MessageHistory();

    const actionDef = agent.actions.find((a) => a.id === opts.action);
    if (!actionDef) {
      throw new Error(`Action "${opts.action}" not found on agent "${agent.slug}"`);
    }

    const query = opts.delegateOpts?.query ?? '';
    const context = opts.delegateOpts?.context;
    const tasklistHint = actionDef.tasklist
      ? `Implement this action by calling \`const result = await tasklist("${actionDef.tasklist}", context)\` where context is any seed data from above. The tasklist handles the orchestration. After it resolves, call \`currentTask.resolve(result)\`.`
      : `When complete, call \`currentTask.resolve(result)\` with the final result value.`;
    const userMessage = [
      `Run action: ${opts.action}`,
      query ? `Query: ${query}` : '',
      context ? `Context: ${JSON.stringify(context)}` : '',
      tasklistHint,
    ]
      .filter(Boolean)
      .join('\n');

    history.append({ role: 'user', content: userMessage, blockType: 'normal' });

    // Build overlay DTS for this agent's functions and components
    const agentFunctions = getAgentFunctions(space, agent);
    const agentFunctionsBundled = getAgentFunctionsBundled(space, agent);
    const agentComponents = getAgentComponents(space, agent);
    const overlay = buildOverlay(agentFunctions, agentComponents);
    // currentTask is injected below; declare it in DTS so typecheck passes
    const currentTaskDts = `declare const currentTask: { resolve: (value: unknown) => void };`;
    const ambientDts = LIBRARY_DTS + '\n' + overlay + '\n' + currentTaskDts;

    // Inject result capture global
    let capturedResult: unknown = undefined;
    let resultCaptured = false;

    const captureHandle = marshalToQuickJS(vm.ctx, {
      resolve: (value: unknown) => {
        capturedResult = value;
        resultCaptured = true;
      },
    });
    vm.ctx.setProp(vm.ctx.global, 'currentTask', captureHandle);
    captureHandle.dispose();

    // Inject space functions into the VM (combining system functions and agent functions)
    const systemSpaces = opts.systemSpaces ?? [];
    const functions = { ...systemFunctionSources(systemSpaces), ...agentFunctions };
    const functionsBundled = { ...systemFunctionsBundled(systemSpaces), ...agentFunctionsBundled };

    injectSpaceFunctions(vm, functions, functionsBundled, (name, error) => {
      opts.renderHost.log(`[warn] failed to inject function "${name}": ${error}`);
    });

    // Shared synchronous host substrate: console, execShell, process.env, fetch,
    // readFileRaw, writeFileRaw.
    injectHostTools(vm, { renderHost: opts.renderHost, spaceDir: space.dir });

    // Inject React shim + component stubs for JSX
    const reactShim = {
      createElement: (type: unknown, props: unknown, ...children: unknown[]) => {
        const typeName =
          typeof type === 'string'
            ? type
            : type && typeof type === 'object' && 'displayName' in type
              ? (type as { displayName: string }).displayName
              : String(type);
        return { type: typeName, props: (props as Record<string, unknown>) ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined) };
      },
      Fragment: 'fragment',
    };
    const reactHandle = marshalToQuickJS(vm.ctx, reactShim);
    vm.ctx.setProp(vm.ctx.global, 'React', reactHandle);
    reactHandle.dispose();
    const allComponentNames = [...CATALOG_NAMES, ...Object.keys(agentComponents.view), ...Object.keys(agentComponents.form)];
    for (const name of allComponentNames) {
      const stub = marshalToQuickJS(vm.ctx, { displayName: name });
      vm.ctx.setProp(vm.ctx.global, name, stub);
      stub.dispose();
    }

    // Inject standard globals
    const { createAskGlobal } = await import('../globals/ask.js');
    const { createDisplayGlobal } = await import('../globals/display.js');
    const { createInspectGlobal } = await import('../globals/inspect.js');
    const { createSleepGlobal } = await import('../globals/sleep.js');
    const { createForkGlobal } = await import('../globals/fork.js');
    const { createDelegateGlobal } = await import('../globals/delegate.js');
    const { createTasklistGlobal } = await import('../globals/tasklist.js');
    const { createLoadKnowledgeGlobal } = await import('../globals/load-knowledge.js');

    const pushYield = (req: import('../eval/yield.js').YieldRequest) => {
      vm.pendingYields.push(req);
    };

    type AnyFn = (...args: unknown[]) => unknown;
    injectGlobal(vm.ctx, 'ask', createAskGlobal(pushYield, opts.renderHost) as AnyFn);
    injectGlobal(vm.ctx, 'display', createDisplayGlobal(opts.renderHost, (value) => {
      tracer.write({ ts: Date.now(), type: 'display', context: delegateScope.label, nodeId: delegateScope.nodeId, descriptor: value });
    }) as AnyFn);
    injectGlobal(vm.ctx, 'inspect', createInspectGlobal(pushYield) as AnyFn);
    injectGlobal(vm.ctx, 'sleep', createSleepGlobal(pushYield, opts.clock) as AnyFn);
    injectGlobal(
      vm.ctx,
      'loadKnowledge',
      createLoadKnowledgeGlobal(pushYield, space.dir + '/knowledge') as AnyFn,
    );
    injectGlobal(vm.ctx, 'fork', createForkGlobal(pushYield) as AnyFn);
    injectGlobal(vm.ctx, 'delegate', createDelegateGlobal(pushYield) as AnyFn);
    injectGlobal(vm.ctx, 'tasklist', createTasklistGlobal(pushYield) as AnyFn);

    const { ForkEngine } = await import('../fork/fork.js');
    const forkEngine = new ForkEngine({
      maxConcurrentForks: opts.maxConcurrentForks,
      parentHistory: history.messages,
      parentSpaceDir: space.dir,
      parentAgentSlug: agent.slug,
      agentFunctions: functions,
      agentFunctionsBundled: functionsBundled,
      renderHost: opts.renderHost,
      streamFn: opts.streamFn,
      clock: opts.clock,
      tracer: opts.tracer,
    });

    try {
      await runTurnLoop({
        vm,
        history,
        systemBlock,
        ambientDts,
        renderHost: opts.renderHost,
        streamFn: opts.streamFn,
        processYield: async (req) => {
          // sleep / fork / tasklist / delegate share the central router. The two
          // delegate-specific behaviours are passed as hooks: auto-capture of the
          // action's tasklist result, and depth-incremented recursion.
          const routed = await routeCommonYield(req, {
            space,
            clock: opts.clock,
            tracer: opts.tracer,
            scope: delegateScope,
            getForkEngine: () => forkEngine,
            onTasklistResult: (name, result) => {
              if (name === actionDef.tasklist && !resultCaptured) {
                capturedResult = result;
                resultCaptured = true;
              }
            },
            runDelegate: (packageName, agentName, action, delegateOpts2) =>
              runDelegate({
                ...opts,
                packageName,
                agentName,
                action,
                delegateOpts: delegateOpts2,
                scope: delegateScope,
                depth: opts.depth + 1,
              }),
          });
          return routed.handled ? routed.value : undefined;
        },
        maxRetries: 3,
        tracer: tracer,
        traceContext: delegateLabel,
        scope: delegateScope,
      });
      tracer.end(delegateScope, 'done', resultCaptured ? { result: capturedResult } : undefined);
    } catch (err) {
      tracer.end(delegateScope, 'error', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }

    return resultCaptured ? capturedResult : undefined;
  } finally {
    vm.dispose();
  }
}
