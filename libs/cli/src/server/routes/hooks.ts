/**
 * Phase 6C — the pod-side hook execution seam.
 *
 * Three responsibilities, all wired around ONE authoritative endpoint
 * (`POST /api/projects/:projectId/hooks/:slug/run`) so Studio's manual "Run now",
 * the pod's native crond, and the boot catch-up all drive the *same* dispatch path:
 *
 *   1. {@link createHookRunHandler} — the HTTP handler for the run endpoint.
 *   2. {@link regenerateCrontab}    — rewrite the pod crontab from every project's
 *      cron hooks (guarded: NO-OPs when crond/crontab is absent, e.g. local dev).
 *   3. {@link bootCatchUpAndSchedule} — boot step: (a) regenerate the crontab,
 *      (b) run each overdue cron hook once (coalesced, dedup-safe), (c) when there
 *      is no crond, start an in-process 60s tick that drives the same catch-up.
 *
 * The PURE hook logic (parse/schedule/state I/O) lives in sibling 6A
 * (`../../app/hooks/index.js`); the agent-run seam is 6B
 * (`SessionManager.runHeadless`). Both are concurrent — this module imports them
 * by their PRODUCTION paths and is typed structurally (see {@link HookManager})
 * so it typechecks without 6B's method landing on `SessionManager` yet.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConnectionRequest, ConnectionResponse, ConnectionResolver } from '@lmthing/core';
import { sendJson } from './utils.js';
import { createConnectionResolver } from '../connections.js';
// ── 6A (concurrent) — imported by production path; see file header. ───────────
import {
  loadHooks,
  dueCronHooks,
  nextCrontabLines,
  loadHooksState,
  saveHooksState,
  type LoadedHook,
  type HooksState,
} from '../../app/hooks/index.js';

// ── Structural contracts (decoupled from concurrent 6A/6B exact types) ────────

/** A single hook definition as returned by 6A's {@link loadHooks}. Only the
 *  fields 6C dispatches on are modelled; 6A may carry more. */
/** Host-enforced budget caps a hook forwards to `runHeadless`/`delegate` — the same
 *  optional-field shape as a session's budget (kept structural to avoid a session-manager dep). */
export interface HookBudget {
  maxEpisodes?: number;
  maxToolCalls?: number;
  maxForkDepth?: number;
  maxWallClockMs?: number;
}

export interface Hook {
  /** Slug = the hook file's basename (e.g. `daily-digest`), namespaced `<spaceId>:<base>`
   *  for a space hook. Matched against `:slug`. */
  slug: string;
  type?: 'cron' | 'database' | 'event' | 'webhook' | string;
  /** The owning scope: `'project'` (in-proc handler) or a spaceId (worker-isolated,
   *  own-provider-locked). Absent ⇒ treated as `'project'`. */
  owner?: string;
  /** Declarative cron target `space/agent#action`. Present ⇒ delegate to an agent. */
  trigger?: string;
  /** Imperative hook body. Present ⇒ invoke directly with a ctx. */
  handler?: (ctx: HookHandlerCtx) => unknown | Promise<unknown>;
  /** Providers `ctx.callConnection` may reach — the gate list (project: declared;
   *  space: additionally locked to the space's own provider(s)). */
  connections?: string[];
  /** Budget caps forwarded verbatim to `runHeadless`/`delegate`. */
  budget?: HookBudget;
}

/** The result a hook `ctx.delegate` returns — the headless agent run's outcome
 *  (mirrors `SessionManager.runHeadless`). `result` is the agent's final display
 *  descriptor / message content; `sessionId` identifies the run. */
export interface DelegateResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  sessionId?: string;
}

/**
 * ctx passed to an imperative `handler` hook. `db` is the project's async data
 * API (unchanged). `delegate` threads structured input INTO the headless run and
 * RETURNS its {@link DelegateResult} (no longer fire-and-forget). `callConnection`
 * is gated by the hook def's `connections:` (a provider not in the allow-list
 * throws). `tasklist.run` is a SEAM — it throws until a runner is injected (S9).
 */
export interface HookHandlerCtx {
  db: unknown;
  /** Delegate into `space/agent`; `opts.input` is serialized into the run's seed
   *  message, `opts.message` overrides the default kickoff text. Returns the run result. */
  delegate: (spaceRef: string, action?: string, opts?: { input?: unknown; message?: string }) => Promise<DelegateResult>;
  /** Call an installed connection provider (gated by the hook's `connections:`). */
  callConnection: (provider: string, req: ConnectionRequest) => Promise<ConnectionResponse>;
  /** Run a SPACE tasklist headless: `run('<spaceId>/<slug>', seed)`. Throws
   *  `'tasklist runner not available yet'` until S9 injects the real runner. */
  tasklist: { run: (ref: string, seed?: unknown) => Promise<unknown> };
  /** The triggering db row (database hooks). */
  row?: unknown;
  /** The structured event input (event hooks). */
  input?: unknown;
}

