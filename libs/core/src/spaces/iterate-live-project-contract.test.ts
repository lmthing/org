import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpace } from './load.js';
import { loadTasklistFromSpace } from './tasklist-load.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYS = join(__dirname, '..', '..', 'system-spaces');
const ITERATE_DIR = join(SYS, 'system-appbuilder', 'tasklists', 'iterate_live_project');

/**
 * `iterate_live_project` — the automator's THIRD action: an ADDITIONAL FEATURE or an UPDATE to an
 * app that already exists and already works ("also track X", "add a way to export this list"), as
 * distinct from `repair_live_project` (something is BROKEN or MISSING) and a fresh
 * `build_live_project` (no tables/pages yet). Before this tasklist existed, "growing" an app was a
 * same-turn freeform sequence of writer calls with no verify/fix loop of its own — this replaces
 * that with a small plan → implement → verify pipeline that CONVERGES on what already exists
 * (never re-invents a table/page under a second name) and touches ONLY what the request names.
 */

type ToAuthor = { kind: string; name: string; hint: string };
type Offending = { path: string; kind: string; errors: Array<{ line?: number; phase: string; message: string }> };
type VerifyResult = {
  ok: boolean;
  offending: Offending[];
  offendingCount: number;
  toAuthor: ToAuthor[];
  toAuthorCount: number;
};

let run: (ctx: unknown, inputs: Record<string, unknown>) => Promise<VerifyResult>;
beforeAll(async () => {
  const mod = (await import(
    new URL(
      '../../system-spaces/system-appbuilder/tasklists/iterate_live_project/06-verify.ts',
      import.meta.url,
    ).href
  )) as { run: typeof run };
  run = mod.run;
});

type ViewError = {
  code: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
  file?: string;
  endpoint?: string;
};
const viewResult = (errors: ViewError[], checked = 3) => ({
  ok: errors.length === 0,
  errorCount: errors.filter((e) => e.severity === 'error').length,
  warningCount: 0,
  checked,
  errors,
});
const smokeResult = (errors: ViewError[]) => ({ ...viewResult(errors), unavailable: false, rendererMounted: true });

/** Same shape as `build-live-project-gate.test.ts`'s `ctxFor` — a flat `path -> contents` project. */
function ctxFor(files: Record<string, string>, build?: Record<string, unknown>, views?: { validate?: unknown; smoke?: unknown }) {
  const paths = Object.keys(files);
  const ctx: Record<string, unknown> = {
    buildProjectApp: async () => ({ ok: true, built: true, routes: ['/'], errors: [], ...(build ?? {}) }),
    listProjectDir: (dir: string) => {
      const entries = new Set<string>();
      for (const p of paths) {
        if (!p.startsWith(`${dir}/`)) continue;
        entries.add(p.slice(dir.length + 1).split('/')[0]!);
      }
      return { ok: true, entries: [...entries] };
    },
    readProjectFile: (path: string) => ({ ok: true, content: files[path] ?? '' }),
  };
  const validate = views && 'validate' in views ? views.validate : viewResult([]);
  const smoke = views && 'smoke' in views ? views.smoke : smokeResult([]);
  if (validate !== undefined) ctx['validateAppViews'] = () => validate;
  if (smoke !== undefined) ctx['renderSmokeViews'] = () => smoke;
  return ctx;
}

/** The ctx the node ACTUALLY gets in production: every authoring global proxied as an async RPC stub. */
function asyncCtxFor(files: Record<string, string>, build?: Record<string, unknown>, views?: { validate?: unknown; smoke?: unknown }) {
  const sync = ctxFor(files, build, views) as Record<string, (...a: never[]) => unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, fn] of Object.entries(sync)) out[k] = async (...a: never[]) => fn(...a);
  return out;
}

const LIST_ENDPOINT = `export const name = 'dogs-list';
export interface Output { items: any[] }
export default async function handler(_i: any, ctx: any) { return { items: await ctx.db.query('dogs') }; }
`;
const CLEAN = {
  'database/dogs.json': '{}',
  'api/dogs-list/GET.ts': LIST_ENDPOINT,
  'views/index.view.json': '{"route":"index","sections":[]}',
  'shell.view.json': '{"nav":[]}',
};

