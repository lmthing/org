import type { YieldRequest } from './yield.js';
import type { ApiCallFn, ConnectionResolver } from '../db/types.js';
import type { DocumentResolver } from '../globals/read-document.js';
import type { Clock } from '../session/types.js';
import type { Space } from '../spaces/load.js';
import type { ForkEngine, ForkTask } from '../fork/fork.js';
import type { DelegateOpts } from '../globals/delegate.js';
import type { Tracer, TraceScope } from '../sandbox/trace.js';

/**
 * Dependencies the shared yield router needs to resolve the yield kinds common
 * to the full (session) VM, the delegate VM and fork leaf VMs: sleep, fork,
 * tasklist, delegate, fetch — plus, for fork leaves (which have no session-side
 * handler to fall back to), loadKnowledge and registerSpace.
 *
 * The genuine per-caller differences are parameterized:
 *  - `runDelegate` — the session builds a fresh registry from its spaces; a
 *    delegate recurses with depth+1; a fork leaf gates on the task's
 *    `canDelegateTo` and routes to the engine's delegateRunner. The caller
 *    supplies the right behaviour.
 *  - `onTasklistResult` — delegate uses it to auto-capture the action's tasklist
 *    result; the session leaves it undefined.
 *  - `getForkEngine` — absent for fork leaves (no fork/tasklist there): those
 *    kinds fall through as unhandled, preserving the old leaf behaviour.
 */
export interface YieldRouterContext {
  /** Space for tasklist resolution. Absent in fork-leaf contexts (no tasklist there). */
  space?: Space;
  clock?: Clock;
  /** Lazily-resolved, shared ForkEngine (one per session/delegate scope) so the
   *  maxConcurrentForks semaphore is enforced across all fork/tasklist yields.
   *  Absent for fork leaves — fork/tasklist yields are then unhandled. */
  getForkEngine?: () => ForkEngine | Promise<ForkEngine>;
  /** Resolve a delegate() yield. May throw (e.g. a fork task's canDelegateTo
   *  gate) — the error surfaces to the model as a retryable yield error. */
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
  /** When set, loadKnowledge yields are resolved HERE by reading the file under
   *  `<knowledgeSpaceDir>/knowledge/…` and returning its content (fork leaves,
   *  which must win the race against the global's own concurrent resolve —
   *  otherwise undefined is bound before the file read completes). The session
   *  handles loadKnowledge itself; leave unset there. */
  knowledgeSpaceDir?: string;
  /** When true, registerSpace yields are resolved HERE (fork leaves): the space
   *  is loaded and inserted into `dynamicSpaces` when provided. The map is the
   *  SAME reference the parent Session hands to delegate(), so a space
   *  registered inside a fork is reachable by the parent's later delegate(). */
  resolveRegisterSpace?: boolean;
  dynamicSpaces?: Map<string, Space>;
  /** Resolve an `apiCall()` yield — enter the project's api runtime by endpoint
   *  `name` (host-supplied via the project's app globals). Absent outside a
   *  project-app context; an `apiCall` yield then rejects with a clear error. */
  apiCallResolver?: ApiCallFn;
  /** Resolve a `callConnection()` yield — forward the request to the gateway's
   *  egress proxy for the named connected service (host-supplied via the pod's
   *  scoped connections JWT). Absent outside a pod with a configured connections
   *  gateway; a `callConnection` yield then rejects with a clear error. */
  connectionResolver?: ConnectionResolver;
  /** Resolve a `tool()` yield — dispatch to a host-registered tool (specifically:
   *  an OpenClaw plugin tool loaded via `@lmthing/openclaw-compat`, host-supplied
   *  via `libs/cli`'s loaded `PluginRegistry`). Absent outside a pod with loaded
   *  plugin tools; a `tool` yield then rejects with a clear error. */
  toolResolver?: (name: string, input: unknown) => Promise<unknown>;
  /** Resolve a `readDocument()` yield — extract a stored upload's text host-side
   *  (host-supplied by libs/cli, where the uploads dir is known). Absent outside a
   *  pod/CLI with an uploads dir; a `readDocument` yield then rejects with a clear
   *  error. Not an app-global (project-independent) — threaded from SessionOpts. */
  documentResolver?: DocumentResolver;
}

export type RouteResult =
  | { handled: true; value: unknown }
  | { handled: false };

