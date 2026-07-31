import { describe, it, expect, beforeAll } from 'vitest';

/**
 * The contract gate — `08-validate_contract.ts`, a HOST-RUN code node that runs BEFORE any app code
 * exists — driven against hand-built contracts.
 *
 * Every fault below was authored at PLAN time in a real run and only surfaced after every table,
 * endpoint, component and page had been written. The canonical one is 06-tanzania run 32's Costs
 * page: it read `costs-summary`, a name `plan_endpoints` never assigned, and shipped dead. Five
 * independent model turns produce this contract and nothing made them agree; this node is what
 * makes them agree.
 *
 * A page here is a SPEC — an ordered list of sections, each naming ONE endpoint and binding `$.field`
 * paths straight into its Output — so the view half of the contract is checked far more strictly than
 * a TSX page ever could be. There is no client-side glue (no `.map`, no join, no ternary), which means
 * a binding the endpoint does not declare is not a cosmetic mismatch: it is a value that can never
 * appear, and it is UNFIXABLE downstream. That is the view-shaped-endpoint rule, and it is why those
 * misses are addressed to `plan_endpoints` — the endpoint grows a computed field; the page never
 * grows glue.
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

/**
 * A coherent baseline: one table, one endpoint reading it, one page whose single `list` section
 * reads that endpoint, renders the declared view component, and binds only fields the endpoint
 * declares. `plan_views` is a per-page forEach, so it arrives as a bare ARRAY of page specs.
 */
const OK = {
  plan_tables: { tables: [table('costs', ['id', 'label', 'amount_usd'])] },
  plan_endpoints: {
    endpoints: [{ name: 'costs-list', route: 'costs-list/GET', tables: ['costs'], fields: ['label: string', 'amount_usd: number'] }],
  },
  plan_view_components: { components: [{ name: 'CostRow', props: ['label: string', 'amount_usd: number'] }] },
  plan_views: [
    {
      route: 'costs',
      endpoints: ['costs-list'],
      components: ['CostRow'],
      sections: [
        { id: 'costs', kind: 'list', endpoint: 'costs-list', component: 'CostRow', bindings: ['$.label', '$.amount_usd'] },
      ],
    },
  ],
};

const clone = (): typeof OK => JSON.parse(JSON.stringify(OK)) as typeof OK;
const refs = (r: Contract) => r.errors.map((e) => e.ref);
const msgs = (r: Contract) => r.errors.map((e) => e.message).join(' | ');
const nodes = (r: Contract) => r.errors.map((e) => e.node);
/** The single section of the baseline page — the thing most of these faults are injected into. */
const section = (c: typeof OK) => c.plan_views[0]!.sections[0]!;

