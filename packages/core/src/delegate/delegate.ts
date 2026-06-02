import type { RenderHost, Clock } from '../session/types.js';
import type { StreamOpts, StreamSession } from '../eval/stream-types.js';
import type { DelegateOpts } from '../globals/delegate.js';
import type { DelegateRegistry } from './registry.js';
import { resolveDirectDeps, getAgentFunctions, getAgentFunctionsBundled } from '../spaces/agent.js';
import { getAgentComponents } from '../spaces/components.js';
import { createVM } from '../sandbox/quickjs.js';
import { injectGlobal, marshalToQuickJS } from '../sandbox/host-bridge.js';
import { MessageHistory } from '../context/history.js';
import { buildSystemBlock } from '../context/system-block.js';
import { runTurnLoop } from '../eval/turn-loop.js';
import { LIBRARY_DTS } from '../typecheck/library-dts.js';
import { buildOverlay } from '../typecheck/overlay.js';
import { transpileStatement } from '../typecheck/transpile.js';

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
    const userMessage = [
      `Run action: ${opts.action}`,
      query ? `Query: ${query}` : '',
      context ? `Context: ${JSON.stringify(context)}` : '',
      `When complete, call \`currentTask.resolve(result)\` with the final result value.`,
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

    // Inject space functions into the VM
    for (const name of Object.keys(agentFunctions)) {
      const bundled = agentFunctionsBundled[name];
      let js: string;
      if (bundled) {
        js = bundled
          .replace(/^export\s+default\s+function\s+/gm, `function ${name} `)
          .replace(/^export\s+default\s+/gm, `const ${name} = `)
          .replace(/^export\s+/gm, '');
      } else {
        js = transpileStatement(agentFunctions[name]!)
          .replace(/^export\s+default\s+function\s+/gm, `function ${name} `)
          .replace(/^export\s+default\s+/gm, `const ${name} = `)
          .replace(/^export\s+/gm, '');
      }
      const fnResult = vm.evalScript(`${js}\nglobalThis['${name}'] = ${name};`);
      if (!fnResult.ok) {
        opts.renderHost.log(`[warn] failed to inject function "${name}": ${fnResult.error}`);
      }
    }

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
    const allComponentNames = [...Object.keys(agentComponents.view), ...Object.keys(agentComponents.form)];
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
    injectGlobal(vm.ctx, 'display', createDisplayGlobal(opts.renderHost) as AnyFn);
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
      renderHost: opts.renderHost,
      streamFn: opts.streamFn,
      clock: opts.clock,
    });

    await runTurnLoop({
      vm,
      history,
      systemBlock,
      ambientDts,
      renderHost: opts.renderHost,
      streamFn: opts.streamFn,
      processYield: async (req) => {
        if (req.kind === 'sleep') {
          const ms = req.args[1] as number;
          return new Promise<void>((res) => {
            if (opts.clock) {
              opts.clock.setTimeout(res, ms);
            } else {
              setTimeout(res, ms);
            }
          });
        }
        if (req.kind === 'tasklist') {
          const { runTasklist } = await import('../tasklist/orchestrator.js');
          return runTasklist({ name: req.args[0] as string, space, forkEngine });
        }
        if (req.kind === 'fork') {
          return forkEngine.fork(req.args[0] as import('../fork/fork.js').ForkTask);
        }
        if (req.kind === 'delegate') {
          const [packageName, agentName, action, delegateOpts2] = req.args as [
            string,
            string,
            string,
            DelegateOpts | undefined,
          ];
          return runDelegate({
            ...opts,
            packageName,
            agentName,
            action,
            delegateOpts: delegateOpts2,
            depth: opts.depth + 1,
          });
        }
        return undefined;
      },
      maxRetries: 3,
    });

    return resultCaptured ? capturedResult : undefined;
  } finally {
    vm.dispose();
  }
}
