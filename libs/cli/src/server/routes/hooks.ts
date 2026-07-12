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
import type { ConnectionRequest, ConnectionResponse, ConnectionResolver, CronEmitterDef } from '@lmthing/core';
import { sendJson, readBody } from './utils.js';
import { listProjects } from '../projects.js';
import { createConnectionResolver } from '../connections.js';
import { emitInternalSignal } from '../internal-signals.js';
import { makeHookTasklistRunner, type TasklistRunnerManager } from '../tasklist-runner.js';
import { scanEmitterDefs, type EmitterScanResult, type ExtractedEmitterDef } from '../emitter-manifests.js';
import { scanIntegrationDescriptors } from '../integration-manifests.js';
import { makeEmitterStateStore, type EmitterStateStore } from '../emitter-state.js';
import { invokeDefaultFnInWorker } from '../../app/worker-load.js';
import { dispatchEmittedEvents, validateEmitted, type EventDispatchManager } from '../event-dispatch.js';
// ── 6A (concurrent) — imported by production path; see file header. ───────────
import {
  loadHooks,
  loadAllHooks,
  dueCronHooks,
  nextCrontabLines,
  crontabSchedule,
  nextRunAt,
  loadHooksState,
  saveHooksState,
  effectiveDisabled,
  type LoadedHook,
  type HooksState,
  type CronHookDef,
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
  /** When true, the hook's export marks it inert. Effective-disabled ALSO folds in
   *  the per-project state overlay — check via `effectiveDisabled(loaded, state)`. */
  disabled?: boolean;
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
  /** S8 loop protection: how many hook firings already sit in this run's causal
   *  chain (absent/0 = a fresh cron/manual/inbound fire). The run's own
   *  `hook.fired` internal signal carries this + 1, so signal-derived cascades
   *  stay bounded by the shared depth cap. */
  hookDepth?: number;
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
    disabled?: boolean;
  };
  return {
    slug: l.slug,
    type: d.type,
    owner: (l as { owner?: string }).owner,
    trigger: d.trigger,
    handler: d.handler,
    connections: d.connections,
    budget: d.budget,
    ...(d.disabled === true ? { disabled: true } : {}),
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
export interface HookManager extends TasklistRunnerManager {
  runHeadless(args: {
    projectId: string;
    spaceRef: string;
    agentSlug: string;
    message: string;
    budget?: HookBudget;
    origin?: { source: string };
  }): Promise<unknown>;
  getProjectDb(root: string, projectId: string): Promise<{ async: unknown } | null>;
  /** Re-derive the pod's published artifacts (crontab + webhook manifest + emitter
   *  cache). Optional — absent under bare `serve` wiring; the disable toggle calls
   *  it so a disabled cron/webhook drops from the schedule/manifest live. */
  republish?: () => Promise<void>;
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
    // S8 instrumentation: a hook handler delegating into an agent (guarded one-liner).
    emitInternalSignal('agent.delegated', { projectId, from: `hook:${hook.slug}`, to: spaceRef + (action ? `#${action}` : '') });
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
      origin: { source: `hook:${hook.slug}` },
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
  // Disabled hooks are inert — never dispatch, never emit a fired signal. Callers
  // fold the per-project overlay into `hook.disabled` (effective-disabled) before
  // calling; this is the shared backstop that also honors an export-level `disabled`.
  if (hook.disabled === true) return { queued: false };
  // S8 instrumentation: EVERY actual hook dispatch (cron endpoint, db runtime,
  // event handler hooks) funnels through here — one guarded fire-and-forget
  // line. meta stamps the origin slug + incremented cascade depth so a
  // `hook.fired`-derived event can never re-trigger this same hook and deep
  // cascades are cut at the shared depth cap (see server/internal-signals.ts).
  // (Trigger-style EVENT hooks bypass runHook — event-dispatch.ts emits theirs.)
  emitInternalSignal(
    'hook.fired',
    { projectId, slug: hook.slug, hookType: hook.type ?? 'unknown' },
    { originatingHookSlug: hook.slug, hookDepth: (opts.hookDepth ?? 0) + 1 },
  );
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
        origin: { source: `hook:${hook.slug}` },
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

    // A `@emitter:<scope>:<name>` pseudo-slug (crontab / tick for a cron EMITTER
    // def) routes to the emitter run path — it is not a hook.
    const emitterRef = parseEmitterSlug(slug);
    if (emitterRef) {
      await runNamedCronEmitter(manager as unknown as EventDispatchManager, lmthingRoot, projectId, emitterRef);
      sendJson(res, 200, { ok: true });
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

    // Fold the per-project disable overlay into the flat hook so a stale crontab
    // line (or a manual run) for a disabled hook no-ops in runHook's guard.
    const state = await loadHooksState(projectRoot);
    if (state.disabled.includes(slug)) hook.disabled = true;

    // Inject the real SPACE-tasklist runner (S9) so a hook handler's
    // `ctx.tasklist.run('<spaceId>/<slug>', seed)` runs headless against this
    // project. Composition point: every cron/manual/boot run funnels through here.
    const outcome = await runHook(manager, lmthingRoot, projectId, hook, undefined, {
      tasklistRunner: makeHookTasklistRunner(manager, lmthingRoot, projectId),
    });

    const now = Date.now();
    if (outcome.queued) markPending(state, slug, now);
    else markFired(state, slug, now);
    await saveHooksState(projectRoot, state);

    sendJson(res, 200, outcome.queued ? { queued: true } : { ok: true, result: outcome.result });
  };
}

// ── 1b. Hooks list + enable/disable (settings UI) ─────────────────────────────

/** One row in the settings hooks list — a projected, non-executing view of a
 *  loaded hook def plus its effective-disabled state. */
export interface HookSummary {
  projectId: string;
  slug: string;
  owner: string;
  type: string;
  on?: string;
  every?: string;
  daily?: string;
  path?: string;
  provider?: string;
  trigger?: string;
  hasHandler: boolean;
  disabled: boolean;
}

/** Read-only projection of a hook def's list-relevant fields (never executes). */
type HookDefView = {
  type?: string;
  on?: { event?: string };
  every?: string;
  daily?: string;
  path?: string;
  provider?: string;
  trigger?: string;
  handler?: unknown;
};

/**
 * GET /api/hooks — the pod-global list of every automated hook (project + every
 * installed space), each with its effective-disabled state. Backs the settings
 * Hooks tab (grouped by type client-side). A project whose hooks fail to load is
 * skipped (fail-soft). Pod-global (no projectId) — enumerates all projects.
 */
export function createHooksListHandler(
  root: string | undefined,
): (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> {
  return async (_req, res) => {
    if (!root) {
      sendJson(res, 200, { hooks: [] });
      return;
    }
    const projectIds = (await listProjects(root)).map((p) => p.id).filter((id) => id !== 'system');
    const hooks: HookSummary[] = [];
    for (const projectId of projectIds) {
      const projectRoot = join(root, projectId);
      let loaded: LoadedHook[];
      try {
        loaded = await loadAllHooks(projectRoot);
      } catch {
        continue; // a project whose hooks fail to load is skipped
      }
      const state = await loadHooksState(projectRoot);
      for (const h of loaded) {
        const def = h.def as HookDefView;
        hooks.push({
          projectId,
          slug: h.slug,
          owner: h.owner ?? 'project',
          type: def.type ?? 'unknown',
          ...(def.on?.event ? { on: def.on.event } : {}),
          ...(def.every ? { every: def.every } : {}),
          ...(def.daily ? { daily: def.daily } : {}),
          ...(def.path ? { path: def.path } : {}),
          ...(def.provider ? { provider: def.provider } : {}),
          ...(def.trigger ? { trigger: def.trigger } : {}),
          hasHandler: typeof def.handler === 'function',
          disabled: effectiveDisabled(h, state),
        });
      }
    }
    sendJson(res, 200, { hooks });
  };
}

/**
 * POST /api/projects/:projectId/hooks/:slug/disabled — body `{ disabled: boolean }`.
 * Records/clears the slug in the project's `.data/hooks-state.json` disable overlay
 * (no source rewrite), then republishes so a disabled cron/webhook drops from the
 * crontab + webhook manifest live. Event hooks honor the overlay at fire time.
 */
export function createHookDisableHandler(
  manager: HookManager,
  root: string | undefined,
): (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> {
  return async (req, res, params) => {
    const projectId = params['projectId']!;
    const slug = params['slug']!;
    if (!root) {
      sendJson(res, 404, { error: { status: 404, message: 'no project root configured' } });
      return;
    }
    let body: { disabled?: unknown };
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      body = {};
    }
    const disabled = body.disabled === true;
    const projectRoot = join(root, projectId);
    const state = await loadHooksState(projectRoot);
    const set = new Set(state.disabled);
    if (disabled) set.add(slug);
    else set.delete(slug);
    state.disabled = [...set];
    await saveHooksState(projectRoot, state);
    // Re-derive crontab + webhook manifest so a disabled cron/webhook drops live.
    try {
      await manager.republish?.();
    } catch {
      /* best-effort — the gate itself already honors the overlay */
    }
    sendJson(res, 200, { ok: true, slug, disabled });
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

  const lines = await buildCrontabLines(root, projects, serverPort);
  const text = lines.length ? lines.join('\n') + '\n' : '';
  await writeCrontab(text);
}

/**
 * Build every crontab line for the pod — one per cron HOOK **and** one per
 * `{type:'cron'}` emitter DEF (project + space scopes), each firing a `curl` POST
 * to the local hook-run endpoint. Emitter defs have no hook slug, so they use the
 * reserved pseudo-slug `@emitter:<scope>:<name>` on the SAME endpoint (the run
 * handler routes it to {@link runCronEmitter} instead of a hook). Pure of the
 * crontab guard — exported so it is testable without touching a real crontab.
 */
export async function buildCrontabLines(root: string, projects: string[], serverPort: number): Promise<string[]> {
  const lines: string[] = [];
  for (const projectId of projects) {
    // nextCrontabLines emits `<schedule> <template>`, so the template must be the FULL
    // command (a `curl` POST), not a bare URL — else cron tries to exec the URL and fails.
    const urlTemplate = `curl -fsS -X POST http://localhost:${serverPort}/api/projects/${projectId}/hooks/{slug}/run`;
    try {
      const projectRoot = join(root, projectId);
      const [hooks, state] = await Promise.all([loadHooks(projectRoot), loadHooksState(projectRoot)]);
      // A disabled cron hook gets no crontab line (drops from the schedule live on republish).
      lines.push(...nextCrontabLines(hooks.filter((h) => !effectiveDisabled(h, state)), urlTemplate));
    } catch {
      /* skip a project whose hooks fail to load */
    }
    // Cron EMITTER defs — one line each, keyed by the `@emitter:` pseudo-slug.
    try {
      const { scopes } = await scanEmitterDefs(root, projectId);
      for (const [scope, scopeDefs] of Object.entries(scopes)) {
        for (const def of scopeDefs.defs) {
          if (def.def.type !== 'cron') continue;
          const schedule = crontabSchedule(asCronHookDef(def.def));
          const slug = emitterPseudoSlug(scope, def.name);
          lines.push(`${schedule} ${expandSlug(urlTemplate, slug)}`);
        }
      }
    } catch {
      /* skip a project whose emitter scan fails */
    }
  }
  return lines;
}

/** Expand the `{slug}` placeholder in the curl template (mirrors cron.ts's
 *  private `expandTemplate`, kept local so the emitter path doesn't re-export it). */
function expandSlug(template: string, slug: string): string {
  return template.replace(/\{slug\}/g, slug);
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

// ── 2b. Cron EMITTER defs (S6) — poll on schedule, emit → dispatch ────────────

/** The reserved pseudo-slug prefix a cron EMITTER def uses on the hook-run
 *  endpoint (it has no hook slug). `@` can't start a real hook/space slug, so
 *  this never collides. Format: `@emitter:<scope>:<defName>`. */
const EMITTER_SLUG_PREFIX = '@emitter:';

/** Build the run pseudo-slug for a cron emitter def. */
function emitterPseudoSlug(scope: string, name: string): string {
  return `${EMITTER_SLUG_PREFIX}${scope}:${name}`;
}

/** Parse an `@emitter:<scope>:<name>` pseudo-slug, or `undefined` when it isn't one. */
function parseEmitterSlug(slug: string): { scope: string; name: string } | undefined {
  if (!slug.startsWith(EMITTER_SLUG_PREFIX)) return undefined;
  const rest = slug.slice(EMITTER_SLUG_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0 || colon >= rest.length - 1) return undefined;
  return { scope: rest.slice(0, colon), name: rest.slice(colon + 1) };
}

/** Adapt a scanned cron emitter def's DATA into the `CronHookDef` shape that
 *  cron.ts's `crontabSchedule`/`nextRunAt` read (they only touch `every`/`daily`). */
function asCronHookDef(def: Omit<CronEmitterDef, 'emit'>): CronHookDef {
  return {
    type: 'cron',
    ...(def.every ? { every: def.every } : {}),
    ...(def.daily ? { daily: def.daily } : {}),
  } as CronHookDef;
}

/** Compute the providers a cron emitter def's `ctx.callConnection` may reach.
 *  PROJECT defs: declared ∩ the project's INSTALLED integration providers.
 *  SPACE defs: declared ∩ the owning space's OWN provider(s) (locked, so a space
 *  can never reach beyond what it itself declares + owns) — mirrors the space-hook
 *  gate ({@link allowedProviders}) and the tasklist code-node gate. */
function allowedEmitterProviders(
  scope: string,
  declared: string[],
  projectRoot: string,
  installed: Set<string>,
): Set<string> {
  if (scope === 'project') return new Set(declared.filter((p) => installed.has(p)));
  const own = new Set(spaceOwnProviders(projectRoot, scope));
  return new Set(declared.filter((p) => own.has(p)));
}

/** Injectable seams for the cron-emitter run path (default to the real
 *  implementations; tests override to avoid real workers / dispatch). */
export interface CronEmitterDeps {
  /** Scan a project's emitter defs (defaults to {@link scanEmitterDefs}). */
  scan?: (root: string, projectId: string) => Promise<EmitterScanResult>;
  /** Worker-isolated `emit(ctx)` runner (defaults to {@link invokeDefaultFnInWorker}). */
  invokeEmit?: (
    file: string,
    ctxSeed: Record<string, unknown>,
    handlers: {
      callConnection: (provider: string, req?: unknown) => Promise<unknown>;
      state: EmitterStateStore;
    },
    timeoutMs: number,
  ) => Promise<unknown>;
  /** Emitted-event dispatcher (defaults to {@link dispatchEmittedEvents}). */
  dispatch?: typeof dispatchEmittedEvents;
  /** Per-def state store factory (defaults to {@link makeEmitterStateStore}). */
  makeStateStore?: (projectRoot: string, scope: string, name: string) => EmitterStateStore;
  /** Project connection resolver factory (defaults to {@link createConnectionResolver}). */
  connectionResolver?: (projectRoot: string) => ConnectionResolver;
  /** The project's installed integration providers (defaults to the descriptor scan). */
  installedProviders?: (projectRoot: string) => Set<string>;
  /** Per-emit worker wall-clock ceiling. */
  timeoutMs?: number;
}

/** Wall-clock ceiling for one worker-isolated cron `emit(ctx)` (shared env knob). */
const EMIT_TIMEOUT_MS = Number(process.env['LMTHING_EMITTER_EMIT_TIMEOUT_MS']) || 5000;

/**
 * Run ONE cron emitter def: build its gated ctx (per-def `state` KV +
 * own-provider/declared-locked `callConnection`), run its `emit(ctx)`
 * worker-isolated + timeout-bounded, validate the output against the def's
 * `emits` schema (drop-with-warn), and dispatch the surviving events to
 * subscribing event hooks. Never throws — a failure is logged.
 */
export async function runCronEmitter(
  manager: EventDispatchManager,
  root: string,
  projectId: string,
  scope: string,
  def: ExtractedEmitterDef,
  deps: CronEmitterDeps = {},
): Promise<void> {
  if (def.def.type !== 'cron') return;
  const projectRoot = join(root, projectId);
  const installed = (deps.installedProviders ?? defaultInstalledProviders)(projectRoot);
  const allowed = allowedEmitterProviders(scope, def.def.connections ?? [], projectRoot, installed);
  const resolver = (deps.connectionResolver ?? createConnectionResolver)(projectRoot);
  const callConnection = (provider: string, req?: unknown): Promise<unknown> => {
    if (!allowed.has(provider)) {
      return Promise.reject(
        new Error(
          `callConnection("${provider}"): not allowed for cron emitter "${scope}/${def.name}"` +
            (allowed.size ? ` (allowed: ${[...allowed].sort().join(', ')})` : ' (none declared/owned)'),
        ),
      );
    }
    return resolver(provider, req as ConnectionRequest);
  };
  const state = (deps.makeStateStore ?? makeEmitterStateStore)(projectRoot, scope, def.name);
  const invokeEmit =
    deps.invokeEmit ??
    ((file, ctxSeed, handlers, timeoutMs) => invokeDefaultFnInWorker(file, 'emit', ctxSeed, handlers, { timeoutMs }));

  let raw: unknown;
  try {
    raw = await invokeEmit(def.file, {}, { callConnection, state }, deps.timeoutMs ?? EMIT_TIMEOUT_MS);
  } catch (err) {
    console.warn(
      `[hooks] cron emitter "${scope}/${def.name}" emit failed: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return;
  }
  const emitted = validateEmitted(def.def.emits, raw, `${scope}/${def.name}`);
  if (emitted.length === 0) return;
  const dispatch = deps.dispatch ?? dispatchEmittedEvents;
  await dispatch({ root, projectId, sourceScope: scope, emitted, manager });
}

/** Default installed-integration provider set for a project (descriptor scan). */
function defaultInstalledProviders(projectRoot: string): Set<string> {
  return new Set(Object.keys(scanIntegrationDescriptors(projectRoot).connections));
}

/** Resolve `{scope,name}` to a scanned cron emitter def and run it once (the
 *  crontab / manual endpoint path), then stamp its `lastRunAt` so the boot
 *  catch-up won't double-fire it. Never throws. */
async function runNamedCronEmitter(
  manager: EventDispatchManager,
  root: string,
  projectId: string,
  ref: { scope: string; name: string },
): Promise<void> {
  const projectRoot = join(root, projectId);
  let result: EmitterScanResult;
  try {
    result = await scanEmitterDefs(root, projectId);
  } catch {
    return;
  }
  const def = result.scopes[ref.scope]?.defs.find((d) => d.name === ref.name && d.def.type === 'cron');
  if (!def) {
    console.warn(`[hooks] cron emitter "${ref.scope}/${ref.name}" not found in "${projectId}"`);
    return;
  }
  await runCronEmitter(manager, root, projectId, ref.scope, def);
  const slug = emitterPseudoSlug(ref.scope, ref.name);
  const now = Date.now();
  const state = await loadHooksState(projectRoot);
  state.lastFiredAt[slug] = now;
  state.cron[slug] = { lastRunAt: now };
  await saveHooksState(projectRoot, state);
}

/**
 * Run every DUE cron emitter def once, coalesced + dedup-safe — the emitter twin
 * of {@link runDueCronHooks}. Dueness is tracked in the SAME `hooks-state.json`
 * `cron` map under the `@emitter:<scope>:<name>` pseudo-slug (via cron.ts's
 * {@link nextRunAt}), so a window missed while the pod was down runs once on boot.
 * Fail-soft per project; this is BOTH the boot catch-up and the in-process tick
 * body for emitters.
 */
export async function runDueCronEmitters(
  manager: EventDispatchManager,
  root: string,
  projects: string[],
  now: number,
  deps: CronEmitterDeps = {},
): Promise<void> {
  const scan = deps.scan ?? scanEmitterDefs;
  for (const projectId of projects) {
    const projectRoot = join(root, projectId);
    let result: EmitterScanResult;
    try {
      result = await scan(root, projectId);
    } catch {
      continue;
    }
    // Gather the project's due cron emitter defs against persisted lastRunAt.
    const state = await loadHooksState(projectRoot);
    const due: Array<{ scope: string; def: ExtractedEmitterDef; slug: string }> = [];
    for (const [scope, scopeDefs] of Object.entries(result.scopes)) {
      for (const def of scopeDefs.defs) {
        if (def.def.type !== 'cron') continue;
        const slug = emitterPseudoSlug(scope, def.name);
        const lastRunAt = state.cron[slug]?.lastRunAt ?? 0;
        if (now >= nextRunAt(asCronHookDef(def.def), lastRunAt)) due.push({ scope, def, slug });
      }
    }
    if (due.length === 0) continue;

    const fired: string[] = [];
    for (const { scope, def, slug } of due) {
      try {
        await runCronEmitter(manager, root, projectId, scope, def, deps);
      } catch (err) {
        console.warn(
          `[hooks] cron emitter catch-up failed for ${projectId}/${slug}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
      fired.push(slug); // dedup wins over retry-storming a broken emitter every tick
    }
    // Re-load (a dispatch may have written hook state) and stamp lastRunAt so an
    // immediate re-check sees these emitters as no longer due.
    const fresh = await loadHooksState(projectRoot);
    for (const slug of fired) {
      fresh.lastFiredAt[slug] = now;
      fresh.cron[slug] = { lastRunAt: now };
    }
    await saveHooksState(projectRoot, fresh);
  }
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
 * Boot step 6+7: (a) regenerate the crontab (guarded — cron HOOKS + cron EMITTER
 * defs), (b) boot catch-up — run each overdue cron hook AND cron emitter once,
 * (c) when there is no crond, start an in-process 60s tick driving the same
 * {@link runDueCronHooks} + {@link runDueCronEmitters} paths. Returns the interval
 * handle so `serve` can clear it on shutdown.
 *
 * `runHookFn` is injected (the integrator passes a fn that invokes the run
 * endpoint logic) so boot is HTTP-free and testable. Cron emitters run in-process
 * (they need `manager` for dispatch, not an HTTP round-trip); in prod (crond
 * enabled) the crontab lines drive them via the `@emitter:` run endpoint.
 */
export async function bootCatchUpAndSchedule(
  manager: HookManager,
  root: string,
  projects: string[],
  port: number,
  runHookFn: RunHookFn,
  opts: { now?: () => number; intervalMs?: number } = {},
): Promise<{ tick?: NodeJS.Timeout }> {
  const now = opts.now ?? Date.now;
  const eventManager = manager as unknown as EventDispatchManager;

  // (a) crontab (guarded; NO-OPs in local dev) — includes cron emitter lines.
  await regenerateCrontab(root, projects, port);

  // (b) boot catch-up — coalesced, dedup-safe (hooks + emitters).
  await runDueCronHooks(root, projects, runHookFn, now());
  await runDueCronEmitters(eventManager, root, projects, now()).catch((err) => {
    console.warn('[hooks] boot cron-emitter catch-up failed: ' + (err instanceof Error ? err.message : String(err)));
  });

  // (c) no crond ⇒ in-process fallback tick (hooks + emitters).
  let tick: NodeJS.Timeout | undefined;
  if (crontabUnavailable()) {
    tick = setInterval(() => {
      void runDueCronHooks(root, projects, runHookFn, Date.now()).catch((err) => {
        console.warn(
          '[hooks] in-process tick failed: ' + (err instanceof Error ? err.message : String(err)),
        );
      });
      void runDueCronEmitters(eventManager, root, projects, Date.now()).catch((err) => {
        console.warn(
          '[hooks] in-process cron-emitter tick failed: ' + (err instanceof Error ? err.message : String(err)),
        );
      });
    }, opts.intervalMs ?? TICK_INTERVAL_MS);
    tick.unref?.();
  }

  return { tick };
}
