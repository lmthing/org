import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
type Malformed = { check: string; endpoint: string; kind: string; reason: string; message: string };
type Result = {
  ok: boolean;
  checked: number;
  offending: Offending[];
  offendingCount: number;
  dataGaps: DataGap[];
  dataGapCount: number;
  malformed: Malformed[];
  malformedCount: number;
  skipped: number;
  unavailable: boolean;
  reason: string;
};

let run: (ctx: unknown, inputs: Record<string, unknown>) => Promise<Result>;
let node: {
  id: string;
  dependsOn: string[];
  output: Record<string, string>;
  onFail?: { goto: string; when?: string; carry?: string; maxAttempts?: number };
};
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

/** An endpoint file that queries `tables` — the backing-table parse target. */
const endpointFile = (name: string, ...tables: string[]) =>
  `export const name = '${name}';\nexport default async function handler(input: any, ctx: any) { return { items: [${tables
    .map((t) => `...await ctx.db.query('${t}')`)
    .join(', ')}] }; }\n`;

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
    expect(typeof r.malformedCount).toBe('number');
    expect(typeof r.skipped).toBe('number');
  });
});

/**
 * THE £70.49 CASE — scenario `30-bike-workshop`, run 202.
 *
 * The brief said, in one sentence: "Labour is charged at £45/hour. A job's total is labour plus the
 * parts fitted to it." The generated `jobs-list` handler summed the parts and stopped. The Allez job
 * (2.5 hours, a £28.99 chain and a £41.50 cassette) showed **£70.49** where the brief's own arithmetic
 * says 2.5 × 45 + 70.49 = **£182.99**.
 *
 * Nothing caught it. The shape was right, the type was right, `smoke_endpoints` got a 200 with a real
 * envelope, `renderSmokeViews` saw a populated page, and the acceptance gate — which existed — had no
 * check to run, because a FLOOR cannot see a dropped term (70.49 clears every floor you would write)
 * and the planner had no kind that could carry the expected VALUE.
 *
 * These are the tests that would have caught it. Every one of them fails against the pre-change node:
 * `field-equals` was not a kind it knew, so the check was silently `skipped++` and the gate reported
 * `ok: true`.
 */