/** Seam S9 plugs into: run a SPACE tasklist headless from a hook handler. */
export type TasklistRunner = (ref: string, seed?: unknown) => Promise<unknown>;

/** Optional injection for {@link runHook}: the connection resolver (defaults to a
 *  project-scoped `createConnectionResolver`), the S9 tasklist runner, and the
 *  structured `input` an event hook's ctx carries. */
export interface RunHookOpts {
  connectionResolver?: ConnectionResolver;
  tasklistRunner?: TasklistRunner;
  input?: unknown;
}

/** Flatten 6A's `LoadedHook { slug, def }` into the flat fields 6C dispatches on
 *  (`trigger`/`handler`/`budget`). 6A's schedule/state fns keep taking `LoadedHook[]`. */
function toFlat(l: LoadedHook): Hook {
  const d = l.def as {
    type?: string;
    trigger?: string;
    handler?: Hook['handler'];
    connections?: string[];
    budget?: Hook['budget'];
  };
  return {
    slug: l.slug,
    type: d.type,
    owner: (l as { owner?: string }).owner,
    trigger: d.trigger,
    handler: d.handler,
    connections: d.connections,
    budget: d.budget,
  };
}

/** The result of dispatching one hook. */
export interface HookRunResult {
  /** True ⇒ budget-exhausted; the single pending entry was (re)enqueued, no run. */
  queued: boolean;
  /** The agent/handler return value when it ran. */
  result?: unknown;
}

/** Minimal manager surface 6C needs (satisfied structurally by `SessionManager`
 *  once 6B lands `runHeadless`; `getProjectDb` already exists). */
export interface HookManager {
  runHeadless(args: {
    projectId: string;
    spaceRef: string;
    agentSlug: string;
    message: string;
    budget?: HookBudget;
  }): Promise<unknown>;
  getProjectDb(root: string, projectId: string): Promise<{ async: unknown } | null>;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

/** Parse `space/agent#action` → the pieces `runHeadless` wants. */
function parseTrigger(trigger: string): { spaceRef: string; agentSlug: string; action: string } {
  const hash = trigger.indexOf('#');
  const spaceRef = hash >= 0 ? trigger.slice(0, hash) : trigger;
  const action = hash >= 0 ? trigger.slice(hash + 1) : '';
  const agentSlug = spaceRef.split('/').pop() ?? spaceRef;
  return { spaceRef, agentSlug, action };
}

/** Best-effort JSON for embedding structured `delegate` input into the kickoff
 *  message (mirrors session-manager's spawn-input serialization). */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** The connection providers a SPACE declares itself (its own `lmthing.connection`
 *  block). A space hook's `callConnection` is locked to these — it can never reach
 *  another space's or a builtin provider it didn't declare. Best-effort read; a
 *  missing/malformed package.json ⇒ no own providers (all calls will throw). */
function spaceOwnProviders(projectRoot: string, spaceId: string): string[] {
  try {
    const pkg = JSON.parse(
      readFileSync(join(projectRoot, 'spaces', spaceId, 'package.json'), 'utf8'),
    ) as { lmthing?: { connection?: { provider?: unknown } } };
    const provider = pkg.lmthing?.connection?.provider;
    return typeof provider === 'string' && provider ? [provider] : [];
  } catch {
    return [];
  }
}

/** Compute the providers a hook's `ctx.callConnection` may reach. Project hooks:
 *  exactly their declared `connections:`. Space hooks: declared ∩ the space's OWN
 *  providers (locked so a space can never reach beyond what it itself declares). */
function allowedProviders(hook: Hook, projectRoot: string): Set<string> {
  const declared = hook.connections ?? [];
  const owner = hook.owner ?? 'project';
  if (owner === 'project') return new Set(declared);
  const own = new Set(spaceOwnProviders(projectRoot, owner));
  return new Set(declared.filter((p) => own.has(p)));
}

/**
 * Build the upgraded {@link HookHandlerCtx} for an imperative hook. `delegate`
 * threads structured input into the headless run and returns its result;
 * `callConnection` is gated by {@link allowedProviders}; `tasklist.run` throws
 * until S9 injects a runner. Shared by every handler-hook dispatch.
 */
function buildHookCtx(
  manager: HookManager,
  projectId: string,
  projectRoot: string,
  hook: Hook,
  db: unknown,
  row: unknown,
  opts: RunHookOpts,
): HookHandlerCtx {
  const delegate: HookHandlerCtx['delegate'] = async (spaceRef, action, dopts) => {
    const agentSlug = spaceRef.split('/').pop() ?? spaceRef;
    const base = `Hook "${hook.slug}" delegate` + (action ? ` — "${action}".` : '.');
    const message =
      (dopts?.message ?? base) +
      (dopts?.input !== undefined ? `\nInput: ${safeStringify(dopts.input)}` : '');
    const out = (await manager.runHeadless({
      projectId,
      spaceRef,
      agentSlug,
      message,
      budget: hook.budget,
    })) as DelegateResult;
    // Normalize a bare/tagged return into the documented DelegateResult shape.
    if (out && typeof out === 'object' && 'ok' in out) return out;
    return { ok: true, result: out };
  };

  const allowed = allowedProviders(hook, projectRoot);
  const resolver = opts.connectionResolver ?? createConnectionResolver(projectRoot);
  const callConnection: HookHandlerCtx['callConnection'] = (provider, req) => {
    if (!allowed.has(provider)) {
      throw new Error(
        `callConnection("${provider}"): not in hook "${hook.slug}"'s declared connections` +
          (allowed.size ? ` (allowed: ${[...allowed].sort().join(', ')})` : ' (none declared)'),
      );
    }
    return resolver(provider, req);
  };

  const tasklist: HookHandlerCtx['tasklist'] = {
    run: (ref, seed) => {
      if (!opts.tasklistRunner) throw new Error('tasklist runner not available yet');
      return opts.tasklistRunner(ref, seed);
    },
  };

  return {
    db,
    delegate,
    callConnection,
    tasklist,
    ...(row !== undefined ? { row } : {}),
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  };
}

/** Recognize a budget-exhaustion signal from 6B's `runHeadless` (seam: 6B may
 *  throw `BudgetExceededError`/`code:'BUDGET_EXHAUSTED'`, or return a tagged
 *  object). Tolerant so 6C stays decoupled from 6B's exact convention. */
function isBudgetExhausted(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    o['budgetExhausted'] === true ||
    o['status'] === 'budget-exhausted' ||
    o['name'] === 'BudgetExceededError' ||
    o['code'] === 'BUDGET_EXHAUSTED'
  );
}

