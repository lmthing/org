import { describe, it, expect, beforeAll } from 'vitest';

/**
 * **A follow-up edit must not be able to brick a working app.**
 *
 * `09-emit_types.ts` writes `types/contract.d.ts` WHOLESALE from the current plan, and
 * `11-reconcile_tables.ts` re-emits it after the tables land. A follow-up request ("also record
 * which mechanic did the work") re-runs the whole pipeline, and `plan_endpoints` then returns the
 * endpoints THAT CHANGE is about — not the ones the app already has. Emitting only those DELETED
 * the declarations every already-shipped handler compiles against.
 *
 * Measured live, scenario `30-bike-workshop` run 202: step 1+2 produced a working app; step 3
 * asked for two additions; step 4 found `appCheck` reporting 12 errors of the form
 * `Cannot find name 'BikesListInput'`, `POST …/app/build` answering
 * `400 {"error":"Unhandled error while creating Base Type."}` and the root route 404ing. Six
 * endpoints that were live and working had lost their types.
 *
 * The contract is therefore ADDITIVE across runs: an endpoint a previous contract declared and the
 * new plan does not mention keeps its exact declarations and its place in `EndpointName`. Both
 * emitters are checked here, because the second one re-renders the same section and would
 * otherwise undo the first.
 */

type EmitResult = {
  ok: boolean;
  written: boolean;
  path: string;
  dts: string;
  endpointNames: string[];
  carriedEndpoints: string[];
  carriedCount: number;
  error: string;
};

type ReconcileResult = { ok: boolean; written: boolean; dts: string; error: string };

let emit: (ctx: unknown, inputs: Record<string, unknown>) => Promise<EmitResult>;
let reconcile: (ctx: unknown, inputs: Record<string, unknown>) => Promise<ReconcileResult>;

// The nodes live outside libs/core's tsconfig `include: ["src"]`, so they are reached by a
// computed dynamic import rather than a static one.
const nodeUrl = (file: string): string =>
  new URL(`../../system-spaces/system-appbuilder/tasklists/build_live_project/${file}`, import.meta.url).href;

beforeAll(async () => {
  const a = (await import(nodeUrl('09-emit_types.ts'))) as { run: typeof emit };
  const b = (await import(nodeUrl('11-reconcile_tables.ts'))) as { run: typeof reconcile };
  emit = a.run;
  reconcile = b.run;
});

const CONTRACT_PATH = 'types/contract.d.ts';

const table = (name: string, columns: Record<string, { type: string; primaryKey?: boolean }>) => ({
  name,
  schema: { title: name, description: `The ${name} table`, columns },
  rows: [],
});

const BIKES = table('bikes', { id: { type: 'string', primaryKey: true }, make: { type: 'string' } });
const JOBS = table('jobs', { id: { type: 'string', primaryKey: true }, title: { type: 'string' } });

/** The FIRST build's plan — the shape scenario 30's step 1 produced. */
const FIRST = {
  plan_tables: { tables: [BIKES, JOBS] },
  plan_endpoints: {
    endpoints: [
      { name: 'bikes-list', route: 'bikes/GET', purpose: 'Every bike', tables: ['bikes'], fields: ['id: string', 'make: string'] },
      { name: 'jobs-list', route: 'jobs/GET', purpose: 'Every job', tables: ['jobs'], fields: ['id: string', 'title: string'] },
    ],
  },
  plan_view_components: { components: [] as unknown[] },
};

/** The FOLLOW-UP edit's plan — only the endpoints the new request is about. */
const FOLLOW_UP = {
  plan_tables: { tables: [BIKES, JOBS] },
  plan_endpoints: {
    endpoints: [
      { name: 'jobs-list', route: 'jobs/GET', purpose: 'Every job, now with its worker', tables: ['jobs'], fields: ['id: string', 'title: string', 'worker: string'] },
      { name: 'dashboard-stats', route: 'dashboard-stats/GET', purpose: 'Money split', tables: ['jobs'], fields: ['total_unpaid: number'] },
    ],
  },
  plan_view_components: { components: [] as unknown[] },
};

