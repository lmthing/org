/**
 * Hook **discovery + validation** (Phase 6, 6A).
 *
 * Walks `<projectRoot>/hooks/` (the PROJECT scope) AND each installed space's
 * `<projectRoot>/spaces/<id>/hooks/` and loads each `*.ts` file as one hook. A
 * hook is a **default-exported object** — a **cron** trigger (time-based), a
 * **database** trigger (fires on a table write), a **webhook** trigger (fires on
 * an external inbound POST), or an **event** trigger (the consumer side of the
 * unified event pipeline, subscribing to a source-qualified `<sourceId>/<name>`):
 *
 *   // hooks/refresh-sources.ts — cron, declarative
 *   export default {
 *     type: 'cron', every: '30m',
 *     trigger: 'newsroom/fetcher#refresh',
 *     budget: { maxEpisodes: 20, maxWallClockMs: 600000 },
 *   }
 *
 *   // hooks/synthesize-new.ts — database, imperative
 *   export default {
 *     type: 'database', on: { table: 'raw_items', event: 'insert' },
 *     budget: { maxEpisodes: 10 },
 *     handler: async ({ row, delegate }) => { … },
 *   }
 *
 *   // hooks/incoming.ts — webhook, declarative
 *   export default {
 *     type: 'webhook', path: 'stripe-events', provider: 'generic',
 *     trigger: 'billing/handler#onEvent',
 *   }
 *
 * The **slug** is the filename basename (`refresh-sources`), namespaced
 * `<spaceId>:<basename>` for a space hook. Because a hook may carry an
 * **imperative `handler`** (real code), discovery must actually *import* the
 * module — unlike the api loader, which can static-parse `name`. For a PROJECT
 * hook (user code) we transpile the `.ts` → CJS with esbuild and evaluate it
 * in-proc in a fresh module scope. For a SPACE hook (store-downloaded code) that
 * would run store code with the pod's privileges, so instead the def is extracted
 * in a **worker** and its handler is invoked worker-isolated (see
 * {@link loadSpaceHooks} / `../worker-load.ts`). Validation is **fail-loud**:
 *   - a cron hook needs exactly one of `every`/`daily`, plus a `trigger`;
 *   - a database hook needs `on: { table, event }` and **exactly one** of
 *     `trigger` / `handler`;
 *   - a webhook hook needs a URL-safe `path` and a `trigger` (`path` is the
 *     public binding key — global uniqueness across projects is enforced by
 *     the manifest builder, not here).
 */

import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

import { transform } from 'esbuild';

import { loadDefaultInWorker, invokeDefaultFnInWorker, type WorkerInvokeHandlers } from '../worker-load.js';

/** A hook's per-episode/per-run budget (enforced by the session manager, 6B). */
export interface HookBudget {
  /** Max agent episodes the triggered session may run. */
  maxEpisodes?: number;
  /** Max wall-clock milliseconds the triggered session may run. */
  maxWallClockMs?: number;
}

/** The arguments an imperative hook `handler` receives. The full runtime ctx is
 *  built server-side ({@link ../../server/routes/hooks.ts} `HookHandlerCtx`); this
 *  is the structural view the loader/space-hook-shim needs. */
export interface HookHandlerArgs {
  /**
   * The written row (for `remove`, the row as it was before deletion). Present on
   * a `database` hook; **`undefined` on a `cron` hook** (there is no triggering
   * row — a scheduled handler self-queries what it needs).
   */
  row?: Record<string, unknown>;
  /** Structured event input for an `event` hook (the emitted payload / envelope). */
  input?: unknown;
  /** The project's async data API (a triggered-session write path). */
  db: unknown;
  /** Delegate into a `space/agent`; passes structured input and returns the result. */
  delegate: (agent: string, action?: string, opts?: unknown) => Promise<unknown>;
  /** Call an installed connection provider, gated by the hook def's `connections:`. */
  callConnection?: (provider: string, req?: unknown) => Promise<unknown>;
  /** Run a SPACE tasklist headless (S9 wires the real runner; a seam until then). */
  tasklist?: { run: (ref: string, seed?: unknown) => Promise<unknown> };
}

/** An imperative hook handler (database or cron). */
export type HookHandler = (args: HookHandlerArgs) => unknown | Promise<unknown>;
/** @deprecated Use {@link HookHandler}. Retained for existing imports. */
export type DatabaseHookHandler = HookHandler;

