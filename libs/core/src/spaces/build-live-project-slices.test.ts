import { describe, it, expect, beforeAll } from 'vitest';

/**
 * `09b-plan_slices.ts` — the W9 slice-planning code node. `planSlices` is a pure function (no
 * host/IO), so it is tested directly against hand-built plan fragments, mirroring the pattern
 * `08-validate_contract`'s tests already use for a code node's dynamic-imported logic.
 */

interface TableSpec {
  name?: string;
  schema?: { columns?: Record<string, { references?: { table?: string } }> };
}
interface EndpointSpec {
  name?: string;
  tables?: string[];
}
interface ComponentSpec {
  name?: string;
}
interface PageSpec {
  route?: string;
  endpoints?: string[];
  components?: string[];
}
interface AutomationSpec {
  slug?: string;
  on?: { table?: string };
  reads?: string[];
  writes?: string[];
}
interface Slice {
  id: string;
  tables: TableSpec[];
  endpoints: EndpointSpec[];
  components: ComponentSpec[];
  automations: AutomationSpec[];
  views: PageSpec[];
}

let planSlices: (
  tables: TableSpec[],
  endpoints: EndpointSpec[],
  components: ComponentSpec[],
  views: PageSpec[],
  automations: AutomationSpec[],
) => Slice[];
let run: (ctx: unknown, inputs: Record<string, unknown>) => Promise<{ slices: Slice[]; sliceCount: number }>;

beforeAll(async () => {
  const mod = (await import(
    new URL('../../system-spaces/system-appbuilder/tasklists/build_live_project/09b-plan_slices.ts', import.meta.url)
      .href
  )) as { planSlices: typeof planSlices; run: typeof run };
  planSlices = mod.planSlices;
  run = mod.run;
});

const table = (name: string, refs?: Record<string, string>): TableSpec => ({
  name,
  schema: {
    columns: Object.fromEntries(
      Object.entries(refs ?? {}).map(([col, target]) => [col, { references: { table: target } }]),
    ),
  },
});
const endpoint = (name: string, tables: string[]): EndpointSpec => ({ name, tables });
const page = (route: string, endpoints: string[], components: string[] = []): PageSpec => ({
  route,
  endpoints,
  components,
});