/**
 * Dispatch ONE hook. Declarative (`trigger`) → delegate to an agent via
 * `runHeadless`; imperative (`handler`) → invoke with a `{ db, delegate }` ctx.
 * Budget-exhausted ⇒ `{ queued:true }` (caller records the pending entry).
 * State I/O is owned by the CALLERS (handler + boot) so this stays pure dispatch.
 */
export async function runHook(
  manager: HookManager,
  lmthingRoot: string,
  projectId: string,
  hook: Hook,
  row?: unknown,
  opts: RunHookOpts = {},
): Promise<HookRunResult> {
  try {
    if (typeof hook.trigger === 'string') {
      const { spaceRef, agentSlug, action } = parseTrigger(hook.trigger);
      const base =
        `Scheduled hook "${hook.slug}" fired` +
        (action ? ` — perform the "${action}" action.` : '.');
      // An event hook threads its structured payload into the run's kickoff seed.
      const message = base + (opts.input !== undefined ? `\nInput: ${safeStringify(opts.input)}` : '');
      const result = await manager.runHeadless({
        projectId,
        spaceRef,
        agentSlug,
        message,
        budget: hook.budget,
      });
      if (isBudgetExhausted(result)) return { queued: true };
      return { queued: false, result };
    }

    if (typeof hook.handler === 'function') {
      const projectRoot = join(lmthingRoot, projectId);
      const projectDb = await manager.getProjectDb(lmthingRoot, projectId);
      const ctx = buildHookCtx(manager, projectId, projectRoot, hook, projectDb?.async, row, opts);
      const result = await hook.handler(ctx);
      if (isBudgetExhausted(result)) return { queued: true };
      return { queued: false, result };
    }

    throw new Error(`hook "${hook.slug}" has neither a trigger nor a handler`);
  } catch (err) {
    if (isBudgetExhausted(err)) return { queued: true };
    throw err;
  }
}

// ── State helpers (single reconciliation point with 6A's field names) ─────────

function markFired(state: HooksState, slug: string, now: number): void {
  state.lastFiredAt[slug] = now;
  state.cron[slug] = { lastRunAt: now };
  state.pending = state.pending.filter((s) => s !== slug);
}

