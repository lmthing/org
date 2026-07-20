import { describe, it, expect, beforeAll } from 'vitest';

/**
 * The contract gate — `08-validate_contract.ts`, a HOST-RUN code node that runs BEFORE any app code
 * exists — driven against hand-built contracts.
 *
 * Every fault below was authored at PLAN time in a real run and only surfaced after every table,
 * endpoint, component and page had been written. The canonical one is 06-tanzania run 32's Costs
 * page: it called `useApi('costs-summary')`, a name `plan_endpoints` never assigned, and shipped
 * dead — the client rejects an unknown name before issuing a request, so there was an error state
 * and nothing in the network panel. Four independent model turns produce this contract and nothing
 * made them agree; this node is what makes them agree.
 */

type Contract = {
  ok: boolean;
  errorCount: number;
  errors: Array<{ node: string; ref: string; message: string }>;
};

// The node lives outside libs/core's tsconfig `include: ["src"]`, so it is reached by a computed
// dynamic import rather than a static one.
let run: (ctx: unknown, inputs: Record<string, unknown>) => Promise<Contract>;
beforeAll(async () => {
  const mod = (await import(
    new URL(
      '../../system-spaces/system-appbuilder/tasklists/build_live_project/08-validate_contract.ts',
      import.meta.url,
    ).href
  )) as { run: typeof run };
  run = mod.run;
});

const table = (name: string, cols: string[]) => ({
  name,
  schema: { columns: Object.fromEntries(cols.map((c) => [c, { type: 'string', description: c }])) },
});

/** A coherent baseline: one table, one endpoint reading it, one page reading that endpoint. */
const OK = {
  plan_tables: { tables: [table('costs', ['id', 'label', 'amount_usd'])] },
  plan_endpoints: {
    endpoints: [{ name: 'costs-list', route: 'costs-list/GET', tables: ['costs'], fields: ['label: string', 'amount_usd: number'] }],
  },
  plan_components: { components: [{ name: 'CostRow', props: ['label: string', 'amount_usd: number'] }] },
  plan_pages: [{ route: 'costs', endpoints: ['costs-list'], components: ['CostRow'] }],
};

const clone = (): typeof OK => JSON.parse(JSON.stringify(OK)) as typeof OK;
const refs = (r: Contract) => r.errors.map((e) => e.ref);
const msgs = (r: Contract) => r.errors.map((e) => e.message).join(' | ');

describe('build_live_project — the contract gate (08-validate_contract.ts)', () => {
  it('passes a coherent contract', async () => {
    const r = await run({}, OK as unknown as Record<string, unknown>);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.errorCount).toBe(0);
  });

  it('flags the run-32 fault: a page reading an endpoint nobody assigned', async () => {
    const c = clone();
    c.plan_pages[0]!.endpoints = ['costs-summary'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('costs-summary');
    // Must name the REAL options — that text is the entire input the resumed design node gets.
    expect(msgs(r)).toContain('costs-list');
  });

  it('flags an endpoint reading a table nobody declared', async () => {
    const c = clone();
    c.plan_endpoints.endpoints[0]!.tables = ['expenses'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(msgs(r)).toContain('expenses');
    expect(msgs(r)).toContain('500'); // names the runtime failure mode, not just the mismatch
  });

  it('flags a field the single source table has no column for', async () => {
    const c = clone();
    c.plan_endpoints.endpoints[0]!.fields = ['label: string', 'grandTotalUSD: number'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('grandTotalUSD');
    expect(msgs(r)).toContain('amount_usd'); // tells the redesign the real column name
  });

  it('does NOT flag computed fields on a MULTI-table endpoint', async () => {
    // A join or an aggregate legitimately returns keys no single column carries. Flagging those
    // would teach the redesign to delete correct work.
    const c = clone();
    c.plan_tables.tables.push(table('trips', ['id', 'name']));
    c.plan_endpoints.endpoints[0]!.tables = ['costs', 'trips'];
    c.plan_endpoints.endpoints[0]!.fields = ['trip_name: string', 'total_usd: number'];
    c.plan_components.components[0]!.props = ['trip_name: string'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(refs(r)).not.toContain('total_usd');
  });

  it('flags duplicate endpoint names and duplicate routes', async () => {
    const c = clone();
    c.plan_endpoints.endpoints.push({ name: 'costs-list', route: 'costs-list/GET', tables: ['costs'], fields: ['label: string'] });
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(msgs(r)).toContain('share the name');
    expect(msgs(r)).toContain('share the route');
  });

  it('flags a page rendering a component nobody declared', async () => {
    const c = clone();
    c.plan_pages[0]!.components = ['TotalsBar'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('TotalsBar');
    expect(msgs(r)).toContain('dangling import');
  });

  it('flags a [id] endpoint no page ever declares', async () => {
    const c = clone();
    c.plan_endpoints.endpoints.push({ name: 'costs-detail', route: 'costs/[id]/GET', tables: ['costs'], fields: ['label: string'] });
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(msgs(r)).toContain('[id]');
  });

  it('flags a component prop no endpoint can feed', async () => {
    const c = clone();
    c.plan_components.components[0]!.props = ['label: string', 'vendorName: string'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('vendorName');
  });

  it('does NOT flag presentational props', async () => {
    const c = clone();
    c.plan_components.components[0]!.props = ['label: string', 'children', 'className: string'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.errors).toEqual([]);
  });

  it('flags an unrendered component and an unread table', async () => {
    const c = clone();
    c.plan_components.components.push({ name: 'Orphan', props: [] });
    c.plan_tables.tables.push(table('notes', ['id', 'body']));
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('Orphan');
    expect(refs(r)).toContain('notes');
  });

  it('every error names the node that must change — it is what onFail carries', async () => {
    const c = clone();
    c.plan_pages[0]!.endpoints = ['nope'];
    c.plan_endpoints.endpoints[0]!.tables = ['gone'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
    for (const e of r.errors) {
      expect(e.node).toMatch(/^plan_(tables|endpoints|components|pages)$/);
      expect(e.message.length).toBeGreaterThan(40); // actionable prose, not a bare code
    }
  });

  it('never throws on a missing or malformed upstream — a code node has no salvage path', async () => {
    // A throw would abort the whole tasklist instead of routing the faults to a redesign.
    const r = await run({}, {});
    expect(r.ok).toBe(true); // nothing declared ⇒ nothing inconsistent
    expect(Array.isArray(r.errors)).toBe(true);

    const junk = await run({}, { plan_tables: 'nope', plan_endpoints: { endpoints: null }, plan_pages: 42 });
    expect(Array.isArray(junk.errors)).toBe(true);
  });

  it('emits a SCALAR ok — the condition DSL cannot read array length', async () => {
    // `getAtPath` returns undefined for arrays, so `validate_contract.errors.length > 0` is not
    // expressible in a `when:`. The onFail predicate compares `ok`.
    const c = clone();
    c.plan_pages[0]!.endpoints = ['nope'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(typeof r.ok).toBe('boolean');
    expect(typeof r.errorCount).toBe('number');
  });
});