describe('build_live_project — the contract gate (08-validate_contract.ts)', () => {
  it('passes a coherent contract', async () => {
    const r = await run({}, OK as unknown as Record<string, unknown>);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.errorCount).toBe(0);
  });

  it('flags the run-32 fault: a section reading an endpoint nobody assigned', async () => {
    const c = clone();
    section(c).endpoint = 'costs-summary';
    c.plan_views[0]!.endpoints = ['costs-summary'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('costs-summary');
    // Must name the REAL options — that text is the entire input the resumed design node gets.
    expect(msgs(r)).toContain('costs-list');
    // And it must say what actually happens: the writer rejects an unknown endpoint name, so the
    // page never lands at all — not "a section renders empty".
    expect(msgs(r)).toContain('this whole page fails to save');
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
    section(c).bindings = ['$.label', '$.grandTotalUSD'];
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

  it('flags a section using a view component nobody declared', async () => {
    const c = clone();
    section(c).component = 'TotalsBar';
    c.plan_views[0]!.components = ['TotalsBar'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('TotalsBar');
    // A `{ use: … }` that resolves nowhere is a SAVE-TIME rejection of the whole page, not a blank
    // row — the message has to say so or the fixer treats it as cosmetic.
    expect(msgs(r)).toContain('the whole page fails to save');
    expect(msgs(r)).toContain('CostRow'); // the real options, again
  });

  it('flags a [id] endpoint no page section ever reads', async () => {
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
    c.plan_view_components.components[0]!.props = ['label: string', 'vendorName: string', 'subtitle: string'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(true);
    expect(refs(r)).not.toContain('vendorName');
    expect(refs(r)).not.toContain('subtitle');
  });

  it('STILL flags a view component no section renders — dead weight, no false-positive risk', async () => {
    const c = clone();
    c.plan_view_components.components.push({ name: 'Unused', props: [] });
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('Unused');
    // And it points at the cheap answer rather than only at the deletion: most rows need no
    // component at all.
    expect(msgs(r)).toContain('flat item form');
  });

  it('flags an unrendered component and an unread table', async () => {
    const c = clone();
    c.plan_view_components.components.push({ name: 'Orphan', props: [] });
    c.plan_tables.tables.push(table('notes', ['id', 'body']));
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('Orphan');
    expect(refs(r)).toContain('notes');
  });

  it('every error names the node that must change — it is what onFail carries', async () => {
    const c = clone();
    section(c).endpoint = 'nope';
    c.plan_views[0]!.endpoints = ['nope'];
    c.plan_endpoints.endpoints[0]!.tables = ['gone'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
    for (const e of r.errors) {
      expect(e.node).toMatch(/^plan_(tables|endpoints|view_components|views|automations)$/);
      expect(e.message.length).toBeGreaterThan(40); // actionable prose, not a bare code
    }
  });

  it('never throws on a missing or malformed upstream — a code node has no salvage path', async () => {
    // A throw would abort the whole tasklist instead of routing the faults to a redesign.
    const r = await run({}, {});
    expect(r.ok).toBe(true); // nothing declared ⇒ nothing inconsistent
    expect(Array.isArray(r.errors)).toBe(true);

    const junk = await run({}, { plan_tables: 'nope', plan_endpoints: { endpoints: null }, plan_views: 42 });
    expect(Array.isArray(junk.errors)).toBe(true);

    // `plan_views` is a per-page forEach, so its output is an ARRAY assembled from N independent
    // forks — a page entry that is not the declared object shape is the realistic malformed case.
    // (A fork that never resolves is replaced by `salvageData(task.output)`, an OBJECT, which is why
    // a bare `null` element is not reachable through the orchestrator and is not asserted here —
    // `08-validate_contract.ts` reads `p.sections` unguarded and WOULD throw on one.)
    const junkPages = await run({}, { ...OK, plan_views: ['costs', 42, { route: 'x', sections: 'nope' }] });
    expect(Array.isArray(junkPages.errors)).toBe(true);
  });

  // ── THE VIEW CHECKS (V1–V6 + 1b) — the half of the contract that only exists for a SPEC page ──
  //
  // A spec has no client code, so each of these is a value that could never appear rather than a
  // mismatch someone patches later. They are the checks that replaced the TSX-era scans entirely.

  it('THE VIEW-SHAPED-ENDPOINT RULE: a binding no endpoint field satisfies is routed to plan_endpoints', async () => {
    // The single most important routing decision in this node. The symptom is on the PAGE, and the
    // instinct is to send it back to the page — which gets the binding deleted, i.e. the feature
    // deleted. There is nowhere on a spec page to compute a cross-table name, so the fix is always
    // that the ENDPOINT grows a computed field.
    const c = clone();
    section(c).bindings = ['$.label', '$.paid_by_name'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    const fault = r.errors.find((e) => e.ref === 'costs-list.paid_by_name');
    expect(fault, 'the fault is keyed on <endpoint>.<field>').toBeTruthy();
    expect(fault!.node).toBe('plan_endpoints');
    expect(fault!.message).toContain('no map, no join, no ternary');
    expect(fault!.message).toContain('ADD "paid_by_name"');
    // And it must forbid the two wrong fixes explicitly.
    expect(fault!.message).toContain('Do NOT instead point the section at a second endpoint');
    expect(fault!.message).toContain('do NOT drop the value the story needs');
  });

  it('checks only the FIRST segment of a $.-rooted binding, and ignores every other root', async () => {
    // `$.plan.days` is the endpoint declaring `plan` with a nested `item` shape — the sub-keys are
    // the emitted contract's business, not this node's. `$route.` / `$props.` / `$form.` /
    // `$data.` / `$client.` resolve OUTSIDE the endpoint's Output entirely, so reading them as
    // missing fields would flag every correct page in the app.
    const c = clone();
    c.plan_endpoints.endpoints[0]!.fields = ['label: string', { name: 'plan', list: true, item: ['day: string'] } as unknown as string];
    section(c).bindings = ['$.label', '$.plan.days', '$route.id', '$props.x', '$form.title', '$client.timezone', '$'];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(refs(r).some((x) => x.startsWith('costs-list.'))).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('flags an invented section kind and names the complete menu of eight', async () => {
    const c = clone();
    section(c).kind = 'kanban';
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    const fault = r.errors.find((e) => e.message.includes('kanban'))!;
    expect(fault.node).toBe('plan_views');
    for (const kind of ['list', 'detail', 'create', 'stats', 'markdown', 'chat', 'toolbar', 'timeline']) {
      expect(fault.message).toContain(kind);
    }
    // The escape hatch is named and closed: record it in cannotExpress, never force the nearest kind.
    expect(fault.message).toContain('cannotExpress');
  });

  it('flags a data section that names no endpoint, but leaves toolbar/chat/markdown alone', async () => {
    const c = clone();
    delete (section(c) as { endpoint?: string }).endpoint;
    const bad = await run({}, c as unknown as Record<string, unknown>);
    expect(bad.ok).toBe(false);
    expect(msgs(bad)).toContain('a list section reads exactly one');

    // The three endpointless kinds are legal with no endpoint at all.
    const c2 = clone();
    c2.plan_views[0]!.sections.push(
      { id: 'tools', kind: 'toolbar', reveals: ['costs'] } as unknown as (typeof OK)['plan_views'][0]['sections'][0],
      { id: 'dock', kind: 'chat' } as unknown as (typeof OK)['plan_views'][0]['sections'][0],
      { id: 'intro', kind: 'markdown' } as unknown as (typeof OK)['plan_views'][0]['sections'][0],
    );
    const good = await run({}, c2 as unknown as Record<string, unknown>);
    expect(good.errors).toEqual([]);
  });

  it('flags a duplicate section id — it is the handle reveals and $data resolve against', async () => {
    const c = clone();
    c.plan_views[0]!.sections.push({ ...section(c), id: 'costs' });
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('costs#costs');
    expect(msgs(r)).toContain('silently points at whichever came first');
  });

  it('flags a $data / reveals target that is not a section on THIS page', async () => {
    const c = clone();
    section(c).bindings = ['$.label', '$data.summary.total'];
    c.plan_views[0]!.sections.push({
      id: 'tools', kind: 'toolbar', reveals: ['addCost'],
    } as unknown as (typeof OK)['plan_views'][0]['sections'][0]);
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    // Both resolve WITHIN one page's spec, so both faults belong to plan_views.
    for (const e of r.errors) expect(e.node).toBe('plan_views');
    expect(msgs(r)).toContain('reads ANOTHER SECTION OF THE SAME PAGE');
    expect(msgs(r)).toContain('this page has no section with that id');
  });

  it('flags a page that plans no sections at all — a page IS its section list', async () => {
    const c = clone();
    c.plan_views[0]!.sections = [];
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('costs');
    expect(msgs(r)).toContain('would render an empty shell');
  });

  it("flags a `create` section's endpoint that declares no `input` — the form with no fields", async () => {
    // A `create` section declares no fields BY DESIGN: the renderer derives every one from the
    // endpoint's Input schema. So an absent `input` renders "Nothing to fill in." above a Save
    // button — and buildApp, validateAppViews and renderSmokeViews ALL pass, because the spec and
    // the data are perfectly consistent with a body nobody ever specified.
    const c = clone();
    c.plan_endpoints.endpoints.push({ name: 'add-cost', route: 'costs/POST', tables: ['costs'], fields: ['id: string'] });
    c.plan_views[0]!.sections.push({
      id: 'addCost', kind: 'create', endpoint: 'add-cost', bindings: [],
    } as unknown as (typeof OK)['plan_views'][0]['sections'][0]);
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    const fault = r.errors.find((e) => e.ref === 'add-cost')!;
    expect(fault.node).toBe('plan_endpoints');
    expect(fault.message).toContain('Nothing to fill in.');
    expect(fault.message).toContain("input: ['name: string'"); // it shows the shape to write
    expect(fault.message).toContain('Route `[param]`s do NOT go here');

    // Declaring the body clears it.
    // `input` is optional on the fixture's endpoint literal — the whole point of the check above is
    // that it may be ABSENT — so the contract type does not carry it and the assignment needs the cast.
    (c.plan_endpoints.endpoints[1] as unknown as { input: string[] }).input = ['label: string', 'amount_usd: number'];
    const fixed = await run({}, c as unknown as Record<string, unknown>);
    expect(fixed.errors).toEqual([]);
  });

  it('does NOT demand an `input` from a write endpoint no create section reads (the action write)', async () => {
    // 13-plant-care run 8: asking every POST/PUT/PATCH for a body is not a property of the method.
    // An ACTION write — `costs/[id]/settle/POST` — carries no body ON PURPOSE; its argument is the
    // route param. The model refused the rule three times, spending BOTH onFail attempts on a gate
    // no correct plan could satisfy.
    const c = clone();
    c.plan_endpoints.endpoints.push({ name: 'settle-cost', route: 'costs/[id]/settle/POST', tables: ['costs'], fields: ['id: string'] });
    c.plan_views[0]!.sections.push({
      id: 'settle', kind: 'detail', endpoint: 'settle-cost', bindings: ['$.id'],
    } as unknown as (typeof OK)['plan_views'][0]['sections'][0]);
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(refs(r)).not.toContain('settle-cost');
    expect(r.ok).toBe(true);
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

  // ── DUPLICATE-ENTITY TABLES (P1) — two tables modelling one real-world thing ─────────────────
  // 07-life-admin run 26 step-14: the app built `receipts` + `receipts_purchases` over the SAME two
  // receipts (and `boiler_service` + `service_records`, `household` + `household_info`). A retract then
  // deleted the row from only one copy — the other lingered and the total re-inflated. The guard flags a
  // pair whose SUBSTANTIVE (non-id) column sets overlap ≥60% so the redesign collapses them into one
  // canonical table. The 3-substantive-column floor keeps a legitimate FK child clear.
  it('flags twin tables that model the same entity (receipts + receipts_purchases)', async () => {
    const c = {
      plan_tables: {
        tables: [
          table('receipts', ['id', 'vendor', 'amount_usd', 'purchased_on']),
          table('receipts_purchases', ['id', 'vendor', 'amount_usd', 'purchased_on']),
        ],
      },
      plan_endpoints: {
        endpoints: [
          { name: 'receipts-list', route: 'receipts-list/GET', tables: ['receipts'], fields: ['vendor: string'] },
          { name: 'purchases-list', route: 'purchases-list/GET', tables: ['receipts_purchases'], fields: ['vendor: string'] },
        ],
      },
      plan_view_components: { components: [] },
      plan_views: [
        {
          route: 'receipts',
          endpoints: ['receipts-list', 'purchases-list'],
          components: [],
          sections: [
            { id: 'receipts', kind: 'list', endpoint: 'receipts-list', bindings: ['$.vendor'] },
            { id: 'purchases', kind: 'list', endpoint: 'purchases-list', bindings: ['$.vendor'] },
          ],
        },
      ],
    };
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('receipts ~ receipts_purchases');
    expect(msgs(r)).toContain('model the same entity');
    expect(msgs(r)).toContain('double-counts');
    for (const e of r.errors.filter((x) => x.ref.includes('~'))) expect(e.node).toBe('plan_tables');
  });

  it('does NOT flag a legitimate parent/child FK pair (pets + pet_vaccinations)', async () => {
    // A child table shares FEW substantive columns with its parent (a foreign key + its own fields), so
    // the overlap stays well under the 0.6 floor — the guard must never fold a real one-to-many apart.
    const c = {
      plan_tables: {
        tables: [
          table('pets', ['id', 'name', 'species', 'birth_date']),
          table('pet_vaccinations', ['id', 'pet_id', 'vaccine', 'administered_on', 'due_on']),
        ],
      },
      plan_endpoints: {
        endpoints: [
          { name: 'pets-list', route: 'pets-list/GET', tables: ['pets'], fields: ['name: string'] },
          { name: 'vax-list', route: 'vax-list/GET', tables: ['pet_vaccinations'], fields: ['vaccine: string'] },
        ],
      },
      plan_view_components: { components: [] },
      plan_views: [
        {
          route: 'pets',
          endpoints: ['pets-list', 'vax-list'],
          components: [],
          sections: [
            { id: 'pets', kind: 'list', endpoint: 'pets-list', bindings: ['$.name'] },
            { id: 'vax', kind: 'list', endpoint: 'vax-list', bindings: ['$.vaccine'] },
          ],
        },
      ],
    };
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(refs(r).some((x) => x.includes('~'))).toBe(false);
    expect(r.ok).toBe(true);
  });

  // ── ORPHAN ENDPOINTS (P5b) — an endpoint no section reads is dead weight a later acceptance pass can
  // falsely green. 07-life-admin run 26 step-3: four dashboard-* endpoints existed, the page used two,
  // and plan_acceptance "verified" an orphaned one while the page's real dashboard-stats was broken.
  it('flags an unparameterized endpoint no section reads and no automation runs', async () => {
    const c = clone();
    c.plan_endpoints.endpoints.push({ name: 'dashboard-upcoming', route: 'dashboard-upcoming/GET', tables: ['costs'], fields: ['label: string'] });
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(r.ok).toBe(false);
    expect(refs(r)).toContain('dashboard-upcoming');
    expect(msgs(r)).toContain('no page section reads it');
    for (const e of r.errors.filter((x) => x.ref === 'dashboard-upcoming')) expect(e.node).toBe('plan_endpoints');
  });

  it('does NOT flag an endpoint a section actually reads', async () => {
    const c = clone();
    c.plan_endpoints.endpoints.push({ name: 'costs-summary', route: 'costs-summary/GET', tables: ['costs'], fields: ['total: number'] });
    c.plan_views[0]!.endpoints = ['costs-list', 'costs-summary'];
    c.plan_views[0]!.sections.push({
      id: 'totals', kind: 'stats', endpoint: 'costs-summary', bindings: ['$.total'],
    } as unknown as (typeof OK)['plan_views'][0]['sections'][0]);
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(refs(r)).not.toContain('costs-summary');
    expect(r.ok).toBe(true);
  });

  it('emits a SCALAR ok — the condition DSL cannot read array length', async () => {
    // `getAtPath` returns undefined for arrays, so `validate_contract.errors.length > 0` is not
    // expressible in a `when:`. The onFail predicate compares `ok`.
    const c = clone();
    section(c).endpoint = 'nope';
    const r = await run({}, c as unknown as Record<string, unknown>);
    expect(typeof r.ok).toBe('boolean');
    expect(typeof r.errorCount).toBe('number');
    expect(nodes(r).length).toBe(r.errorCount);
  });
});
