/**
 * Unit tests for the write-time artifact lint ({@link ./lint.ts}) — each validator in isolation,
 * with explicit FALSE-REJECT guards (valid real-world source shapes must pass) so the lint never
 * blocks a legal write.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LintError,
  apiHandlerTypingError,
  discoverApiEndpoints,
  existingApiNames,
  flatDetailRouteError,
  lintApiHandler,
  lintHookSource,
} from './lint.js';

describe('lintApiHandler', () => {
  const named = "export const name = 'itemsList';\nexport default async (req, ctx) => ({ ok: true });";

  it('rejects a handler with no `export const name` (the round-1 failure)', () => {
    expect(lintApiHandler('export default async () => ({});')).toMatch(/export const name/);
  });
  it('rejects a named module with no default/handler export', () => {
    expect(lintApiHandler("export const name = 'x';")).toMatch(/handler/i);
  });
  it('accepts a named endpoint with a default export', () => {
    expect(lintApiHandler(named)).toBeNull();
  });
  it('accepts `export function handler` instead of a default export', () => {
    expect(lintApiHandler("export const name = 'x';\nexport function handler() {}")).toBeNull();
  });
  it('rejects a name already claimed by a DIFFERENT endpoint file', () => {
    const existing = new Map([['itemsList', 'api/other/GET.ts']]);
    expect(lintApiHandler(named, { existingNames: existing })).toMatch(/already used by api\/other\/GET\.ts/);
  });
  it('carries the repair when the collision is the SAME endpoint at two route spellings', () => {
    // Run 13: the plan pinned `recipes-detail/GET`; a later node re-spelled it `recipes/[id]/GET`;
    // the duplicate-name rejection then read "pick a different name", which steered the model to
    // keep the flat file. The rejection must carry the move-the-endpoint repair instead.
    const existing = new Map([['recipesDetail', 'api/recipes-detail/GET.ts']]);
    const msg = lintApiHandler(named.replace(/itemsList/, 'recipesDetail'), {
      existingNames: existing,
      writeRoute: 'recipes/[id]/GET',
    });
    expect(msg).toMatch(/already used by api\/recipes-detail\/GET\.ts \(you are writing recipes\/\[id\]\/GET\)/);
    expect(msg).toMatch(/deleteProjectApi\('recipes-detail\/GET'\)/); // route form, executable as-is
    expect(msg).toMatch(/never a new name/);
  });
  it('rejects a flat GET route for a single-record detail endpoint and gives the route repair', () => {
    // Run 13's repaired handler was written to recipes-detail/GET while its required id lived
    // only in the Input contract. The page's mount request therefore failed schema validation (400)
    // before its handler could run. The writer must refuse that route, not wait for smoke.
    const msg = lintApiHandler(named.replace(/itemsList/, 'recipes-detail'), {
      writeRoute: 'recipes-detail/GET',
    });
    expect(msg).toMatch(/single-record detail endpoint/);
    expect(msg).toMatch(/recipes\/\[id\]\/GET/);
    expect(msg).toMatch(/\$route\.id/);
  });
  it('allows a detail endpoint whose GET route carries its record parameter', () => {
    expect(flatDetailRouteError('recipes-detail', 'recipes/[id]/GET')).toBeNull();
  });
  it('allows a name that belongs to no other file', () => {
    expect(lintApiHandler(named, { existingNames: new Map() })).toBeNull();
  });
});

describe('apiHandlerTypingError — the handler boundary must be REAL, never `any`/`Promise<any>`', () => {
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'lm-apitype-'));
    // The global-ambient contract emit_types wrote from the plan: `dashboard-stats` returns exactly
    // `total_monthly` — NOT the `monthly_total` the broken handler emitted.
    mkdirSync(join(projectRoot, 'types'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'types', 'contract.d.ts'),
      [
        'interface DashboardStatsItem { total_monthly: number; }',
        'interface DashboardStatsOutput { items: DashboardStatsItem[]; }',
        'type DashboardStatsInput = Record<string, unknown>;',
        'interface ApiCtx { db: unknown }',
      ].join('\n') + '\n',
    );
  });
  afterEach(() => rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  // The exact escape that shipped the €0.00/"undefined" dashboard (scenario 07-life-admin run 26):
  // an `(input: any, ctx: ApiCtx): Promise<any>` handler returning fields the contract never declared.
  const ESCAPE =
    "export const name = 'dashboard-stats';\n" +
    'export default async function handler(input: any, ctx: ApiCtx): Promise<any> {\n' +
    '  return { items: [{ monthly_total: 5 }] };\n' +
    '}';

  it('REJECTS the live escape — `input: any` / `Promise<any>` returning a divergent shape', () => {
    const msg = apiHandlerTypingError(ESCAPE, { projectRoot });
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/any/);
  });

  it('REJECTS `Promise<any>` even when the input IS typed (the return is the vacuous escape)', () => {
    const src =
      "export const name = 'dashboard-stats';\n" +
      'export type Input = DashboardStatsInput;\n' +
      'export default async function handler(input: Input, ctx: ApiCtx): Promise<any> {\n' +
      '  return { items: [{ monthly_total: 5 }] };\n' +
      '}';
    expect(apiHandlerTypingError(src, { projectRoot })).toMatch(/Promise<any>|`any`|return/);
  });

  it('REJECTS a concrete-but-INVENTED Output that is not the contract `<Base>Output`', () => {
    // No `any` anywhere, so it dodges the `any` ban — but an inline Output lets the endpoint drift
    // from the page, so it must still be rejected in favour of the contract type.
    const src =
      "export const name = 'dashboard-stats';\n" +
      'export type Input = DashboardStatsInput;\n' +
      'export default async function handler(input: Input, ctx: ApiCtx): Promise<{ items: { monthly_total: number }[] }> {\n' +
      '  return { items: [{ monthly_total: 5 }] };\n' +
      '}';
    expect(apiHandlerTypingError(src, { projectRoot })).toMatch(/DashboardStatsOutput|contract/);
  });

  it('ACCEPTS a handler typed to the contract `<Base>Output` directly', () => {
    const src =
      "export const name = 'dashboard-stats';\n" +
      'export default async function handler(input: DashboardStatsInput, ctx: ApiCtx): Promise<DashboardStatsOutput> {\n' +
      '  return { items: [{ total_monthly: 5 }] };\n' +
      '}';
    expect(apiHandlerTypingError(src, { projectRoot })).toBeNull();
  });

  it('REJECTS another endpoint’s real-looking Output type and says why it is wrong', () => {
    const src =
      "export const name = 'dashboard-stats';\n" +
      'export type Input = DashboardStatsInput;\n' +
      'export default async function handler(input: Input, ctx: ApiCtx): Promise<ExercisesDeleteOutput> {\n' +
      '  return { items: [{ total_monthly: 5 }] } as never;\n' +
      '}';
    const msg = apiHandlerTypingError(src, { projectRoot });
    expect(msg).toMatch(/DashboardStatsOutput/);
    expect(msg).toMatch(/ANOTHER endpoint/);
  });

  it('ACCEPTS the doc form — `export type Output = <Base>Output` + `Promise<Output>` (aliased)', () => {
    const src =
      "export const name = 'dashboard-stats';\n" +
      'export type Input = DashboardStatsInput;\n' +
      'export type Output = DashboardStatsOutput;\n' +
      'export default async function handler(input: Input, ctx: ApiCtx): Promise<Output> {\n' +
      '  return { items: [{ total_monthly: 5 }] };\n' +
      '}';
    expect(apiHandlerTypingError(src, { projectRoot })).toBeNull();
  });

  // A live browser test of a BUILT app found this: the recipes list 500'd because the handler declared
  // `handler(ctx: { db: ... })` — one parameter. The runtime calls `handler(input, ctx)`, so `ctx` bound
  // to the request body and `ctx.db` was undefined. The gate had SAVED it: check 1 only asks whether
  // parameter[0] is typed, and `ctx: { db: ... }` is a real type. Nothing checked the arity.
  it('REJECTS a one-parameter handler that uses the ctx members (they live on the 2nd parameter)', () => {
    const src =
      "export const name = 'recipes-list';\n" +
      'export type Output = RecipesListOutput;\n' +
      'export async function handler(ctx: { db: { query: (t: string) => Promise<unknown[]> } }): Promise<Output> {\n' +
      "  const rows = await ctx.db.query('recipes');\n" +
      '  return { items: rows as never[] };\n' +
      '}';
    expect(apiHandlerTypingError(src, { projectRoot })).toMatch(/ONE parameter|SECOND parameter/);
  });

  it('ACCEPTS a one-parameter handler that does NOT touch the ctx members', () => {
    const src =
      "export const name = 'ping';\n" +
      'export type Output = PingOutput;\n' +
      'export default async function handler(input: Record<string, unknown>): Promise<Output> {\n' +
      '  return { items: [] };\n' +
      '}';
    const err = apiHandlerTypingError(src, { projectRoot });
    expect(err === null || !/ONE parameter/.test(err)).toBe(true);
  });

  it('REJECTS a local `interface Output` behind `Promise<Output>` — it is not the global contract alias', () => {
    // This is materially different from `type Output = DashboardStatsOutput`: a local interface can
    // silently drift from what the page reads, so accepting it would re-open the response-shape hole.
    const src =
      "export const name = 'dashboard-stats';\n" +
      'export type Input = DashboardStatsInput;\n' +
      'export interface Output { items: Array<{ monthly_total: number }> }\n' +
      'export default async function handler(input: Input, ctx: ApiCtx): Promise<Output> {\n' +
      '  return { items: [{ monthly_total: 5 }] };\n' +
      '}';
    expect(apiHandlerTypingError(src, { projectRoot })).toMatch(/DashboardStatsOutput|contract/);
  });

  it('bans `any` even with NO contract for the endpoint — an explicit type is the only escape', () => {
    const src =
      "export const name = 'no-plan-endpoint';\n" + // no <Base>Output in the contract
      'export default async function handler(input: any, ctx: ApiCtx): Promise<any> {\n' +
      '  return { items: [] };\n' +
      '}';
    expect(apiHandlerTypingError(src, { projectRoot })).toMatch(/any/);
    // …but a concrete explicit type (not the contract, which does not exist here) passes.
    const ok =
      "export const name = 'no-plan-endpoint';\n" +
      'export default async function handler(input: Record<string, unknown>, ctx: ApiCtx): Promise<{ items: unknown[] }> {\n' +
      '  return { items: [] };\n' +
      '}';
    expect(apiHandlerTypingError(ok, { projectRoot })).toBeNull();
  });

  it('stays silent when there is no `export const name` (the name lint owns that)', () => {
    expect(apiHandlerTypingError('export default async (input: any) => ({});', { projectRoot })).toBeNull();
  });
});

describe('lintHookSource', () => {
  const file = join(tmpdir(), 'x', 'hooks', 'h.ts');

  it('rejects a default export that is a function, not an object', () => {
    expect(lintHookSource('export default async function () {}', 'h', file)).toMatch(/must be a hook OBJECT/);
  });
  it('rejects an object with a missing or unknown type', () => {
    expect(lintHookSource('export default {};', 'h', file)).toMatch(/type/);
    expect(lintHookSource("export default { type: 'nope' };", 'h', file)).toMatch(/cron/);
  });
  it('accepts a valid cron / event / webhook hook object', () => {
    expect(lintHookSource("export default { type: 'cron', every: '1d', handler: async () => {} };", 'h', file)).toBeNull();
    expect(lintHookSource("export default { type: 'event', on: { event: 'x/y' }, handler: async () => {} };", 'h', file)).toBeNull();
    expect(lintHookSource("export default { type: 'webhook', path: 'incoming', trigger: 'x' };", 'h', file)).toBeNull();
  });
  it('rejects source that fails to evaluate', () => {
    expect(lintHookSource("throw new Error('boom'); export default { type: 'cron' };", 'h', file)).toMatch(/failed to evaluate/);
  });
});

describe('existingApiNames', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lm-lint-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('maps each endpoint name to its file and EXCLUDES the target being written', () => {
    mkdirSync(join(root, 'api', 'items'), { recursive: true });
    writeFileSync(join(root, 'api', 'items', 'GET.ts'), "export const name = 'itemsList';\nexport default () => ({});");
    mkdirSync(join(root, 'api', 'items', 'x'), { recursive: true });
    const target = join(root, 'api', 'items', 'x', 'POST.ts');
    writeFileSync(target, "export const name = 'itemsCreate';\nexport default () => ({});");

    const names = existingApiNames(root, target);
    expect(names.get('itemsList')).toBe(join('api', 'items', 'GET.ts'));
    expect(names.has('itemsCreate')).toBe(false); // the target file is excluded from its own scan
  });

  it('returns an empty map when there is no api/ dir', () => {
    expect(existingApiNames(root, join(root, 'api', 'x', 'GET.ts')).size).toBe(0);
  });
});

describe('LintError', () => {
  it('is an Error subclass named LintError', () => {
    const e = new LintError('nope');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('LintError');
  });
});

// ── Save-time cross-artifact checks (plan Part C) ─────────────────────────────

describe('discoverApiEndpoints', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lm-eps-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function endpoint(dirSegs: string[], method: string, name: string) {
    mkdirSync(join(root, 'api', ...dirSegs), { recursive: true });
    writeFileSync(
      join(root, 'api', ...dirSegs, `${method}.ts`),
      `export const name = '${name}';\nexport default () => ({ items: [] });`,
    );
  }

  it('collects names and derives paramNames from [id] segments', () => {
    endpoint(['trips'], 'GET', 'tripsList');
    endpoint(['trips', '[id]'], 'GET', 'tripsDetail');
    endpoint(['trips', '[id]', 'legs', '[legId]'], 'GET', 'legDetail');
    const eps = discoverApiEndpoints(root);
    expect([...eps.keys()].sort()).toEqual(['legDetail', 'tripsDetail', 'tripsList']);
    expect(eps.get('tripsList')!.paramNames).toEqual([]);
    expect(eps.get('tripsDetail')!.paramNames).toEqual(['id']);
    expect(eps.get('legDetail')!.paramNames).toEqual(['id', 'legId']);
  });

  it('is fail-soft: a name-less sibling is skipped, not thrown', () => {
    endpoint(['trips'], 'GET', 'tripsList');
    mkdirSync(join(root, 'api', 'broken'), { recursive: true });
    writeFileSync(join(root, 'api', 'broken', 'GET.ts'), 'export default () => ({});');
    expect([...discoverApiEndpoints(root).keys()]).toEqual(['tripsList']);
  });

  it('returns an empty map with no api/ dir', () => {
    expect(discoverApiEndpoints(root).size).toBe(0);
  });
});

describe('lintApiHandler — a handler imports only @app/runtime', () => {
  const H = `export const name = 'x';\nexport default async function handler(_i, ctx) { return { items: await ctx.db.query('t') }; }`;

  it('rejects the run-36 invented db module', () => {
    const msg = lintApiHandler(`import { db } from '@app/database';\n${H}`);
    expect(msg).toContain('@app/database');
    expect(msg).toContain('ctx.db'); // names the real path
  });

  it('rejects any invented module, not just a fixed list', () => {
    for (const spec of ['@app/db', '@app/data', '../lib/helpers', 'lodash', '@app/orm']) {
      expect(lintApiHandler(`import x from '${spec}';\n${H}`), spec).toContain('does not exist');
    }
  });

  it('ALLOWS the one legal import — HttpError from @app/runtime (71 shipped handlers use it)', () => {
    expect(lintApiHandler(`import { HttpError } from '@app/runtime';\n${H}`)).toBeNull();
  });

  it('ALLOWS a Node builtin — a handler runs in real Node (health/api/shares/POST.ts ships node:crypto)', () => {
    expect(lintApiHandler(`import { randomBytes } from 'node:crypto';\n${H}`)).toBeNull();
  });

  it('does not flag a handler with no imports at all', () => {
    expect(lintApiHandler(H)).toBeNull();
  });

  it('does not trip on the word import inside a string or comment', () => {
    expect(lintApiHandler(`// import from '@app/database' would fail\nconst s = "import x from 'y'";\n${H}`)).toBeNull();
  });
});
