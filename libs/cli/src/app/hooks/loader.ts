/**
 * Hook **discovery + validation** (Phase 6, 6A).
 *
 * Walks `<projectRoot>/hooks/` and loads each `*.ts` file as one hook. A hook is
 * a **default-exported object** — a **cron** trigger (time-based), a
 * **database** trigger (fires on a table write), or a **webhook** trigger
 * (fires on an external inbound POST):
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
 * The **slug** is the filename basename (`refresh-sources`). Because a database
 * hook may carry an **imperative `handler`** (real code), discovery must actually
 * *import* the module — unlike the api loader, which can static-parse `name`. We
 * transpile the `.ts` → CJS with esbuild (same toolchain the api runtime uses)
 * and evaluate it in a fresh module scope. Validation is **fail-loud**:
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

/** A hook's per-episode/per-run budget (enforced by the session manager, 6B). */
export interface HookBudget {
  /** Max agent episodes the triggered session may run. */
  maxEpisodes?: number;
  /** Max wall-clock milliseconds the triggered session may run. */
  maxWallClockMs?: number;
}

/** The arguments an imperative hook `handler` receives. */
export interface HookHandlerArgs {
  /**
   * The written row (for `remove`, the row as it was before deletion). Present on
   * a `database` hook; **`undefined` on a `cron` hook** (there is no triggering
   * row — a scheduled handler self-queries what it needs).
   */
  row?: Record<string, unknown>;
  /** The project's async data API (a triggered-session write path). */
  db: unknown;
  /** Delegate into a `space/agent`; the integrator wires headless runs. */
  delegate: (agent: string, action?: string, opts?: unknown) => Promise<unknown>;
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
export type HookDef = CronHookDef | DatabaseHookDef | WebhookHookDef;

/** A discovered, validated hook. */
export interface LoadedHook {
  /** The filename basename (`refresh-sources`) — stable id, unique per project. */
  slug: string;
  def: HookDef;
}

const HOOK_FILE_RE = /^([A-Za-z0-9_-]+)\.ts$/;
const DAILY_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const EVERY_RE = /^\d+[mhd]$/;
const WEBHOOK_PATH_RE = /^[A-Za-z0-9_-]+$/;

// Base a real `require` at the project cwd so a hook's incidental bare imports
// resolve against the project's node_modules (mirrors api/handler-module.ts).
const realRequire = createRequire(join(process.cwd(), 'lmthing-hook.cjs'));

/**
 * Discover + load every hook under `<projectRoot>/hooks/`. Returns `[]` when
 * there is no `hooks/` dir. Throws fail-loud on a duplicate slug or an invalid
 * hook shape.
 */
export async function loadHooks(projectRoot: string): Promise<LoadedHook[]> {
  const hooksDir = join(projectRoot, 'hooks');
  let entries;
  try {
    entries = await readdir(hooksDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const files = entries
    .filter((e) => e.isFile() && HOOK_FILE_RE.test(e.name))
    .map((e) => e.name)
    .sort(); // deterministic order

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
    out.push({ slug, def });
  }
  return out;
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

  throw new Error(`${where}: \`type\` must be 'cron' | 'database' | 'webhook' (got ${JSON.stringify(obj.type)})`);
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