function markPending(state: HooksState, slug: string, now: number): void {
  state.lastFiredAt[slug] = now;
  if (!state.pending.includes(slug)) state.pending.push(slug);
}

// ── 1. The run endpoint ───────────────────────────────────────────────────────

/**
 * Handler for `POST /api/projects/:projectId/hooks/:slug/run` — the authoritative
 * run endpoint (Studio manual run, crond, and boot catch-up all funnel here).
 * Loads the project's hooks, finds `:slug` (404 if absent), dispatches it via
 * {@link runHook}, records the fire in `hooks-state.json`, and returns JSON
 * (`{ ok, result }`, or `{ queued:true }` when budget-deferred).
 */
export function createHookRunHandler(
  manager: HookManager,
  lmthingRoot: string | undefined,
): (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> {
  return async (_req, res, params) => {
    const projectId = params['projectId']!;
    const slug = params['slug']!;

    if (!lmthingRoot) {
      sendJson(res, 404, { error: { status: 404, message: 'no project root configured' } });
      return;
    }

    const projectRoot = join(lmthingRoot, projectId);
    let hooks: Hook[];
    try {
      hooks = (await loadHooks(projectRoot)).map(toFlat);
    } catch {
      hooks = [];
    }
    const hook = hooks.find((h) => h.slug === slug);
    if (!hook) {
      sendJson(res, 404, {
        error: { status: 404, message: `hook "${slug}" not found in project "${projectId}"` },
      });
      return;
    }

    const outcome = await runHook(manager, lmthingRoot, projectId, hook);

    const now = Date.now();
    const state = await loadHooksState(projectRoot);
    if (outcome.queued) markPending(state, slug, now);
    else markFired(state, slug, now);
    await saveHooksState(projectRoot, state);

    sendJson(res, 200, outcome.queued ? { queued: true } : { ok: true, result: outcome.result });
  };
}

// ── 2. Crontab regeneration (guarded) ─────────────────────────────────────────

/** True when the pod crontab must NOT be touched: forced off via `LM_NO_CRONTAB=1`,
 *  or `crontab` is not installed (local dev machine). Checked BEFORE any spawn so
 *  a forced-off run never shells out — we never touch a developer's crontab. */
export function crontabUnavailable(): boolean {
  // OPT-IN ONLY. We write the system crontab EXCLUSIVELY when the runtime explicitly
  // enables it (the compute pod image sets LM_ENABLE_CRONTAB=1). By default — and ALWAYS
  // in local dev — we NEVER touch the developer's crontab; the in-process 60s tick drives
  // cron hooks instead. (Merely having a `crontab` binary installed is NOT consent — a dev
  // machine has one too. The earlier "write whenever crontab exists" behaviour clobbered
  // developer crontabs and is fixed here.)
  if (process.env['LM_ENABLE_CRONTAB'] !== '1') return true;
  if (process.env['LM_NO_CRONTAB'] === '1') return true;
  const probe = spawnSync('crontab', ['-l'], { stdio: 'ignore' });
  // ENOENT ⇒ no `crontab` binary. A non-zero exit (e.g. "no crontab for user")
  // still means the binary EXISTS, so that is available.
  return !!(probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT');
}

/**
 * Rewrite the pod crontab from EVERY project's cron hooks — one line per cron
 * hook (via 6A's {@link nextCrontabLines}), each firing
 * `curl -X POST http://localhost:<port>/api/projects/<project>/hooks/<slug>/run`.
 * Written atomically via `crontab -` reading stdin. NO-OPs (logs) when
 * {@link crontabUnavailable}; the in-process tick drives cron hooks instead.
 */
export async function regenerateCrontab(
  root: string,
  projects: string[],
  serverPort: number,
): Promise<void> {
  if (crontabUnavailable()) {
    console.log(
      '[hooks] system crontab not enabled (set LM_ENABLE_CRONTAB=1 in the pod to use crond) — ' +
        'skipping crontab write; the in-process 60s tick drives cron hooks instead',
    );
    return;
  }

  const lines: string[] = [];
  for (const projectId of projects) {
    let loaded: LoadedHook[];
    try {
      loaded = await loadHooks(join(root, projectId));
    } catch {
      continue;
    }
    // nextCrontabLines emits `<schedule> <template>`, so the template must be the FULL
    // command (a `curl` POST), not a bare URL — else cron tries to exec the URL and fails.
    const urlTemplate = `curl -fsS -X POST http://localhost:${serverPort}/api/projects/${projectId}/hooks/{slug}/run`;
    const projectLines = nextCrontabLines(loaded, urlTemplate);
    lines.push(...projectLines);
  }

  const text = lines.length ? lines.join('\n') + '\n' : '';
  await writeCrontab(text);
}

/** Minimal structural view of the spawned child — self-typed to stay independent
 *  of the workspace's (multi-version) `@types/node` `ChildProcess` resolution. */
interface SpawnedProc {
  on(ev: 'error', cb: (e: Error) => void): void;
  on(ev: 'exit', cb: (code: number | null) => void): void;
  stdin: { end(data: string): void } | null;
}

/** Pipe `text` into `crontab -`. */
function writeCrontab(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('crontab', ['-'], {
      stdio: ['pipe', 'ignore', 'ignore'],
    }) as unknown as SpawnedProc;
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`crontab exited with code ${code}`)),
    );
    child.stdin?.end(text);
  });
}