describe('iterate_live_project — verify (06-verify.ts)', () => {
  it('reports a clean project as ok with nothing offending or to author', async () => {
    const r = await run(ctxFor(CLEAN), {});
    expect(r.ok).toBe(true);
    expect(r.offending).toEqual([]);
    expect(r.toAuthor).toEqual([]);
  });

  it('LOAD-BEARING: the scans still run when ctx is ASYNC — the real worker shape', async () => {
    const r = await run(asyncCtxFor(CLEAN), {});
    expect(r.ok).toBe(true);
  });

  it('checks the WHOLE app, not just what an iteration touched — a change to one part can break another', async () => {
    const r = await run(
      ctxFor(CLEAN, {
        ok: false,
        errors: [{ phase: 'typecheck', file: 'api/dogs-list/GET.ts', message: 'boom' }],
      }),
      {},
    );
    expect(r.offending).toEqual([{ path: 'api/dogs-list/GET.ts', kind: 'api', errors: [{ phase: 'typecheck', message: 'boom', line: undefined }] }]);
  });

  it('routes an endpoint referenced but never written to toAuthor, not offending', async () => {
    const r = await run(
      ctxFor(CLEAN, {}, {
        smoke: smokeResult([
          { code: 'X', path: 'index', message: 'no api module exports the name "walks-list"', severity: 'error', endpoint: 'walks-list' },
        ]),
      }),
      {},
    );
    expect(r.toAuthor).toEqual([{ kind: 'endpoint', name: 'walks-list', hint: expect.stringContaining('walks-list') }]);
    expect(r.offending).toEqual([]);
  });

  it('flags a handler referencing a table that does not exist — the sibling-drift case iterations risk', async () => {
    const r = await run(
      ctxFor({
        ...CLEAN,
        'api/dogs-list/GET.ts': `export const name='dogs-list';\nexport default async function h(i:any,ctx:any){return {items: await ctx.db.query('ghost_table')};}`,
      }),
      {},
    );
    expect(r.offending[0]?.path).toBe('api/dogs-list/GET.ts');
    expect(r.offending[0]?.errors[0]?.message).toContain('ghost_table');
  });
});

describe('iterate_live_project — tasklist shape', () => {
  it('registers as a THIRD automator action, alongside build_live_project and repair_live_project, never replacing either', async () => {
    const space = await loadSpace(resolve(SYS, 'system-appbuilder'), { requireAgents: false });
    expect(Object.keys(space.tasklists).sort()).toEqual([
      'build_live_project', 'iterate_live_project', 'repair_live_project',
    ]);
    expect(space.tasklists['iterate_live_project']!.input).toEqual({ query: 'string', attachmentIds: 'array?' });

    const iterate = await loadTasklistFromSpace(space, 'iterate_live_project');
    // plan_change has no upstream dependency — it reads the live project fresh.
    expect(iterate['plan_change']!.dependsOn).toEqual([]);
    expect(iterate['implement_tables']!.dependsOn).toEqual(['plan_change']);
    expect(iterate['implement_tables']!.forEach).toBe('plan_change.tables');
    expect(iterate['implement_endpoints']!.dependsOn).toEqual(['plan_change', 'implement_tables']);
    expect(iterate['implement_endpoints']!.forEach).toBe('plan_change.endpoints');
    expect(iterate['implement_components']!.dependsOn).toEqual(['plan_change']);
    expect(iterate['implement_components']!.forEach).toBe('plan_change.components');
    expect(iterate['implement_views']!.dependsOn).toEqual(['plan_change', 'implement_endpoints', 'implement_components']);
    expect(iterate['implement_views']!.forEach).toBe('plan_change.views');
    expect(iterate['verify']!.dependsOn).toEqual(['implement_tables', 'implement_endpoints', 'implement_components', 'implement_views']);
    expect(iterate['finalize']!.goal).toBe(true);
  });

  it('never re-invokes build_live_project or repair_live_project — the whole point of this tasklist existing', () => {
    for (const file of [
      '01-plan_change.md', '02-implement_tables.md', '03-implement_endpoints.md',
      '04-implement_components.md', '05-implement_views.md', '07-finalize.md',
    ]) {
      const src = readFileSync(join(ITERATE_DIR, file), 'utf8');
      expect(src, `${file} must never call the full pipeline or the repair tasklist it exists to avoid`)
        .not.toMatch(/tasklist\(\s*['"](build_live_project|repair_live_project)['"]/);
    }
  });

  it('implement_endpoints declares LOCAL Input/Output interfaces, never the ambient <Name>Input/<Name>Output globals', () => {
    // Those globals only exist when emit_types ran as part of a fresh build_live_project plan — this
    // tasklist never runs emit_types, so referencing the ambient name is `Cannot find name`, not a
    // convenience.
    const src = readFileSync(join(ITERATE_DIR, '03-implement_endpoints.md'), 'utf8');
    expect(src).toMatch(/interface Input/);
    expect(src).toMatch(/interface Output/);
    expect(src).toMatch(/never an ambient/i);
  });

  it('plan_change CONVERGES before naming anything new — reads the real project state first', () => {
    const src = readFileSync(join(ITERATE_DIR, '01-plan_change.md'), 'utf8');
    expect(src).toMatch(/CONVERGE/);
    expect(src).toMatch(/listProjectDir\('database'\)/);
    expect(src).toMatch(/listProjectDir\('views'\)/);
    expect(src).toMatch(/existing: true/);
  });

  it('finalize shapes missing/errors in the exact form repair_live_project accepts as input', () => {
    const src = readFileSync(join(ITERATE_DIR, '07-finalize.md'), 'utf8');
    expect(src).toMatch(/repair_live_project/);
    expect(src).toMatch(/kind: 'page', route:/);
    expect(src).toMatch(/kind: 'table', name:/);
  });
});
