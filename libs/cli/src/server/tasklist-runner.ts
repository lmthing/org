/**
 * Plan S9 — headless SPACE-tasklist runner + the code-node execution context.
 *
 * Two seams live here, both consumed by {@link ../session-manager.js SessionManager}:
 *
 *   1. {@link createCodeNodeCtxFactory} — builds the `codeNodeCtxFactory` the core
 *      tasklist orchestrator (`libs/core` S2) calls for every `kind:'code'` node.
 *      For each node it loads the node module's `run(ctx, inputs)` in a Node worker
 *      ({@link invokeNamedFnInWorker}) with a ctx whose `db`/`delegate`/`callConnection`
 *      are serviced main-side — store-downloaded node code never runs in-proc. The
 *      SAME factory is threaded into (a) the interactive session (so an agent's
 *      `tasklist()` yield can run code nodes) and (b) the headless runner below.
 *
 *   2. {@link runTasklistHeadless} — the standalone entry point (the `TasklistRunner`
 *      a hook handler's `ctx.tasklist.run('<spaceId>/<slug>', seed)` calls). It parses
 *      the `<spaceId>/<slug>` ref and delegates to `manager.runTasklistHeadless`,
 *      which owns the fork-engine + session-record plumbing (it needs the manager's
 *      private streamFn/resolvers). Keeping the heavy path on the manager maximizes
 *      reuse of the existing headless wiring; this module stays the thin, importable
 *      seam that `routes/hooks.ts` injects.
 *
 * Security (plan "Security invariants"): a space tasklist's code nodes are store
 * code — they execute ONLY worker-isolated + timeout-bounded, and their
 * `callConnection` is locked to the tasklist's declared `connections:` INTERSECT
 * the owning space's own provider(s), so a space can never reach beyond what it
 * itself declared (mirrors the space-hook gate in `routes/hooks.ts`).
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseFrontmatter } from '@lmthing/core';
import type { ConnectionRequest, ConnectionResolver, CodeNodeCtxFactory, TaskNode } from '@lmthing/core';
import { invokeNamedFnInWorker, type WorkerInvokeHandlers } from '../app/worker-load.js';
import type { ProjectAuthoringGlobals } from '../app/authoring/globals.js';

/** Dependencies {@link createCodeNodeCtxFactory} needs from the host (SessionManager).
 *  All are project-scoped closures the manager already has the pieces to build. */
export interface CodeNodeFactoryDeps {
  /** Lazily resolve the project's async db (or `null` for a spaces-only project).
   *  Called per code-node run so an interactive session that built the factory
   *  before its db booted still gets a live handle. */
  getDb: () => Promise<{ async: unknown } | null>;
  /** Run a headless agent for a code node's `ctx.delegate(spaceRef, action?, opts?)`
   *  — mirrors the hook ctx's delegate (returns the run's `DelegateResult`). */
  delegate: (spaceRef: string, action?: string, opts?: unknown) => Promise<unknown>;
  /** Pod connection resolver (bring-your-own-token). Gated per call by the
   *  tasklist's `connections:` ∩ the owning space's own provider(s). */
  connectionResolver: ConnectionResolver;
  /** Per-node worker wall-clock budget (ms). Omit for the worker-load default. */
  timeoutMs?: number;
  /** Typed live-project writers (`writeProjectTable`/`writeProjectApi`/`writeProjectPage`/
   *  `writeProjectComponent`/…) for CODE nodes that author files — the SAME host impls the
   *  agent nodes use, exposed on `ctx.<name>`. Omit for a project with no authoring. */
  projectAuthoring?: ProjectAuthoringGlobals;
}

/** Read a space's OWN connection provider(s) from `<spaceDir>/package.json`
 *  (`lmthing.connection.provider`). Best-effort — a missing/malformed manifest ⇒
 *  no own providers (every `callConnection` in the tasklist then throws). */
function spaceOwnProviders(spaceDir: string): Set<string> {
  try {
    const pkg = JSON.parse(readFileSync(join(spaceDir, 'package.json'), 'utf8')) as {
      lmthing?: { connection?: { provider?: unknown } };
    };
    const provider = pkg.lmthing?.connection?.provider;
    return typeof provider === 'string' && provider ? new Set([provider]) : new Set();
  } catch {
    return new Set();
  }
}

/** Read a tasklist's declared `connections:` from `<tasklistDir>/index.md`
 *  frontmatter (the tasklist-level gate). Best-effort — no index / no key ⇒ []. */