// ── 3. Boot catch-up + in-process fallback tick ───────────────────────────────

/** Injected run-a-hook seam (integrator passes a fn that calls the run-endpoint
 *  logic). Kept abstract so boot is testable without HTTP. */
export type RunHookFn = (projectId: string, slug: string) => Promise<unknown>;

/**
 * Run every overdue cron hook once, coalesced and dedup-safe. For each project:
 * compute {@link dueCronHooks} against `hooks-state.json`, fire each due hook via
 * `runHook`, then bump `lastFiredAt` so an immediate re-run sees it as NOT due
 * (state is re-loaded before the write to preserve anything the run wrote).
 *
 * This is BOTH the boot catch-up body and the in-process tick body.
 */
export async function runDueCronHooks(
  root: string,
  projects: string[],
  runHookFn: RunHookFn,
  now: number,
): Promise<void> {
  for (const projectId of projects) {
    const projectRoot = join(root, projectId);
    let loaded: LoadedHook[];
    try {
      loaded = await loadHooks(projectRoot);
    } catch {
      continue;
    }
    const state = await loadHooksState(projectRoot);
    const due = dueCronHooks(loaded, state, now);
    if (due.length === 0) continue;

    const fired: string[] = [];
    for (const hook of due) {
      try {
        await runHookFn(projectId, hook.slug);
        fired.push(hook.slug);
      } catch (err) {
        console.warn(
          `[hooks] catch-up run failed for ${projectId}/${hook.slug}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
        // Still mark fired: dedup wins over retry-storming a broken hook every tick.
        fired.push(hook.slug);
      }
    }

    // Re-load (runHookFn may have written pending/lastRunAt) and stamp BOTH lastFiredAt
    // and cron[slug].lastRunAt — the latter is what `dueCronHooks` reads for dueness, so
    // an immediate re-check sees these hooks as no longer due (dedup-safe even if runHookFn
    // itself did not persist a run, e.g. a budget-deferred fire).
    const fresh = await loadHooksState(projectRoot);
    for (const slug of fired) {
      fresh.lastFiredAt[slug] = now;
      fresh.cron[slug] = { lastRunAt: now };
    }
    await saveHooksState(projectRoot, fresh);
  }
}

/** How often the fallback tick re-checks for due hooks (no crond only). */
const TICK_INTERVAL_MS = 60_000;

/**
 * Boot step 6+7: (a) regenerate the crontab (guarded), (b) boot catch-up — run
 * each overdue cron hook once, (c) when there is no crond, start an in-process
 * 60s tick driving the same {@link runDueCronHooks} path. Returns the interval
 * handle so `serve` can clear it on shutdown.
 *
 * `runHookFn` is injected (the integrator passes a fn that invokes the run
 * endpoint logic) so boot is HTTP-free and testable.
 */
export async function bootCatchUpAndSchedule(
  _manager: HookManager,
  root: string,
  projects: string[],
  port: number,
  runHookFn: RunHookFn,
  opts: { now?: () => number; intervalMs?: number } = {},
): Promise<{ tick?: NodeJS.Timeout }> {
  const now = opts.now ?? Date.now;

  // (a) crontab (guarded; NO-OPs in local dev).
  await regenerateCrontab(root, projects, port);

  // (b) boot catch-up — coalesced, dedup-safe.
  await runDueCronHooks(root, projects, runHookFn, now());

  // (c) no crond ⇒ in-process fallback tick.
  let tick: NodeJS.Timeout | undefined;
  if (crontabUnavailable()) {
    tick = setInterval(() => {
      void runDueCronHooks(root, projects, runHookFn, Date.now()).catch((err) => {
        console.warn(
          '[hooks] in-process tick failed: ' + (err instanceof Error ? err.message : String(err)),
        );
      });
    }, opts.intervalMs ?? TICK_INTERVAL_MS);
    tick.unref?.();
  }

  return { tick };
}