/**
 * A time-based hook — fires on a cron schedule and either runs a declarative
 * `trigger` (delegate to an agent) OR an imperative `handler` (real code, no
 * agent/LLM). Exactly one of `trigger`/`handler` is present. Prefer `handler`
 * for deterministic fetch/compute work — it does NOT spin up an agent session.
 */
export interface CronHookDef {
  type: 'cron';
  /** Interval spec (`'30m' | '2h' | '1d'`); mutually exclusive with `daily`. */
  every?: string;
  /** Time-of-day spec `'HH:MM'`; mutually exclusive with `every`. */
  daily?: string;
  /** Declarative `space/agent#action` to run when due (mutually exclusive with `handler`). */
  trigger?: string;
  /** Imperative handler run in-proc when due — no agent, no LLM (mutually exclusive with `trigger`). */
  handler?: HookHandler;
  /** Providers `ctx.callConnection` may reach (gated at call time; see routes/hooks.ts). */
  connections?: string[];
  budget?: HookBudget;
}

/** The three write events a database hook may subscribe to. */
export type WriteEventKind = 'insert' | 'update' | 'remove';

/** A write-triggered hook — fires when `on.table`/`on.event` is written. */
export interface DatabaseHookDef {
  type: 'database';
  on: { table: string; event: WriteEventKind };
  /** Declarative `space/agent#action` (mutually exclusive with `handler`). */
  trigger?: string;
  /** Imperative handler (mutually exclusive with `trigger`). */
  handler?: DatabaseHookHandler;
  /** Providers `ctx.callConnection` may reach (gated at call time; see routes/hooks.ts). */
  connections?: string[];
  budget?: HookBudget;
}

/**
 * An event-triggered hook — the CONSUMER side of the unified event pipeline
 * (symmetric with an emitter def). Fires when an event named `on.event` is
 * dispatched. `on.event` is **source-qualified** — `'<sourceId>/<name>'`, where
 * `sourceId` is the emitting scope (`project` or a `<spaceId>`) and `name` is the
 * def's declared event name (dot-segmented, e.g. `db.raw_items.insert`,
 * `message.posted`). Exactly one of `trigger` (delegate to `space/agent#action`)
 * or `handler` (imperative filter/reaction — the handler IS the filter, no DSL)
 * is present. `connections` gates `ctx.callConnection` (S5 wires the dispatch).
 */
export interface EventHookDef {
  type: 'event';
  on: { event: string };
  /** Declarative `space/agent#action` (mutually exclusive with `handler`). */
  trigger?: string;
  /** Imperative handler (mutually exclusive with `trigger`). */
  handler?: HookHandler;
  /** Providers `ctx.callConnection` may reach (gated at call time; see routes/hooks.ts). */
  connections?: string[];
  budget?: HookBudget;
}

/**
 * A webhook-triggered hook — fires when an external caller `POST`s to the
 * pod's inbound endpoint bound to `path` (see `server/webhook-manifest.ts` /
 * `server/routes/webhooks.ts`). Declarative only (no imperative `handler`) —
 * every event delegates to `trigger` (`space/agent#action`).
 */
export interface WebhookHookDef {
  type: 'webhook';
  /** URL-safe path segment, unique per pod (the public binding key). */
  path: string;
  /** Verifier/adapter id; defaults to 'generic'. */
  provider?: string;
  /** `space/agent#action` agent to run for each event (like cron's `trigger`). */
  trigger: string;
  budget?: HookBudget;
}

/** A hook definition — the default export of a `hooks/<slug>.ts` file. */
export type HookDef = CronHookDef | DatabaseHookDef | WebhookHookDef | EventHookDef;

/**
 * A discovered, validated hook. Hooks load from a PROJECT's `hooks/` dir (owner
 * `'project'`, in-proc handlers) AND from each installed SPACE's
 * `spaces/<id>/hooks/` dir (owner = the spaceId, worker-isolated handlers).
 */
export interface LoadedHook {
  /** Stable id, unique per pod: bare basename for a project hook, `<spaceId>:<basename>`
   *  for a space hook (namespaced by owner to avoid cross-scope collisions). */
  slug: string;
  /** The owning scope: `'project'` or the owning space's id. Always set by
   *  {@link loadHooks}/{@link loadSpaceHooks}; optional so lightweight test doubles
   *  and legacy `{ slug, def }` shapes still satisfy the type. */
  owner?: string;
  /** Absolute path to the hook file (space handlers are invoked from disk in a worker). */
  file?: string;
  def: HookDef;
}