/** A ctx that records writes and serves a fixed set of files to `readProjectFile`. */
function writerCtx(files: Record<string, string> = {}) {
  const written: Record<string, string> = {};
  return {
    written,
    ctx: {
      writeProjectFile: (path: string, contents: string) => {
        written[path] = contents;
        return { ok: true };
      },
      listProjectDir: (dir: string) => {
        const entries = new Set<string>();
        for (const p of Object.keys(files)) {
          if (!p.startsWith(`${dir}/`)) continue;
          entries.add(p.slice(dir.length + 1).split('/')[0]!);
        }
        return { ok: true, entries: [...entries] };
      },
      readProjectFile: (path: string) =>
        path in files ? { ok: true, content: files[path]! } : { ok: false, content: '', error: `no such file: ${path}` },
    },
  };
}

describe('the type contract is additive across runs', () => {
  it('emit_types keeps an endpoint the FOLLOW-UP plan does not mention', async () => {
    const first = await emit(writerCtx().ctx, FIRST);
    expect(first.dts).toContain('interface BikesListOutput');

    const second = await emit(writerCtx({ [CONTRACT_PATH]: first.dts }).ctx, FOLLOW_UP);

    // The declarations the already-shipped `api/bikes/GET.ts` compiles against — the exact names
    // whose absence produced `Cannot find name 'BikesListInput'` in the live run.
    expect(second.dts).toContain('interface BikesListOutput');
    expect(second.dts).toContain('BikesListInput');
    // …and the name stays callable from a sibling handler's `ctx.apiCall`.
    expect(second.dts).toContain("| 'bikes-list'");
    expect(second.carriedEndpoints).toEqual(['bikes-list']);
    expect(second.carriedCount).toBe(1);

    // The new plan is still authoritative for what it DOES cover.
    expect(second.dts).toContain('worker: string');
    expect(second.dts).toContain('interface DashboardStatsOutput');
  });

  it('reconcile_tables does not undo the carry-forward when it re-renders the section', async () => {
    const first = await emit(writerCtx().ctx, FIRST);
    const w = writerCtx({ [CONTRACT_PATH]: first.dts, 'database/bikes.json': JSON.stringify(BIKES.schema), 'database/jobs.json': JSON.stringify(JOBS.schema) });

    await reconcile(w.ctx, FOLLOW_UP);

    const dts = w.written[CONTRACT_PATH] ?? '';
    expect(dts).toContain('interface BikesListOutput');
    expect(dts).toContain("| 'bikes-list'");
    expect(dts).toContain('interface DashboardStatsOutput');
  });

  it('a carried endpoint never duplicates an identifier the new plan claims', async () => {
    const first = await emit(writerCtx().ctx, FIRST);
    // `bikes_list` and `bikes-list` both PascalCase to `BikesList` — the carried block must lose,
    // because two `interface BikesListOutput` declarations are a compile error.
    const renamed = {
      ...FIRST,
      plan_endpoints: {
        endpoints: [
          { name: 'bikes_list', route: 'bikes/GET', purpose: 'Every bike', tables: ['bikes'], fields: ['id: string'] },
        ],
      },
    };
    const second = await emit(writerCtx({ [CONTRACT_PATH]: first.dts }).ctx, renamed);

    expect(second.dts.match(/interface BikesListOutput\b/g) ?? []).toHaveLength(1);
    expect(second.carriedEndpoints).not.toContain('bikes-list');
  });

  it('a FIRST build carries nothing forward and is unchanged', async () => {
    const first = await emit(writerCtx().ctx, FIRST);
    expect(first.carriedCount).toBe(0);
    expect(first.carriedEndpoints).toEqual([]);
    expect(first.ok).toBe(true);
    // Every planned endpoint, and nothing else.
    expect(first.endpointNames).toEqual(['bikes-list', 'jobs-list']);
  });

  it('a previous file this emitter did not write is ignored rather than parsed', async () => {
    const second = await emit(writerCtx({ [CONTRACT_PATH]: '// hand-written nonsense\n' }).ctx, FOLLOW_UP);
    expect(second.carriedCount).toBe(0);
    expect(second.ok).toBe(true);
  });
});
