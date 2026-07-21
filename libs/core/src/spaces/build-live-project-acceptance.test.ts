import { describe, it, expect, beforeAll } from 'vitest';

/**
 * The acceptance gate — `13a-check_acceptance.ts`, a HOST-RUN code node — driven against a mocked
 * project filesystem, a scripted api runtime, and a mocked db.
 *
 * It exists because SHAPE is not MEANING: `smoke_endpoints` proves an endpoint answers `{ items: [] }`
 * and does not 500, but a handler reading a column nobody populated returns a valid envelope of zeros
 * (run 32 step 3: a €0 tile over a €2,707 trip). `plan_acceptance` distils the source figures into
 * checkable floors; this node calls each endpoint against the seeded data and evaluates them.
 *
 * The behaviour under test that matters most is the CODE-fault vs DATA-gap split: a failed check is
 * only routed to the per-file `fix` fork (`offending`) when the backing table HOLDS the data and the
 * endpoint reports it wrong; a check that failed because the data itself is short is an upstream
 * extraction gap (`dataGaps`) the code fixer cannot repair, so it must NEVER reach `offending`.
 */

type Offending = { path: string; kind: string; name?: string; errors: Array<{ phase: string; probe: string; message: string }> };
type DataGap = { check: string; endpoint: string; message: string };
type Result = {
  ok: boolean;
  checked: number;
  offending: Offending[];
  offendingCount: number;
  dataGaps: DataGap[];
  dataGapCount: number;
  skipped: number;
  unavailable: boolean;
  reason: string;
};

let run: (ctx: unknown, inputs: Record<string, unknown>) => Promise<Result>;
let node: { id: string; dependsOn: string[]; output: Record<string, string> };
beforeAll(async () => {
  const mod = (await import(
    new URL('../../system-spaces/system-appbuilder/tasklists/build_live_project/13a-check_acceptance.ts', import.meta.url).href
  )) as { run: typeof run; node: typeof node };
  run = mod.run;
  node = mod.node;
});

type ApiResponse = { status: number; body: unknown };
type Handlers = Record<string, (input: Record<string, unknown>) => ApiResponse>;

/** A project (path→source) + scripted api + a mocked db (table→rows). `callProjectApi`/`db` are
 *  present unless the test removes them, matching the real code-node ctx. */
function ctxFor(files: Record<string, string>, handlers: Handlers, tableRows?: Record<string, unknown[]>) {
  const paths = Object.keys(files);
  return {
    listProjectDir: (dir: string) => {
      const entries = new Set<string>();
      for (const p of paths) {
        if (!p.startsWith(`${dir}/`)) continue;
        entries.add(p.slice(dir.length + 1).split('/')[0]!);
      }
      return { ok: true, entries: [...entries] };
    },
    readProjectFile: (path: string) => ({ ok: true, content: files[path] ?? '' }),
    callProjectApi: async (name: string, input?: unknown) => {
      const h = handlers[name];
      if (!h) return { status: 404, body: { error: `no endpoint named "${name}"` } };
      return h((input ?? {}) as Record<string, unknown>);
    },
    db: { query: async (table: string) => (tableRows ? tableRows[table] ?? [] : []) },
  };
}

/** An endpoint file that queries `table` — the backing-table parse target. */
const endpointFile = (name: string, table: string) =>
  `export const name = '${name}';\nexport default async function handler(input: any, ctx: any) { return { items: await ctx.db.query('${table}') }; }\n`;

const ok = (items: unknown[]) => ({ status: 200, body: { items } });
const checks = (...c: unknown[]) => ({ plan_acceptance: { checks: c } });