const HOOK_FILE_RE = /^([A-Za-z0-9_-]+)\.ts$/;
const DAILY_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const EVERY_RE = /^\d+[mhd]$/;
const WEBHOOK_PATH_RE = /^[A-Za-z0-9_-]+$/;
/** Source-qualified event address: `<sourceId>/<dot.segmented.name>`. */
const EVENT_ADDR_RE = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;

// Base a real `require` at the project cwd so a hook's incidental bare imports
// resolve against the project's node_modules (mirrors api/handler-module.ts).
const realRequire = createRequire(join(process.cwd(), 'lmthing-hook.cjs'));

/**
 * Discover + load every hook under `<projectRoot>/hooks/` (the PROJECT scope).
 * Returns `[]` when there is no `hooks/` dir. Throws fail-loud on a duplicate
 * slug or an invalid hook shape.
 *
 * Project hooks are USER code in the user's trust domain — their imperative
 * handlers are `require()`d and run **in-proc** (like today). SPACE hooks are
 * store-downloaded code and load via {@link loadSpaceHooks} instead (worker
 * isolated). {@link loadAllHooks} composes both.
 */
export async function loadHooks(projectRoot: string): Promise<LoadedHook[]> {
  const hooksDir = join(projectRoot, 'hooks');
  const files = await hookFiles(hooksDir);
  const seen = new Set<string>();
  const out: LoadedHook[] = [];
  for (const name of files) {
    const slug = basename(name, '.ts');
    if (seen.has(slug)) {
      throw new Error(`[hook-loader] duplicate hook slug "${slug}"`);
    }
    seen.add(slug);
    const file = join(hooksDir, name);
    const raw = await importDefault(file);
    const def = validateHook(slug, file, raw);
    out.push({ slug, owner: 'project', file, def });
  }
  return out;
}

/** List the `*.ts` hook filenames in `dir` (deterministic order); `[]` if absent. */
async function hookFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && HOOK_FILE_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * Discover + load every hook under a SINGLE installed space's `hooks/` dir
 * (`<projectRoot>/spaces/<spaceId>/hooks/`). Space hooks are store-downloaded
 * code, so — unlike project hooks — the module is **never `require()`d in-proc**:
 * its def data is extracted in a worker ({@link loadDefaultInWorker}), and an
 * imperative `handler` is replaced by a shim that runs the real handler
 * worker-isolated ({@link makeSpaceHandlerShim}). Slugs are namespaced
 * `<spaceId>:<basename>`; the owner is the spaceId. `[]` when there is no
 * `hooks/` dir. Throws fail-loud on an invalid hook shape.
 */
export async function loadSpaceHooks(projectRoot: string, spaceId: string): Promise<LoadedHook[]> {
  const hooksDir = join(projectRoot, 'spaces', spaceId, 'hooks');
  const files = await hookFiles(hooksDir);
  const out: LoadedHook[] = [];
  for (const name of files) {
    const base = basename(name, '.ts');
    const slug = `${spaceId}:${base}`;
    const file = join(hooksDir, name);
    // Extract the def DATA in a worker — the module (store code) never runs in-proc.
    const { data, functionKeys } = await loadDefaultInWorker(file);
    const raw: Record<string, unknown> = { ...data };
    // The handler can't cross the worker boundary; stand in a placeholder so
    // `validateHook`'s trigger|handler check sees it, then swap in the real shim.
    if (functionKeys.includes('handler')) raw['handler'] = PLACEHOLDER_HANDLER;
    const def = validateHook(slug, file, raw);
    if (functionKeys.includes('handler') && 'handler' in def) {
      (def as { handler?: HookHandler }).handler = makeSpaceHandlerShim(file);
    }
    out.push({ slug, owner: spaceId, file, def });
  }
  return out;
}

/**
 * Compose PROJECT hooks (in-proc) with every installed SPACE's hooks (worker
 * isolated) into one flat list. Space hooks are namespaced so their slugs never
 * collide with a project hook or another space. A single space that fails to
 * load its hooks is skipped (fail-soft-per-space) — a broken store space must
 * not blank the whole project's hooks; the project's own hooks still fail loud.
 */