/**
 * Single resolver for the yield kinds shared by the session, delegate and fork
 * leaf VMs. Returns `{ handled: false }` for kinds the caller must handle itself
 * (ask/inspect are session-only; the session also resolves its own
 * loadKnowledge/registerSpace before consulting the router).
 *
 * `fetch` is real, non-blocking Node I/O — see `eval/fetch-yield.ts`. A future
 * `execShell`/`tool` yield kind would follow the same shape.
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
      if (!ctx.getForkEngine) return { handled: false }; // fork leaves have no fork()
      const engine = await ctx.getForkEngine();
      const task = req.args[0] as ForkTask;
      // Attach the current scope as parent so the fork's node is correctly nested
      if (ctx.scope && !task.parentScope) task.parentScope = ctx.scope;
      const value = await engine.fork(task);
      return { handled: true, value };
    }
    case 'tasklist': {
      if (!ctx.getForkEngine || !ctx.space) return { handled: false }; // fork leaves have no tasklist()
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
    case 'fetch': {
      const [url, fetchOpts] = req.args as [string, import('../globals/fetch.js').FetchOpts | undefined];
      const { resolveFetchYield } = await import('./fetch-yield.js');
      const value = await resolveFetchYield(url, fetchOpts);
      return { handled: true, value };
    }
    case 'apiCall': {
      // Enter the project's own api endpoint by name (agent-facing `apiCall`).
      // A missing resolver means this context has no project api runtime — throw
      // an actionable, retryable error rather than binding undefined.
      if (!ctx.apiCallResolver) {
        throw new Error('apiCall is not available here: this session has no project api runtime');
      }
      const [name, input] = req.args as [string, unknown];
      const value = await ctx.apiCallResolver(name, input);
      return { handled: true, value };
    }
    case 'callConnection': {
      // Forward an authenticated request to a connected external service via the
      // gateway egress proxy. A missing resolver means this context has no
      // connections gateway (e.g. local dev without LMTHING_CONNECTIONS_JWT) —
      // throw an actionable, retryable error rather than binding undefined.
      if (!ctx.connectionResolver) {
        throw new Error('callConnection is not available here: no connections gateway configured');
      }
      const [provider, request] = req.args as [string, import('../db/types.js').ConnectionRequest];
      const value = await ctx.connectionResolver(provider, request);
      return { handled: true, value };
    }
    case 'tool': {
      // Dispatch to a host-registered tool by name (agent-facing `tool()`). A
      // missing resolver means this context has no tool registry — throw an
      // actionable, retryable error rather than binding undefined.
      if (!ctx.toolResolver) {
        throw new Error('tool() is not available here: no tool registry configured');
      }
      const [name, input] = req.args as [string, unknown];
      const value = await ctx.toolResolver(name, input);
      return { handled: true, value };
    }
    case 'readDocument': {
      // Extract a stored upload's content host-side (unpdf for PDF, utf8 for text,
      // transcript for audio). A missing resolver means this context has no uploads
      // dir (e.g. a bare in-memory session) — throw an actionable, retryable error
      // rather than binding undefined.
      if (!ctx.documentResolver) {
        throw new Error('readDocument is not available here: no document resolver configured');
      }
      const [attachmentId, opts] = req.args as [string, { maxChars?: number } | undefined];
      const value = await ctx.documentResolver(attachmentId, opts);
      return { handled: true, value };
    }
    case 'loadKnowledge': {
      // Fork leaves only (knowledgeSpaceDir set): return the file CONTENT so it
      // wins the race against the global's own loadKnowledgeFile().then(resolve)
      // — otherwise undefined is bound before the file read completes.
      if (!ctx.knowledgeSpaceDir) return { handled: false };
      const { loadKnowledgeFile } = await import('../globals/load-knowledge.js');
      const { join } = await import('node:path');
      const filePath = join(ctx.knowledgeSpaceDir, 'knowledge', ...(req.args[0] as string).split('/'));
      return { handled: true, value: await loadKnowledgeFile(filePath) };
    }
    case 'registerSpace': {
      // Fork leaves only (resolveRegisterSpace set): load the space and insert it
      // into the SHARED dynamicSpaces map (same reference the parent Session hands
      // to delegate()), so a space registered inside a fork is reachable by the
      // parent's later delegate().
      if (!ctx.resolveRegisterSpace) return { handled: false };
      const { loadSpace } = await import('../spaces/load.js');
      const dir = req.args[0] as string;
      try {
        const space = await loadSpace(dir);
        ctx.dynamicSpaces?.set(dir, space);
        return { handled: true, value: { ok: true, spaceKey: dir, agentSlug: Object.keys(space.agents)[0] ?? '' } };
      } catch (err) {
        return { handled: true, value: { ok: false, spaceKey: '', agentSlug: '', error: String((err as Error)?.message ?? err) } };
      }
    }
    default:
      return { handled: false };
  }
}