describe('build_live_project acceptance — the arithmetic gate (the £70.49 defect)', () => {
  /** The seeded rows, exactly as the brief states them. */
  const jobRows = [
    { id: 'j2', bike_name: 'Giant Escape', hours: 1.5, parts_total: 78.0 },
    { id: 'j1', bike_name: 'Specialized Allez', hours: 2.5, parts_total: 70.49 },
    { id: 'j3', bike_name: 'Brompton M6L', hours: 0.75, parts_total: 15.95 },
    { id: 'j4', bike_name: 'Trek Marlin', hours: 3, parts_total: 24.0 },
  ];
  const partRows = [{}, {}, {}, {}, {}, {}, {}];
  const files = { 'api/jobs-list/GET.ts': endpointFile('jobs-list', 'jobs', 'job_parts') };
  const tables = { jobs: jobRows, job_parts: partRows };

  /** What shipped: the total is the PARTS ALONE — the labour term the brief priced is missing. */
  const partsOnly = () => ok(jobRows.map((j) => ({ ...j, total_gbp: j.parts_total })));
  /** What the brief describes: labour at £45/hour PLUS the parts. */
  const labourPlusParts = () => ok(jobRows.map((j) => ({ ...j, total_gbp: j.hours * 45 + j.parts_total })));

  /** The check `plan_acceptance` must now emit for that one sentence of the brief. */
  const allezTotal = {
    id: 'allez-job-total',
    story: 'list-all-jobs',
    endpoint: 'jobs-list',
    kind: 'field-equals',
    match: { field: 'bike_name', value: 'Specialized Allez' },
    field: 'total_gbp',
    equals: 182.99,
    why: 'brief: labour £45/h, total = labour + parts. 2.5h x 45 = 112.50 + parts 70.49 = 182.99',
  };

  it('CATCHES the dropped labour term: 70.49 where the brief says 182.99', async () => {
    const r = await run(ctxFor(files, { 'jobs-list': partsOnly }, tables), checks(allezTotal));

    // Exit status is ground truth: this build must NOT report clean.
    expect(r.ok).toBe(false);
    expect(r.checked).toBe(1);
    expect(r.skipped).toBe(0); // never silently dropped — the old node skipped what it could not parse

    // Routed to the ENDPOINT THAT COMPUTED the number, not the page that displayed it.
    expect(r.offendingCount).toBe(1);
    expect(r.offending[0]!.path).toBe('api/jobs-list/GET.ts');
    expect(r.offending[0]!.kind).toBe('api');
    const err = r.offending[0]!.errors[0]!;
    expect(err.phase).toBe('acceptance');
    expect(err.probe).toBe('allez-job-total');
    // The message must carry BOTH numbers and the arithmetic, or the fixer cannot tell which term went.
    expect(err.message).toContain('182.99');
    expect(err.message).toContain('total_gbp=70.49');
    expect(err.message).toContain('2.5h x 45');
    expect(err.message).toMatch(/TERM/);

    // NOT a data gap: the rows are all there, the handler just computed the wrong figure.
    expect(r.dataGaps).toEqual([]);
  });

  it('PASSES the same check once the handler computes every term', async () => {
    const r = await run(ctxFor(files, { 'jobs-list': labourPlusParts }, tables), checks(allezTotal));
    expect(r.ok).toBe(true);
    expect(r.offending).toEqual([]);
    expect(r.dataGaps).toEqual([]);
    expect(r.malformed).toEqual([]);
  });

  it('matches the ROW by a business value, so list ORDER cannot make the check unwritable', async () => {
    // run 202's planner declined to check any per-row figure in as many words: "row order isn't
    // guaranteed" and field-min "checks only items[0]". The Allez is SECOND here; `match` finds it.
    const r = await run(ctxFor(files, { 'jobs-list': partsOnly }, tables), checks(allezTotal));
    expect(r.offending[0]!.errors[0]!.message).toContain('bike_name');
    // ...and reading items[0] blind would have measured the WRONG job entirely.
    expect(jobRows[0]!.bike_name).not.toBe('Specialized Allez');
  });

  it('tolerates penny round-off but not a dropped term', async () => {
    const near = () => ok([{ bike_name: 'Specialized Allez', total_gbp: 182.985 }]);
    const off = () => ok([{ bike_name: 'Specialized Allez', total_gbp: 183.5 }]);
    expect((await run(ctxFor(files, { 'jobs-list': near }, tables), checks(allezTotal))).ok).toBe(true);
    expect((await run(ctxFor(files, { 'jobs-list': off }, tables), checks(allezTotal))).ok).toBe(false);
    // An explicit tolerance widens it — for a figure the source itself rounds — but only by what it
    // says: 183.5 is inside ±1, the parts-only 70.49 never is.
    const loose = { ...allezTotal, tolerance: 1 };
    expect((await run(ctxFor(files, { 'jobs-list': off }, tables), checks(loose))).ok).toBe(true);
    expect((await run(ctxFor(files, { 'jobs-list': partsOnly }, tables), checks(loose))).ok).toBe(false);
  });

  it('a WRONG-but-non-zero figure is a computation fault even when the row counter is blind', async () => {
    // The discriminator that would otherwise mis-file this: `backingRows` can only count tables named
    // by a LITERAL `db.query('t')`, so a handler building its query dynamically reports `null` rows —
    // and the old rule (`rows !== null && rows >= need`) would have called an exact-arithmetic miss an
    // EXTRACTION gap, i.e. "the source was under-mined" about data sitting right there in the DB.
    const opaque = { 'api/jobs-list/GET.ts': `export const name = 'jobs-list';\nexport default async function handler(i: any, ctx: any) { return { items: await ctx.db.query(TABLE) }; }\n` };
    const r = await run(ctxFor(opaque, { 'jobs-list': partsOnly }, tables), checks(allezTotal));
    expect(r.ok).toBe(false);
    expect(r.offendingCount).toBe(1);
    expect(r.offending[0]!.path).toBe('api/jobs-list/GET.ts');
    expect(r.dataGaps).toEqual([]);
  });

  it('reports the field as ABSENT when the endpoint never returned it at all', async () => {
    const noField = () => ok([{ bike_name: 'Specialized Allez', parts_total: 70.49 }]);
    const r = await run(ctxFor(files, { 'jobs-list': noField }, tables), checks(allezTotal));
    expect(r.ok).toBe(false);
    expect(r.offending[0]!.errors[0]!.message).toContain('ABSENT');
    expect(r.offending[0]!.errors[0]!.message).toContain('bike_name, parts_total'); // the keys it DID return
  });

  it('a row the source promised but the endpoint never returned is a failure, not a pass', async () => {
    const missingRow = () => ok([{ bike_name: 'Giant Escape', total_gbp: 145.5 }]);
    const r = await run(ctxFor(files, { 'jobs-list': missingRow }, tables), checks(allezTotal));
    expect(r.ok).toBe(false);
    expect(r.offending[0]!.errors[0]!.message).toContain('no returned row has');
    expect(r.malformed).toEqual([]); // the APP's fault, not the planner's
  });

  it('still supports an aggregate field-equals with no match (items[0] IS the answer)', async () => {
    const shopTotal = { id: 'shop-total', endpoint: 'jobs-list', kind: 'field-equals', field: 'work_in_shop_gbp', equals: 378.19, why: '182.99 + 145.50 + 49.70' };
    const right = () => ok([{ work_in_shop_gbp: 378.19 }]);
    const wrong = () => ok([{ work_in_shop_gbp: 164.44 }]); // parts only, again
    expect((await run(ctxFor(files, { 'jobs-list': right }, tables), checks(shopTotal))).ok).toBe(true);
    expect((await run(ctxFor(files, { 'jobs-list': wrong }, tables), checks(shopTotal))).ok).toBe(false);
  });

  it('field-min still selects a row with match, so a floor is not stuck on items[0] either', async () => {
    const c = { id: 'allez-positive', endpoint: 'jobs-list', kind: 'field-min', match: { field: 'bike_name', value: 'Allez' }, field: 'total_gbp', min: 100, why: 'labour alone is 112.50' };
    expect((await run(ctxFor(files, { 'jobs-list': labourPlusParts }, tables), checks(c))).ok).toBe(true);
    expect((await run(ctxFor(files, { 'jobs-list': partsOnly }, tables), checks(c))).ok).toBe(false);
  });
});