export async function loadAllHooks(projectRoot: string): Promise<LoadedHook[]> {
  const out = await loadHooks(projectRoot);
  let spaceDirs: string[];
  try {
    spaceDirs = (await readdir(join(projectRoot, 'spaces'), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    spaceDirs = [];
  }
  for (const spaceId of spaceDirs) {
    try {
      out.push(...(await loadSpaceHooks(projectRoot, spaceId)));
    } catch (err) {
      console.warn(
        `[hook-loader] skipping hooks for space "${spaceId}": ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  return out;
}

/** A non-executing stand-in so `validateHook` sees a space hook's handler exists
 *  before we swap in the worker shim (never invoked — replaced post-validation). */
const PLACEHOLDER_HANDLER: HookHandler = () => undefined;

/**
 * Build the main-side handler shim for a SPACE hook: when dispatched, it runs the
 * real (store-code) handler in a worker ({@link invokeDefaultFnInWorker}), passing
 * the serializable ctx seed (`row`/`input`) and wiring the worker's
 * `db`/`delegate`/`callConnection`/`tasklist.run` proxies back to the
 * already-gated main-process ctx it was handed. The store code thus touches every
 * capability only through the main-process gate — never in-proc.
 */
function makeSpaceHandlerShim(file: string): HookHandler {
  return (args: HookHandlerArgs): Promise<unknown> => {
    const ctxSeed: Record<string, unknown> = {};
    if (args.row !== undefined) ctxSeed['row'] = args.row;
    if (args.input !== undefined) ctxSeed['input'] = args.input;
    const handlers: WorkerInvokeHandlers = {
      db: args.db as WorkerInvokeHandlers['db'],
      delegate: args.delegate,
      ...(args.callConnection ? { callConnection: args.callConnection } : {}),
      ...(args.tasklist ? { tasklistRun: args.tasklist.run } : {}),
    };
    return invokeDefaultFnInWorker(file, 'handler', ctxSeed, handlers);
  };
}

/** Transpile a hook `.ts` → CJS and evaluate it, returning its default export. */
async function importDefault(file: string): Promise<unknown> {
  const source = await readFile(file, 'utf8');
  const { code } = await transform(source, {
    loader: 'ts',
    format: 'cjs',
    target: 'node18',
    sourcefile: file,
  });
  const shimRequire = (id: string): unknown => realRequire(id);
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('module', 'exports', 'require', code);
  fn(moduleObj, moduleObj.exports, shimRequire);
  const exp = moduleObj.exports as Record<string, unknown>;
  return exp.default;
}

/** Validate a raw default export into a typed {@link HookDef} (fail-loud). */
export function validateHook(slug: string, file: string, raw: unknown): HookDef {
  const where = `[hook-loader] ${file} (hook "${slug}")`;
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`${where}: default export must be a hook object`);
  }
  const obj = raw as Record<string, unknown>;

  if (obj.type === 'cron') {
    const hasEvery = typeof obj.every === 'string';
    const hasDaily = typeof obj.daily === 'string';
    if (hasEvery === hasDaily) {
      throw new Error(`${where}: a cron hook needs exactly one of \`every\` or \`daily\``);
    }
    if (hasEvery && !EVERY_RE.test(obj.every as string)) {
      throw new Error(`${where}: invalid \`every\` "${String(obj.every)}" (expected e.g. '30m'|'2h'|'1d')`);
    }
    if (hasDaily && !DAILY_RE.test(obj.daily as string)) {
      throw new Error(`${where}: invalid \`daily\` "${String(obj.daily)}" (expected 'HH:MM')`);
    }
    const hasTrigger = typeof obj.trigger === 'string' && (obj.trigger as string).length > 0;
    const hasHandler = typeof obj.handler === 'function';
    if (hasTrigger === hasHandler) {
      throw new Error(
        `${where}: a cron hook needs exactly one of \`trigger\` ('space/agent#action') or \`handler\` (imperative)`,
      );
    }
    return {
      type: 'cron',
      ...(hasEvery ? { every: obj.every as string } : {}),
      ...(hasDaily ? { daily: obj.daily as string } : {}),
      ...(hasTrigger ? { trigger: obj.trigger as string } : {}),
      ...(hasHandler ? { handler: obj.handler as HookHandler } : {}),
      ...connectionsField(where, obj.connections),
      budget: validateBudget(where, obj.budget),
    };
  }

  if (obj.type === 'database') {
    const on = obj.on as Record<string, unknown> | undefined;
    if (!on || typeof on.table !== 'string' || !on.table) {
      throw new Error(`${where}: a database hook needs \`on: { table, event }\``);
    }
    if (on.event !== 'insert' && on.event !== 'update' && on.event !== 'remove') {
      throw new Error(`${where}: \`on.event\` must be 'insert' | 'update' | 'remove'`);
    }
    const hasTrigger = typeof obj.trigger === 'string' && (obj.trigger as string).length > 0;
    const hasHandler = typeof obj.handler === 'function';
    if (hasTrigger === hasHandler) {
      throw new Error(`${where}: a database hook needs exactly one of \`trigger\` or \`handler\``);
    }
    return {
      type: 'database',
      on: { table: on.table, event: on.event },
      ...(hasTrigger ? { trigger: obj.trigger as string } : {}),
      ...(hasHandler ? { handler: obj.handler as DatabaseHookHandler } : {}),
      ...connectionsField(where, obj.connections),
      budget: validateBudget(where, obj.budget),
    };
  }

  if (obj.type === 'event') {
    const on = obj.on as Record<string, unknown> | undefined;
    if (!on || typeof on.event !== 'string' || !on.event) {
      throw new Error(`${where}: an event hook needs \`on: { event: '<sourceId>/<name>' }\``);
    }
    if (!EVENT_ADDR_RE.test(on.event)) {
      throw new Error(
        `${where}: invalid \`on.event\` "${on.event}" (expected source-qualified '<sourceId>/<name>')`,
      );
    }
    const hasTrigger = typeof obj.trigger === 'string' && (obj.trigger as string).length > 0;
    const hasHandler = typeof obj.handler === 'function';
    if (hasTrigger === hasHandler) {
      throw new Error(
        `${where}: an event hook needs exactly one of \`trigger\` ('space/agent#action') or \`handler\` (imperative)`,
      );
    }
    return {
      type: 'event',
      on: { event: on.event },
      ...(hasTrigger ? { trigger: obj.trigger as string } : {}),
      ...(hasHandler ? { handler: obj.handler as HookHandler } : {}),
      ...connectionsField(where, obj.connections),
      budget: validateBudget(where, obj.budget),
    };
  }

  if (obj.type === 'webhook') {
    if (typeof obj.path !== 'string' || obj.path.length === 0) {
      throw new Error(`${where}: a webhook hook needs a non-empty \`path\``);
    }
    if (!WEBHOOK_PATH_RE.test(obj.path)) {
      throw new Error(`${where}: invalid \`path\` "${obj.path}" (expected URL-safe: letters, digits, '_', '-')`);
    }
    if (typeof obj.trigger !== 'string' || obj.trigger.length === 0) {
      throw new Error(`${where}: a webhook hook needs a non-empty \`trigger\` ('space/agent#action')`);
    }
    if (obj.provider !== undefined && typeof obj.provider !== 'string') {
      throw new Error(`${where}: \`provider\` must be a string`);
    }
    return {
      type: 'webhook',
      path: obj.path,
      ...(typeof obj.provider === 'string' ? { provider: obj.provider } : {}),
      trigger: obj.trigger,
      budget: validateBudget(where, obj.budget),
    };
  }

  throw new Error(
    `${where}: \`type\` must be 'cron' | 'database' | 'webhook' | 'event' (got ${JSON.stringify(obj.type)})`,
  );
}

/** Validate an optional `connections` list (provider ids a handler may reach via
 *  `ctx.callConnection`). Returns `{ connections }` to spread, or `{}` when absent. */
function connectionsField(where: string, raw: unknown): { connections?: string[] } {
  if (raw === undefined || raw === null) return {};
  if (!Array.isArray(raw) || raw.some((p) => typeof p !== 'string' || p.length === 0)) {
    throw new Error(`${where}: \`connections\` must be an array of non-empty provider id strings`);
  }
  return { connections: raw as string[] };
}

/** Validate an optional budget object; returns `undefined` when absent. */
function validateBudget(where: string, raw: unknown): HookBudget | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') throw new Error(`${where}: \`budget\` must be an object`);
  const b = raw as Record<string, unknown>;
  const budget: HookBudget = {};
  if (b.maxEpisodes !== undefined) {
    if (typeof b.maxEpisodes !== 'number' || b.maxEpisodes < 0) {
      throw new Error(`${where}: \`budget.maxEpisodes\` must be a non-negative number`);
    }
    budget.maxEpisodes = b.maxEpisodes;
  }
  if (b.maxWallClockMs !== undefined) {
    if (typeof b.maxWallClockMs !== 'number' || b.maxWallClockMs < 0) {
      throw new Error(`${where}: \`budget.maxWallClockMs\` must be a non-negative number`);
    }
    budget.maxWallClockMs = b.maxWallClockMs;
  }
  return budget;
}
