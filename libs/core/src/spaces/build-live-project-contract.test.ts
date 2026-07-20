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

  it('does NOT validate endpoint fields against columns — a single-table aggregate computes them', async () => {
    // Removed after run 35: a single-table GROUP BY legitimately returns keys no column carries
    // (`costs-summary` on `costs`). Flagging those fired on correct designs until the model began
    // dismissing the whole feedback channel as noise. The real case (a re-cased field) is now a
    // COMPILE error via the emit_types contract, and a field the handler never returns is caught by
    // smoke_endpoints — both precise where this check was not.
    const c = clone();
    c.plan_endpoints.endpoints[0]!.fields = ['label: string', 'grandTotalUSD: number', 'total_by_category: number'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(true);
    expect(refs(r)).not.toContain('grandTotalUSD');
    expect(refs(r)).not.toContain('total_by_category');
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

  it('does NOT validate component props against endpoint fields — a prop can be a page-provided literal', async () => {
    // Removed after run 35: a prop is a contract between the PAGE and the component, not between the
    // component and an endpoint. A page passes literals (`label="Pending"`), derived values, or
    // endpoint fields, and at plan time "fed a literal" is indistinguishable from "fed nothing". The
    // check fired on every static title/subtitle/message until the model ignored real errors too.
    const c = clone();
    c.plan_components.components[0]!.props = ['label: string', 'vendorName: string', 'subtitle: string'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(true);
    expect(refs(r)).not.toContain('vendorName');
    expect(refs(r)).not.toContain('subtitle');
  });

  it('STILL flags a component no page renders — dead weight, no false-positive risk', async () => {
    const c = clone();
    c.plan_components.components.push({ name: 'Unused', props: [] });
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('Unused');
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

  // ── AUTOMATIONS (plan_automations) — conditional cron/event hooks, validated like every other ref ──
  // `plan_automations` emits a possibly-empty list; MOST apps (06-tanzania included) emit `[]`, and the
  // whole pipeline must still validate end-to-end. When an automation IS planned, every table it
  // touches must be a real one — a dangling trigger is caught here at PLAN time, not after it ships inert.
  const withAuto = (autos: unknown[]) => ({ ...clone(), plan_automations: { automations: autos } });

  it('ZERO automations (the tanzania case) — an empty list still validates end-to-end', async () => {
    const r = await run({}, withAuto([]) as unknown as Record<string, unknown>);
    expect(r.ok).toBe(true);
    expect(r.errorCount).toBe(0);
  });

  it('a WEEKLY cron automation over real tables validates', async () => {
    const r = await run(
      {},
      withAuto([
        { slug: 'weekly-rollup', story: 's', kind: 'cron', run: 'handler', every: '7d', reads: ['costs'], writes: ['costs'] },
      ]) as unknown as Record<string, unknown>,
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('flags a DANGLING TRIGGER — a handler writing a table nobody declared', async () => {
    const r = await run(
      {},
      withAuto([
        { slug: 'renewal-warnings', story: 's', kind: 'cron', run: 'handler', daily: '08:00', reads: ['costs'], writes: ['reminders'] },
      ]) as unknown as Record<string, unknown>,
    );
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('reminders');
    expect(msgs(r)).toContain('plan_tables never declares');
    // It is the plan_automations node that must change — that text is the fixer's whole input.
    for (const e of r.errors) expect(e.node).toBe('plan_automations');
  });

  it('flags an EVENT automation reacting to a table that does not exist', async () => {
    const r = await run(
      {},
      withAuto([
        { slug: 'on-reminder', story: 's', kind: 'event', run: 'handler', on: { table: 'reminders', event: 'insert' }, reads: [], writes: [] },
      ]) as unknown as Record<string, unknown>,
    );
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('reminders');
  });

  it('flags a cron automation with neither `every` nor `daily`', async () => {
    const r = await run(
      {},
      withAuto([{ slug: 'no-cadence', story: 's', kind: 'cron', run: 'handler', reads: ['costs'], writes: ['costs'] }]) as unknown as Record<string, unknown>,
    );
    expect(r.ok).toBe(false);
    expect(msgs(r)).toContain('EXACTLY ONE cadence');
  });

  it('flags an agent automation with a malformed trigger, and accepts a well-formed one', async () => {
    const bad = await run(
      {},
      withAuto([{ slug: 'draft-note', story: 's', kind: 'cron', run: 'agent', daily: '07:00', reads: [], writes: [], trigger: 'not-a-target' }]) as unknown as Record<string, unknown>,
    );
    expect(bad.ok).toBe(false);
    expect(msgs(bad)).toContain('space/agent#action');
    const good = await run(
      {},
      withAuto([{ slug: 'draft-note', story: 's', kind: 'cron', run: 'agent', daily: '07:00', reads: [], writes: [], trigger: 'editorial/curator#digest' }]) as unknown as Record<string, unknown>,
    );
    expect(good.ok).toBe(true);
  });

  it('automations never make the node throw on malformed input — a code node has no salvage path', async () => {
    const junk = await run({}, { ...OK, plan_automations: { automations: 'nope' } } as unknown as Record<string, unknown>);
    expect(Array.isArray(junk.errors)).toBe(true);
    const junk2 = await run({}, { ...OK, plan_automations: 42 } as unknown as Record<string, unknown>);
    expect(Array.isArray(junk2.errors)).toBe(true);
  });

  // ── COLUMN TYPE GRAMMAR — the root cause of the build-blocking defect ────────────────────────
  // `04-plan_tables.md` used to teach a TS union/array (`'string | null'`, `'string[]'`) as a legal
  // column `type`. The write-time validator (`libs/core/src/db/validate.ts#validateColumn`) exact-
  // matches `type` against string|number|boolean|date|json and THROWS on anything else, so
  // `writeProjectTable` silently failed the whole table with no log line, and the downstream repair
  // loop had nothing concrete to fix. This check catches the mismatch at PLAN time instead.
  it('flags a column typed as a TS union ("string | null") instead of a base type', async () => {
    const c = clone();
    c.plan_tables.tables[0]!.schema.columns['label'] = { type: 'string | null', description: 'label' };
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('costs.label');
    expect(msgs(r)).toContain('string | null');
    expect(msgs(r)).toContain('required: false');
    for (const e of r.errors.filter((x) => x.ref === 'costs.label')) expect(e.node).toBe('plan_tables');
  });

  it('flags a column typed as an array shape ("string[]") instead of a base type', async () => {
    const c = clone();
    c.plan_tables.tables[0]!.schema.columns['tags'] = { type: 'string[]', description: 'tags' };
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('costs.tags');
    expect(msgs(r)).toContain('string[]');
  });

  it('accepts a clean base-type schema with required:false for nullability', async () => {
    const c = clone();
    const columns = c.plan_tables.tables[0]!.schema.columns as Record<string, { type: string; description: string; required?: boolean }>;
    columns['notes'] = { type: 'string', description: 'optional notes', required: false };
    columns['due_at'] = { type: 'date', description: 'due date' };
    columns['extra'] = { type: 'json', description: 'structured extra data' };
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
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