describe('planSlices — dependency-ordered, self-contained vertical slices (W9)', () => {
  it('a table with an FK lands in a LATER (or equal) slice than the table it references', () => {
    // job → client (FK). jobs-list (endpoint over job) and clients-list (endpoint over client) are
    // each their own page; the job page must not precede the client page's table requirement is
    // irrelevant here since they're independent tables — the real case is when ONE page needs both.
    const tables = [table('client'), table('job', { clientId: 'client' })];
    const endpoints = [endpoint('job-detail', ['job', 'client'])]; // needs BOTH — job depends on client
    const views = [page('jobs/[id]', ['job-detail'])];
    const slices = planSlices(tables, endpoints, [], views, []);
    // client (depth 0) must appear no later than job (depth 1) — same slice here since one endpoint
    // needs both, but client must never be introduced in a LATER slice than job.
    const clientSlice = slices.findIndex((s) => s.tables.some((t) => t.name === 'client'));
    const jobSlice = slices.findIndex((s) => s.tables.some((t) => t.name === 'job'));
    expect(clientSlice).toBeLessThanOrEqual(jobSlice);
  });

  it('slice 0 is the spine — the entity with no FK dependency, reachable with no other table', () => {
    const tables = [table('client'), table('job', { clientId: 'client' })];
    const endpoints = [endpoint('clients-list', ['client']), endpoint('job-detail', ['job', 'client'])];
    const views = [page('clients', ['clients-list']), page('jobs/[id]', ['job-detail'])];
    const slices = planSlices(tables, endpoints, [], views, []);
    expect(slices[0].tables.map((t) => t.name)).toEqual(['client']);
    expect(slices[0].views.map((v) => v.route)).toEqual(['clients']);
    // job/job-detail only appear once client already exists — a later slice.
    expect(slices.length).toBeGreaterThan(1);
    expect(slices[1].tables.map((t) => t.name)).toEqual(['job']);
  });

  it('slices carry FULL objects (self-contained), not just names', () => {
    const tables = [table('client')];
    const endpoints = [endpoint('clients-list', ['client'])];
    const components = [{ name: 'ClientCard' }];
    const views = [page('clients', ['clients-list'], ['ClientCard'])];
    const slices = planSlices(tables, endpoints, components, views, []);
    expect(slices[0].tables[0]).toEqual(tables[0]); // the real object, not a string
    expect(slices[0].endpoints[0]).toEqual(endpoints[0]);
    expect(slices[0].components[0]).toEqual(components[0]);
  });

  it('never repeats a table/endpoint/component across slices (cumulative "seen" sets)', () => {
    const tables = [table('client'), table('job', { clientId: 'client' })];
    const endpoints = [
      endpoint('clients-list', ['client']),
      endpoint('job-detail', ['job', 'client']), // references 'client' AGAIN
    ];
    const views = [page('clients', ['clients-list']), page('jobs/[id]', ['job-detail'])];
    const slices = planSlices(tables, endpoints, [], views, []);
    const allTableNames = slices.flatMap((s) => s.tables.map((t) => t.name));
    expect(allTableNames).toEqual(['client', 'job']); // client appears exactly once, in slice 0
  });

  it('a table/endpoint reached by NO page still lands somewhere (a trailing slice), never dropped', () => {
    const tables = [table('client'), table('orphan_table')];
    const endpoints = [endpoint('clients-list', ['client']), endpoint('orphan-endpoint', ['orphan_table'])];
    const views = [page('clients', ['clients-list'])]; // orphan-endpoint is never referenced by a page
    const slices = planSlices(tables, endpoints, [], views, []);
    const allTableNames = slices.flatMap((s) => s.tables.map((t) => t.name));
    const allEndpointNames = slices.flatMap((s) => s.endpoints.map((e) => e.name));
    expect(allTableNames).toContain('orphan_table');
    expect(allEndpointNames).toContain('orphan-endpoint');
  });

  it('an automation is assigned to the slice that introduces the table it reacts to', () => {
    const tables = [table('client'), table('job', { clientId: 'client' })];
    const endpoints = [endpoint('clients-list', ['client']), endpoint('job-detail', ['job', 'client'])];
    const views = [page('clients', ['clients-list']), page('jobs/[id]', ['job-detail'])];
    const automations = [{ slug: 'notify-new-job', on: { table: 'job' } }];
    const slices = planSlices(tables, endpoints, [], views, automations);
    const jobSliceIdx = slices.findIndex((s) => s.tables.some((t) => t.name === 'job'));
    expect(slices[jobSliceIdx].automations.map((a) => a.slug)).toEqual(['notify-new-job']);
  });

  it('an automation with no resolvable table rides the LAST slice (safe default)', () => {
    const tables = [table('client')];
    const endpoints = [endpoint('clients-list', ['client'])];
    const views = [page('clients', ['clients-list'])];
    const automations = [{ slug: 'daily-digest' }]; // pure-cron, no table ref
    const slices = planSlices(tables, endpoints, [], views, automations);
    expect(slices[slices.length - 1].automations.map((a) => a.slug)).toEqual(['daily-digest']);
  });

  it('an FK cycle degrades gracefully (no throw, no infinite loop) rather than crashing the plan', () => {
    const tables = [table('a', { bId: 'b' }), table('b', { aId: 'a' })]; // a → b → a
    const endpoints = [endpoint('a-list', ['a']), endpoint('b-list', ['b'])];
    const views = [page('as', ['a-list']), page('bs', ['b-list'])];
    expect(() => planSlices(tables, endpoints, [], views, [])).not.toThrow();
    const slices = planSlices(tables, endpoints, [], views, []);
    const allTableNames = slices.flatMap((s) => s.tables.map((t) => t.name));
    expect(allTableNames.sort()).toEqual(['a', 'b']); // both still land, exactly once each
  });

  it('an api-only build (no pages at all) still slices every table/endpoint into one slice', () => {
    const tables = [table('client')];
    const endpoints = [endpoint('clients-list', ['client'])];
    const slices = planSlices(tables, endpoints, [], [], []);
    expect(slices).toHaveLength(1);
    expect(slices[0].tables.map((t) => t.name)).toEqual(['client']);
  });

  it('run(ctx, inputs) wires the five upstream plan shapes into planSlices and reports sliceCount', async () => {
    const inputs = {
      plan_tables: { tables: [table('client')] },
      plan_endpoints: { endpoints: [endpoint('clients-list', ['client'])] },
      plan_view_components: { components: [] },
      plan_views: [page('clients', ['clients-list'])], // bare array — a forEach node's collected output
      plan_automations: { automations: [] },
    };
    const result = await run({}, inputs);
    expect(result.sliceCount).toBe(1);
    expect((result.slices as Slice[])[0].views[0].route).toBe('clients');
  });
});