/**
 * THE SEAM — the contract between `07b-plan_acceptance` (which emits checks) and this node (which
 * evaluates them).
 *
 * A check emitted in a shape the host cannot evaluate is WORSE than no check: the pre-change node
 * `skipped++` anything it did not recognise and still returned `ok: true`, so a typo'd `kind` or a
 * `field-min` with no `min` read to every downstream node as a story that had been verified. The
 * contract is now explicit, validated before anything is CALLED, and a violation resumes the planner.
 */
describe('build_live_project acceptance — the planner↔host contract', () => {
  const files = { 'api/jobs-list/GET.ts': endpointFile('jobs-list', 'jobs') };
  const rows = { jobs: [{ id: 'j1' }, { id: 'j2' }] };
  const handlers = { 'jobs-list': () => ok([{ id: 'j1', total_gbp: 70.49 }]) };
  const evaluate = (check: unknown) => run(ctxFor(files, handlers, rows), checks(check));

  const malformedCases: Array<[string, unknown, RegExp]> = [
    ['an unknown kind', { id: 'a', endpoint: 'jobs-list', kind: 'field-equal', field: 'total_gbp', equals: 1 }, /unknown kind/],
    ['no endpoint', { id: 'b', kind: 'rows-min', min: 1 }, /no `endpoint`/],
    ['field-equals with no equals', { id: 'c', endpoint: 'jobs-list', kind: 'field-equals', field: 'total_gbp' }, /needs a numeric `equals`/],
    ['field-equals with a string equals', { id: 'd', endpoint: 'jobs-list', kind: 'field-equals', field: 'total_gbp', equals: '182.99' }, /needs a numeric `equals`/],
    ['a field check with no field', { id: 'e', endpoint: 'jobs-list', kind: 'field-min', min: 1 }, /needs a `field`/],
    ['field-min with no min', { id: 'f', endpoint: 'jobs-list', kind: 'field-min', field: 'total_gbp' }, /needs a numeric `min`/],
    ['a vacuous field-min floor of 0', { id: 'g', endpoint: 'jobs-list', kind: 'field-min', field: 'total_gbp', min: 0 }, /proves nothing/],
    ['a vacuous rows-min floor of 0', { id: 'h', endpoint: 'jobs-list', kind: 'rows-min', min: 0 }, /proves nothing/],
    ['a half-written match', { id: 'i', endpoint: 'jobs-list', kind: 'field-equals', field: 'total_gbp', equals: 1, match: { field: 'bike_name' } }, /`match.value`/],
    ['a match on rows-min', { id: 'j', endpoint: 'jobs-list', kind: 'rows-min', min: 1, match: { field: 'x', value: 'y' } }, /meaningless on rows-min/],
  ];

  it.each(malformedCases)('rejects %s LOUDLY instead of skipping it', async (_label, check, reason) => {
    const r = await evaluate(check);
    expect(r.malformedCount).toBe(1);
    expect(r.malformed[0]!.reason).toMatch(reason);
    // The two things that make it more than a log line:
    expect(r.ok, 'a gate that could not run a check must not report clean').toBe(false);
    expect(r.skipped, 'silently skipping is exactly what made this invisible').toBe(0);
    // ...and it is NOT sent to the per-file fixer — a planner fault is not a handler fault.
    expect(r.offending).toEqual([]);
    expect(r.dataGaps).toEqual([]);
  });

  it('rejects an AMBIGUOUS row selector — it cannot address the row it claims to check', async () => {
    const twoAllez = { 'jobs-list': () => ok([{ bike_name: 'Allez', total_gbp: 1 }, { bike_name: 'Allez', total_gbp: 2 }]) };
    const r = await run(
      ctxFor(files, twoAllez, rows),
      checks({ id: 'ambig', endpoint: 'jobs-list', kind: 'field-equals', match: { field: 'bike_name', value: 'Allez' }, field: 'total_gbp', equals: 182.99 }),
    );
    expect(r.ok).toBe(false);
    expect(r.malformed[0]!.reason).toContain('selected 2 rows');
    expect(r.offending).toEqual([]);
  });

  it('resumes the PLANNER (not the fixer) on a malformed check, carrying the reasons', () => {
    // The only node that can repair a badly-shaped check is the one that wrote it. `resumeSet` here is
    // exactly {plan_acceptance, check_acceptance} — nothing else depends on plan_acceptance — so no
    // written artifact is redone.
    expect(node.onFail).toBeDefined();
    expect(node.onFail!.goto).toBe('plan_acceptance');
    expect(node.onFail!.carry).toBe('malformed');
    // Scoped to the malformed case ONLY: a genuine FAILED check is a CODE fault and must reach the
    // per-file `fix` fork through verify.offending, never bounce back to the planner (which would
    // "fix" a real defect by loosening the check).
    expect(node.onFail!.when).toBe('check_acceptance.malformedCount > 0');
    expect(node.output['malformedCount']).toBe('number');
  });

  it('a malformed reason is actionable — it names the shape to re-emit', async () => {
    const r = await evaluate({ id: 'x', endpoint: 'jobs-list', kind: 'floor', min: 3 });
    expect(r.malformed[0]!.message).toContain('NOT run');
    expect(r.malformed[0]!.message).toContain('field-equals');
    expect(r.malformed[0]!.check).toBe('x');
    expect(r.malformed[0]!.endpoint).toBe('jobs-list');
  });

  it('one malformed check does not stop the others from being evaluated', async () => {
    const r = await run(ctxFor(files, handlers, rows), checks(
      { id: 'good', endpoint: 'jobs-list', kind: 'rows-min', min: 1, why: 'the brief lists jobs' },
      { id: 'bad', endpoint: 'jobs-list', kind: 'nonsense' },
    ));
    expect(r.checked).toBe(2);
    expect(r.malformedCount).toBe(1);
    expect(r.ok).toBe(false);
  });
});