function tasklistDeclaredConnections(tasklistDir: string): string[] {
  try {
    const raw = readFileSync(join(tasklistDir, 'index.md'), 'utf8');
    const { data } = parseFrontmatter(raw, join(tasklistDir, 'index.md'));
    return Array.isArray(data['connections']) ? data['connections'].map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Build the {@link CodeNodeCtxFactory} the orchestrator calls per `kind:'code'`
 * node. The allowed-provider set for a node is derived ENTIRELY from its
 * `codeModulePath` (`.../<space>/tasklists/<slug>/NN-<id>.ts`): the owning space
 * dir and the tasklist dir are path-relative, so ONE session-wide factory works
 * for any tasklist the agent runs (the in-session path) and for the resolved
 * headless run alike. Result is cached per tasklist dir.
 */
export function createCodeNodeCtxFactory(deps: CodeNodeFactoryDeps): CodeNodeCtxFactory {
  const allowedCache = new Map<string, Set<string>>();

  const allowedFor = (codeModulePath: string): Set<string> => {
    const tasklistDir = dirname(codeModulePath);
    const cached = allowedCache.get(tasklistDir);
    if (cached) return cached;
    // .../<space>/tasklists/<slug>/NN-<id>.ts → space dir is two levels above the
    // tasklist dir (tasklists/<slug> → tasklists → <space>).
    const spaceDir = dirname(dirname(tasklistDir));
    const own = spaceOwnProviders(spaceDir);
    const declared = tasklistDeclaredConnections(tasklistDir);
    // Space tasklist: locked to declared ∩ own (a space can never reach beyond
    // what it itself declared AND owns).
    const allowed = new Set(declared.filter((p) => own.has(p)));
    allowedCache.set(tasklistDir, allowed);
    return allowed;
  };

  return (node: TaskNode) => ({
    runCodeNode: async (inputs) => {
      const modulePath = node.codeModulePath;
      if (!modulePath) {
        throw new Error(`code node "${node.id}" has no codeModulePath — cannot run`);
      }
      const allowed = allowedFor(modulePath);
      const db = await deps.getDb();
      const handlers: WorkerInvokeHandlers = {
        ...(db ? { db: db.async as WorkerInvokeHandlers['db'] } : {}),
        delegate: deps.delegate,
        callConnection: (provider, req) => {
          if (!allowed.has(provider)) {
            throw new Error(
              `callConnection("${provider}"): not allowed for tasklist "${basename(dirname(modulePath))}"` +
                (allowed.size
                  ? ` (allowed: ${[...allowed].sort().join(', ')})`
                  : ' — the tasklist declared no connections owned by its space'),
            );
          }
          return deps.connectionResolver(provider, req as ConnectionRequest);
        },
        ...(deps.projectAuthoring
          ? { authoring: deps.projectAuthoring as unknown as Record<string, (...args: unknown[]) => unknown> }
          : {}),
      };
      const out = await invokeNamedFnInWorker(
        modulePath,
        'run',
        [inputs],
        handlers,
        deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {},
      );
      return out && typeof out === 'object' ? (out as Record<string, unknown>) : {};
    },
  });
}

/** The manager surface {@link runTasklistHeadless} needs — the heavy fork-engine +
 *  session-record path lives on `SessionManager.runTasklistHeadless` (it needs the
 *  manager's private streamFn/resolvers). Structural so this module never imports
 *  the concrete `SessionManager` (and tests can fake it). */
export interface TasklistRunnerManager {
  runTasklistHeadless(args: {
    projectId: string;
    spaceId: string;
    slug: string;
    seed?: Record<string, unknown>;
  }): Promise<unknown>;
}

/** Parse a `<spaceId>/<slug>` tasklist ref. Extra path segments are folded back
 *  into the slug is NOT supported — a tasklist ref is exactly two segments. */
function parseTasklistRef(ref: string): { spaceId: string; slug: string } {
  const slash = ref.indexOf('/');
  if (slash < 0) {
    throw new Error(`invalid tasklist ref "${ref}": expected "<spaceId>/<slug>"`);
  }
  const spaceId = ref.slice(0, slash);
  const slug = ref.slice(slash + 1);
  if (!spaceId || !slug) {
    throw new Error(`invalid tasklist ref "${ref}": expected "<spaceId>/<slug>"`);
  }
  return { spaceId, slug };
}

/**
 * Run a SPACE tasklist headless (plan S9). Resolves `<spaceId>/<slug>` from the
 * ref and delegates to `manager.runTasklistHeadless`. This is the callable a hook
 * handler's `ctx.tasklist.run(ref, seed)` routes to; `routes/hooks.ts` injects a
 * per-project binding of it via {@link makeHookTasklistRunner}.
 */
export function runTasklistHeadless(opts: {
  root: string;
  projectId: string;
  ref: string;
  seed?: Record<string, unknown>;
  manager: TasklistRunnerManager;
}): Promise<unknown> {
  const { spaceId, slug } = parseTasklistRef(opts.ref);
  return opts.manager.runTasklistHeadless({ projectId: opts.projectId, spaceId, slug, seed: opts.seed });
}

/** Build the per-project `TasklistRunner` (`(ref, seed) => Promise`) that
 *  `routes/hooks.ts` injects into `runHook` so a hook handler's
 *  `ctx.tasklist.run('<spaceId>/<slug>', seed)` runs the resolved space tasklist
 *  headless. */
export function makeHookTasklistRunner(
  manager: TasklistRunnerManager,
  root: string,
  projectId: string,
): (ref: string, seed?: unknown) => Promise<unknown> {
  return (ref, seed) =>
    runTasklistHeadless({ root, projectId, ref, seed: seed as Record<string, unknown> | undefined, manager });
}
