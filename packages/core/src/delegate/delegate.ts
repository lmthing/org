import type { RenderHost, Clock } from '../session/types.js';
import type { StreamOpts, StreamSession } from '../eval/stream-types.js';
import type { DelegateQuery, DelegateOpts } from '../globals/delegate.js';
import type { DelegateRegistry } from './registry.js';
import { createVM } from '../sandbox/quickjs.js';
import { injectGlobal, marshalToQuickJS } from '../sandbox/host-bridge.js';
import { MessageHistory } from '../context/history.js';
import { buildSystemBlock } from '../context/system-block.js';
import { runTurnLoop } from '../eval/turn-loop.js';
import { LIBRARY_DTS } from '../typecheck/library-dts.js';
import { validateOutput } from '../tasklist/schema.js';

export interface RunDelegateOpts {
  target: string;
  queryOrAction: DelegateQuery | string;
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
  if (opts.depth >= opts.maxDepth) {
    throw new Error(
      `Maximum delegation depth (${opts.maxDepth}) exceeded at target "${opts.target}"`,
    );
  }

  const { space, agent } = await opts.registry.resolveLazy(opts.target);

  const directDeps: Array<{ space: typeof space; agent: typeof agent }> = [];
  for (const dep of agent.dependencies) {
    try {
      const depResult = opts.registry.resolve(dep);
      directDeps.push(depResult);
    } catch {
      // Ignore unresolvable deps at this stage
    }
  }

  const systemBlock = buildSystemBlock({ space, agent, directDeps });

  const vm = await createVM();

  try {
    const history = new MessageHistory();

    // Build user message based on query mode
    let userMessage: string;
    let outputSchema: Record<string, string> | undefined;

    if (typeof opts.queryOrAction === 'string') {
      // Mode 2: explicit action ID
      const actionId = opts.queryOrAction;
      const action = agent.actions.find((a) => a.id === actionId);
      if (!action) {
        throw new Error(`Action "${actionId}" not found on agent "${agent.slug}"`);
      }

      const query = opts.delegateOpts?.query ?? '';
      const context = opts.delegateOpts?.context;
      userMessage = [
        `Run action: ${actionId}`,
        query ? `Query: ${query}` : '',
        context ? `Context: ${JSON.stringify(context)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      // Mode 1: query with optional output schema
      const query = opts.queryOrAction;
      outputSchema = query.output;
      userMessage = [
        `Query: ${query.query}`,
        query.context ? `Context: ${JSON.stringify(query.context)}` : '',
        outputSchema
          ? `Expected output schema: ${JSON.stringify(outputSchema)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    history.append({ role: 'user', content: userMessage, blockType: 'normal' });

    // Inject result capture global
    let capturedResult: unknown = undefined;
    let resultCaptured = false;

    const captureHandle = marshalToQuickJS(vm.ctx, {
      resolve: (value: unknown) => {
        if (outputSchema && !validateOutput(outputSchema, value)) {
          // Log mismatch but still capture
          opts.renderHost.log(`Delegate output schema mismatch for "${opts.target}"`);
        }
        capturedResult = value;
        resultCaptured = true;
      },
    });
    vm.ctx.setProp(vm.ctx.global, 'currentTask', captureHandle);
    captureHandle.dispose();

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
      ambientDts: LIBRARY_DTS,
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
          const [target, queryOrAction, delegateOpts2] = req.args as [
            string,
            DelegateQuery | string,
            DelegateOpts | undefined,
          ];
          return runDelegate({
            ...opts,
            target,
            queryOrAction,
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