describe('build_live_project — the acceptance gate (13a-check_acceptance.ts)', () => {
  it('declares deps on the checks, the endpoints and the seeded tables', () => {
    expect(node.id).toBe('check_acceptance');
    expect(node.dependsOn).toEqual(expect.arrayContaining(['plan_acceptance', 'implement_endpoints', 'implement_tables']));
    expect(node.output['ok']).toBe('boolean');
    expect(node.output['dataGapCount']).toBe('number');
  });

  it('passes a rows-min check the endpoint satisfies', async () => {
    const r = await run(
      ctxFor({ 'api/itinerary/GET.ts': endpointFile('itinerary', 'itinerary_stops') }, { itinerary: () => ok([{}, {}, {}]) }, { itinerary_stops: [{}, {}, {}] }),
      checks({ id: 'days', endpoint: 'itinerary', kind: 'rows-min', min: 3, why: '3 dated legs' }),
    );
    expect(r.ok).toBe(true);
    expect(r.offending).toEqual([]);
    expect(r.checked).toBe(1);
  });

  it('CODE FAULT: a rows-min miss while the backing table is populated → offending (routed to fix)', async () => {
    // The source states 3 legs, the table holds 3, but the endpoint returns 1 — a wrong query/filter.
    const r = await run(
      ctxFor({ 'api/itinerary/GET.ts': endpointFile('itinerary', 'itinerary_stops') }, { itinerary: () => ok([{}]) }, { itinerary_stops: [{}, {}, {}] }),
      checks({ id: 'days', endpoint: 'itinerary', kind: 'rows-min', min: 3, why: 'the brief lists 3 dated legs' }),
    );
    expect(r.ok).toBe(false);
    expect(r.offendingCount).toBe(1);
    expect(r.offending[0]!.path).toBe('api/itinerary/GET.ts');
    expect(r.offending[0]!.errors[0]!.phase).toBe('acceptance');
    expect(r.offending[0]!.errors[0]!.message).toContain('3 row(s)'); // names the data that IS there
    expect(r.dataGaps).toEqual([]);
  });

  it('DATA GAP: a rows-min miss while the backing table is ALSO short → dataGaps, NEVER offending', async () => {
    // The source claimed 3, the endpoint returns 1, but the table only holds 1 — extraction under-mined
    // the source. A code fixer cannot seed data, so this must not be routed to `fix`.
    const r = await run(
      ctxFor({ 'api/itinerary/GET.ts': endpointFile('itinerary', 'itinerary_stops') }, { itinerary: () => ok([{}]) }, { itinerary_stops: [{}] }),
      checks({ id: 'days', endpoint: 'itinerary', kind: 'rows-min', min: 3, why: 'the brief lists 3 dated legs' }),
    );
    expect(r.offending).toEqual([]);
    expect(r.ok).toBe(true); // no CODE fault
    expect(r.dataGapCount).toBe(1);
    expect(r.dataGaps[0]!.endpoint).toBe('itinerary');
    expect(r.dataGaps[0]!.message).toContain('EXTRACTION gap');
  });

  it('CODE FAULT: a field-min aggregate reading zero over a populated table → offending', async () => {
    // The €0-over-a-full-db defect: summary says outstanding=0 but cost_items holds rows.
    const r = await run(
      ctxFor({ 'api/costs-summary/GET.ts': endpointFile('costs-summary', 'cost_items') }, { 'costs-summary': () => ok([{ outstanding_usd: 0 }]) }, { cost_items: [{ amount: 100 }, { amount: 50 }] }),
      checks({ id: 'owed', endpoint: 'costs-summary', kind: 'field-min', field: 'outstanding_usd', min: 0.01, why: 'the brief lists unpaid balances' }),
    );
    expect(r.ok).toBe(false);
    expect(r.offending[0]!.errors[0]!.message).toContain('outstanding_usd=0');
  });

  it('passes a field-min the aggregate satisfies', async () => {
    const r = await run(
      ctxFor({ 'api/costs-summary/GET.ts': endpointFile('costs-summary', 'cost_items') }, { 'costs-summary': () => ok([{ outstanding_usd: 960 }]) }, { cost_items: [{ amount: 960 }] }),
      checks({ id: 'owed', endpoint: 'costs-summary', kind: 'field-min', field: 'outstanding_usd', min: 0.01, why: 'unpaid balances remain' }),
    );
    expect(r.ok).toBe(true);
    expect(r.offending).toEqual([]);
  });

  it('SKIPS a check whose endpoint 500s or is missing — that is smoke\'s finding, not a false acceptance fault', async () => {
    const r = await run(
      ctxFor({ 'api/broken/GET.ts': endpointFile('broken', 'cost_items') }, { broken: () => ({ status: 500, body: { error: 'boom' } }) }, { cost_items: [{}] }),
      checks({ id: 'x', endpoint: 'broken', kind: 'rows-min', min: 1, why: '...' }),
    );
    expect(r.offending).toEqual([]);
    expect(r.dataGaps).toEqual([]);
    expect(r.skipped).toBe(1);
    expect(r.ok).toBe(true);
  });

  it('is a clean no-op when no checks were planned (the common case)', async () => {
    const r = await run(ctxFor({ 'api/x/GET.ts': endpointFile('x', 't') }, { x: () => ok([]) }), { plan_acceptance: { checks: [] } });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(0);
    expect(r.unavailable).toBe(false);
  });

  it('fails LOUDLY with empty offending when callProjectApi is absent', async () => {
    const base = ctxFor({ 'api/x/GET.ts': endpointFile('x', 't') }, {}) as Record<string, unknown>;
    delete base['callProjectApi'];
    const r = await run(base, checks({ id: 'x', endpoint: 'x', kind: 'rows-min', min: 1, why: '...' }));
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
    expect(r.offending).toEqual([]);
    expect(r.reason).toContain('callProjectApi');
  });

  it('emits a scalar-friendly shape (getAtPath returns undefined for arrays)', async () => {
    const r = await run(
      ctxFor({ 'api/itinerary/GET.ts': endpointFile('itinerary', 'itinerary_stops') }, { itinerary: () => ok([{}]) }, { itinerary_stops: [{}, {}] }),
      checks({ id: 'days', endpoint: 'itinerary', kind: 'rows-min', min: 2, why: '2 legs' }),
    );
    expect(typeof r.ok).toBe('boolean');
    expect(typeof r.offendingCount).toBe('number');
    expect(typeof r.dataGapCount).toBe('number');
    expect(typeof r.skipped).toBe('number');
  });
});