/**
 * The prompt half of the same contract. The node can only evaluate what the planner emits, so the
 * rule that produces an arithmetic check has to be IN the planner's prompt — and every key it
 * documents has to be one the node actually reads.
 */
describe('build_live_project acceptance — 07b-plan_acceptance states the arithmetic rule', () => {
  const dir = fileURLToPath(new URL('../../system-spaces/system-appbuilder/tasklists/build_live_project/', import.meta.url));
  const prompt = () => readFileSync(`${dir}07b-plan_acceptance.md`, 'utf8');
  const hostNode = () => readFileSync(`${dir}13a-check_acceptance.ts`, 'utf8');

  it('mandates a check carrying the WORKED-OUT value for every number the brief states', () => {
    const p = prompt();
    expect(p).toMatch(/field-equals/);
    expect(p, 'the rule must be unconditional, not a suggestion').toMatch(/if the source states a number, something here must check it/i);
    // The bike-shop arithmetic, worked out, as the example the model copies.
    expect(p).toMatch(/182\.99/);
    expect(p).toMatch(/70\.49/);
    expect(p).toMatch(/45/);
  });

  it('answers the three excuses run 202 used to omit the check', () => {
    const p = prompt().replace(/\s+/g, ' ');
    expect(p, 'ordering → match').toMatch(/Row ORDER is never a reason to skip a check/i);
    expect(p, 'param route → check the list endpoint').toMatch(/\[param\].{0,10}route and I don't know the seeded id.{0,120}LIST endpoint/i);
    expect(p, 'exactness is safe when the brief defines the arithmetic').toMatch(/not when the brief DEFINES the arithmetic/i);
  });

  it('keeps the floor rules for figures the source only approximates', () => {
    const p = prompt();
    expect(p).toMatch(/field-min/);
    expect(p).toMatch(/only approximates|approximate/i);
    expect(p, 'a zero balance is still not a bug').toMatch(/legitimately zero/i);
    expect(p, 'still only checks an endpoint a page renders').toMatch(/Check ONLY an endpoint a page RENDERS/);
  });

  it('documents the exact contract the host node validates — and no key it cannot read', () => {
    const p = prompt();
    const src = hostNode();
    // Every kind the prompt offers is a kind the node knows...
    for (const kind of ['rows-min', 'field-min', 'field-equals']) {
      expect(p, `the prompt must offer ${kind}`).toContain(`\`${kind}\``);
      expect(src, `the node must accept ${kind}`).toContain(`'${kind}'`);
    }
    // ...and every key the prompt's emit template shows is one the Check interface declares.
    for (const key of ['endpoint', 'kind', 'field', 'match', 'equals', 'tolerance', 'min', 'why', 'input', 'story', 'id']) {
      expect(p, `the emit template must show ${key}`).toMatch(new RegExp(`\\b${key}[?]?:`));
      expect(src, `Check must declare ${key}`).toMatch(new RegExp(`^\\s{2}${key}\\?:`, 'm'));
    }
    // The prompt must TELL the planner a bad shape fails rather than passing quietly.
    expect(p).toMatch(/malformed/);
    expect(p).toMatch(/never silently skipped|fails the build/i);
  });

  it('the re-run section repairs the SHAPE — it does not drop the check to quieten the gate', () => {
    const p = prompt();
    const tail = p.slice(p.indexOf('## If you are being RE-RUN'));
    expect(tail).toMatch(/could not EVALUATE/i);
    expect(tail).toMatch(/re-emit those checks in a shape the gate can run/i);
    expect(tail).toMatch(/never drop an arithmetic check to make the gate quiet/i);
  });

  it('agrees with 05-plan_endpoints without duplicating it — design states it, this verifies it', () => {
    // The DESIGN side already carries the matching rule ("a total the brief defines arithmetically
    // must compute every term of it"). The two must not drift: both are anchored to the same defect.
    const design = readFileSync(`${dir}05-plan_endpoints.md`, 'utf8');
    expect(design).toMatch(/every term of it/i);
    expect(design).toMatch(/70\.49/);
    // ...and the fixer is told which of the two acceptance sub-cases it is looking at.
    const fix = readFileSync(`${dir}17-fix.md`, 'utf8').replace(/\s+/g, ' ');
    expect(fix).toMatch(/phase: 'acceptance'/);
    expect(fix).toMatch(/dropped a TERM/i);
    expect(fix).toMatch(/Do not adjust the number to match; compute it/i);
  });

  it('finalize reports an unproven check as missing — it never ships as covered', () => {
    const finalize = readFileSync(`${dir}18-finalize.md`, 'utf8');
    expect(finalize).toMatch(/check_acceptance\?\.malformed/);
    expect(finalize).toMatch(/kind: 'unproven'/);
    // `missing.length === 0` is already part of finalize's `ok`, so an unproven check fails the build.
    expect(finalize).toMatch(/missing\.length === 0/);
  });
});
