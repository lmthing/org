import type { YieldRequest } from './yield.js';
import type { Clock } from '../session/types.js';
import type { Space } from '../spaces/load.js';
import type { ForkEngine, ForkTask } from '../fork/fork.js';
import type { DelegateOpts } from '../globals/delegate.js';
import type { Tracer, TraceScope } from '../sandbox/trace.js';

/**
 * Dependencies the shared yield router needs to resolve the yield kinds common
 * to the full (session) VM and the delegate VM: sleep, fork, tasklist, delegate.
 *
 * The two genuine per-caller differences are parameterized:
 *  - `runDelegate` — the session builds a fresh registry from its spaces; a
 *    delegate recurses with depth+1. The caller supplies the right behaviour.
 *  - `onTasklistResult` — delegate uses it to auto-capture the action's tasklist
 *    result; the session leaves it undefined.
 */
export interface YieldRouterContext {
  space: Space;
  clock?: Clock;
  /** Lazily-resolved, shared ForkEngine (one per session/delegate scope) so the
   *  maxConcurrentForks semaphore is enforced across all fork/tasklist yields. */
  getForkEngine: () => ForkEngine | Promise<ForkEngine>;
  /** Resolve a delegate() yield. */
  runDelegate: (
    packageName: string,
    agentName: string,
    action: string | undefined,
    delegateOpts: DelegateOpts | undefined,
  ) => Promise<unknown>;
  /** Fired after a tasklist resolves (delegate uses it for auto-capture). */
  onTasklistResult?: (name: string, result: unknown) => void;
  /** Run a shell command host-side (cwd = space dir). */
  execCommand?: (cmd: string) => { ok: boolean; output: string };
  /** Tracer for minting child scopes in tasklist. */
  tracer?: Tracer;
  /** Current execution scope — becomes parentScope on spawned forks/delegates. */
  scope?: TraceScope;
}

export type RouteResult =
  | { handled: true; value: unknown }
  | { handled: false };

/**
 * Single resolver for the yield kinds shared by the session and delegate VMs.
 * Returns `{ handled: false }` for kinds the caller must handle itself
 * (ask/inspect/loadKnowledge/registerSpace are session-only; the fork leaf VM
 * handles its own sleep/loadKnowledge).
 *
 * This is the one place future async I/O yield kinds (fetch/execShell/tool) get
 * added — see the architecture roadmap, Wave 2/3.
 */
export async function routeCommonYield(
  req: YieldRequest,
  ctx: YieldRouterContext,
): Promise<RouteResult> {
  switch (req.kind) {
    case 'sleep': {
      const ms = req.args[1] as number;
      await new Promise<void>((resolve) => {
        if (ctx.clock) ctx.clock.setTimeout(resolve, ms);
        else setTimeout(resolve, ms);
      });
      return { handled: true, value: undefined };
    }
    case 'fork': {
      const engine = await ctx.getForkEngine();
      const task = req.args[0] as ForkTask;
      // Attach the current scope as parent so the fork's node is correctly nested
      if (ctx.scope && !task.parentScope) task.parentScope = ctx.scope;
      const value = await engine.fork(task);
      return { handled: true, value };
    }
    case 'tasklist': {
      const name = req.args[0] as string;
      const seed = req.args[1] as Record<string, unknown> | undefined;
      const engine = await ctx.getForkEngine();
      const { runTasklist } = await import('../tasklist/orchestrator.js');
      const result = await runTasklist({ name, space: ctx.space, forkEngine: engine, seed, tracer: ctx.tracer, parentScope: ctx.scope });
      ctx.onTasklistResult?.(name, result);
      return { handled: true, value: result };
    }
    case 'delegate': {
      const [packageName, agentName, action, delegateOpts] = req.args as [
        string,
        string,
        string | undefined,
        DelegateOpts | undefined,
      ];
      const value = await ctx.runDelegate(packageName, agentName, action, delegateOpts);
      return { handled: true, value };
    }
    default:
      return { handled: false };
  }
}
