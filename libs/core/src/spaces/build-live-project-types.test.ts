import { describe, it, expect, beforeAll } from 'vitest';

/**
 * The two contract-type code nodes of `build_live_project`, driven against a mocked ctx:
 *
 *  - `09-emit_types.ts` writes `types/contract.d.ts` from the validated plan BEFORE any
 *    implementation node runs. The fault it exists to kill was measured live: `plan_endpoints`
 *    declares `fields` as "the SINGLE SOURCE OF TRUTH for the response shape", and
 *    `implement_pages` is told to read exactly those keys — but nothing compared the two, so the
 *    plan's names only ever existed as prose in a fork's scope and a page could ship reading a
 *    key no handler emitted.
 *  - `11-reconcile_tables.ts` re-emits it from the schema that actually LANDED.
 *    `writeProjectTable` MERGES and can never drop a column
 *    (`libs/cli/src/app/authoring/globals.ts#mergeWithExistingTable`), so `database/*.json` and
 *    `plan_tables.tables` legitimately disagree after `implement_tables` — and types emitted from
 *    the plan would be a lie exactly when `implement_endpoints`/`implement_pages` compile against
 *    them.
 *
 * Both are HOST-RUN code nodes with NO salvage path: a throw fails the node and aborts the whole
 * tasklist, so every finding must come back as DATA. Both are checked for that here.
 */

type EmitResult = {
  ok: boolean;
  written: boolean;
  path: string;
  dts: string;
  tableCount: number;
  endpointCount: number;
  componentCount: number;
  endpointNames: string[];
  error: string;
};

type ReconcileResult = {
  ok: boolean;
  written: boolean;
  path: string;
  dts: string;
  missing: string[];
  missingCount: number;
  drift: Array<{ table: string; kind: string; columns?: string[]; detail?: string }>;
  driftCount: number;
  landed: string[];
  error: string;
};

// The nodes live outside libs/core's tsconfig `include: ["src"]`, so they are reached by a
// computed dynamic import rather than a static one.
let emit: (ctx: unknown, inputs: Record<string, unknown>) => Promise<EmitResult>;
let reconcile: (ctx: unknown, inputs: Record<string, unknown>) => Promise<ReconcileResult>;
let emitNode: { id: string; dependsOn: string[]; output: Record<string, string> };
let reconcileNode: { id: string; dependsOn: string[]; output: Record<string, string> };

const nodeUrl = (file: string): string =>
  new URL(`../../system-spaces/system-appbuilder/tasklists/build_live_project/${file}`, import.meta.url).href;

beforeAll(async () => {
  const a = (await import(nodeUrl('09-emit_types.ts'))) as { run: typeof emit; node: typeof emitNode };
  const b = (await import(nodeUrl('11-reconcile_tables.ts'))) as { run: typeof reconcile; node: typeof reconcileNode };
  emit = a.run;
  emitNode = a.node;
  reconcile = b.run;
  reconcileNode = b.node;
});

// ── fixtures ────────────────────────────────────────────────────────────────

/** A `plan_tables.tables[]` entry — `{ name, schema: { title, description, columns }, rows }`. */
const table = (name: string, columns: Record<string, { type: string; primaryKey?: boolean; required?: boolean }>) => ({
  name,
  schema: {
    title: name,
    description: `The ${name} table`,
    columns: Object.fromEntries(
      Object.entries(columns).map(([c, spec]) => [c, { description: `the ${c}`, ...spec }]),
    ),
  },
  rows: [],
});

const TRIPS = table('trips', {
  id: { type: 'string', primaryKey: true },
  title: { type: 'string' },
  starts_on: { type: 'date' },
});

const COSTS = table('cost_lines', {
  id: { type: 'string', primaryKey: true },
  amount_usd: { type: 'number' },
  meta: { type: 'json' },
});

/** A `plan_endpoints.endpoints[]` entry — `{ name, route, purpose, tables, fields }`. */
const ENDPOINTS = [
  {
    name: 'cost-lines',
    route: 'cost-lines/GET',
    purpose: 'Every cost line',
    tables: ['cost_lines'],
    fields: ['id: string', 'amount_usd: number'],
  },
  {
    name: 'trips-detail',
    route: 'trips/[id]/GET',
    purpose: 'One trip',
    tables: ['trips'],
    fields: ['id: string', 'title: string'],
  },
];

/** A `plan_components.components[]` entry — `{ name, purpose, props }`. */
const COMPONENTS = [{ name: 'TripCard', purpose: 'One trip, on several pages', props: ['title: string', 'nights: number'] }];

const CONTRACT = { plan_tables: { tables: [TRIPS, COSTS] }, plan_endpoints: { endpoints: ENDPOINTS }, plan_components: { components: COMPONENTS } };

/** A ctx that records what was written. `writeProjectFile` is the writer the nodes probe for. */
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

/** A landed `database/<name>.json` — what `writeProjectTable` actually left on disk. */
const landedSchema = (t: typeof TRIPS, extra?: Record<string, { type: string; description: string }>) =>
  JSON.stringify({ ...t.schema, columns: { ...t.schema.columns, ...(extra ?? {}) } });

// ── 09-emit_types ───────────────────────────────────────────────────────────

describe('build_live_project — emit_types (09-emit_types.ts)', () => {
  it('declares a node that runs after the contract is validated and can see the plan', () => {
    expect(emitNode.id).toBe('emit_types');
    // The plan nodes must be DIRECT dependencies: `orchestrator.ts#getUpstreamOutputs` iterates
    // `dependsOn` and not the transitive closure, and `validate_contract` resolves only
    // `{ ok, errorCount, errors }` — so without them `inputs` carries no contract at all.
    expect(emitNode.dependsOn).toContain('validate_contract');
    expect(emitNode.dependsOn).toEqual(expect.arrayContaining(['plan_tables', 'plan_endpoints', 'plan_components']));
    // A scalar `ok` + counts: the condition DSL's `getAtPath` returns `undefined` for arrays, so
    // `emit_types.endpointNames.length > 0` is not expressible in a `when:`.
    expect(emitNode.output['ok']).toBe('boolean');
  });

  it('emits row / endpoint / component types, and lands them at types/contract.d.ts', async () => {
    const { ctx, written } = writerCtx();
    const r = await emit(ctx, CONTRACT);

    expect(r.ok).toBe(true);
    expect(r.written).toBe(true);
    // NOT types/generated.d.ts: that is a build artifact `generateAppTypes` rewrites from the code
    // that landed, on every build — a contract written there is erased by the first build.
    expect(r.path).toBe('types/contract.d.ts');
    expect(written['types/contract.d.ts']).toBe(r.dts);
    expect(r.tableCount).toBe(2);
    expect(r.endpointCount).toBe(2);
    expect(r.componentCount).toBe(1);

    // One row interface per table, columns typed from the contract (`date` → ISO string,
    // `json` → opaque `unknown`, mirroring `schema.ts#COLUMN_TS`).
    expect(r.dts).toContain('export interface TripsRow {');
    expect(r.dts).toContain('  id: string;'); // primary key ⇒ non-optional
    expect(r.dts).toContain('  starts_on?: string;'); // date ⇒ ISO string, optional
    expect(r.dts).toContain('export interface CostLinesRow {');
    expect(r.dts).toContain('  meta?: unknown;'); // json ⇒ opaque

    // One input/output pair per endpoint, keyed on the plan's EXACT `fields` strings.
    expect(r.dts).toContain('export interface CostLinesItem {');
    expect(r.dts).toContain('  amount_usd: number;');
    expect(r.dts).toContain('export interface CostLinesOutput { items: CostLinesItem[]; }');
    // A `[id]` route's param is a declared input — the value the verify gate flags when omitted.
    expect(r.dts).toContain('export interface TripsDetailInput {');
    expect(r.dts).toContain('  id: string;');
    // A route with no params takes no declared params.
    expect(r.dts).toContain('export type CostLinesInput = Record<string, unknown>;');

    // One props interface per shared component.
    expect(r.dts).toContain('export interface TripCardProps {');
    expect(r.dts).toContain('  nights: number;');

    // It must never point project source at `@app/types` — that specifier is hard-mapped to
    // `types/generated.d.ts` by `typecheck.ts#createProgramHost`.
    expect(r.dts).toContain("from '../types/contract'");
  });

  it('emits the endpoint-name union from the plan, verbatim', async () => {
    const { ctx } = writerCtx();
    const r = await emit(ctx, CONTRACT);
    const union = /export type EndpointName =\n([\s\S]*?);/.exec(r.dts);
    expect(union).not.toBeNull();
    // The exact strings `useApi`/`useApiMutation`/`apiCall` take and each handler's
    // `export const name` — hyphens intact, never re-derived or re-cased.
    expect(union![1]!.match(/'[^']+'/g)).toEqual(["'cost-lines'", "'trips-detail'"]);
    expect(r.endpointNames).toEqual(['cost-lines', 'trips-detail']);
  });

  it('degrades to unknown for a field type it cannot verify, and never pastes plan prose into the file', async () => {
    const { ctx } = writerCtx();
    const r = await emit(ctx, {
      plan_endpoints: {
        endpoints: [
          {
            name: 'odd',
            route: 'odd/GET',
            purpose: 'a */ terminator and a { brace }',
            fields: ['tags: string[]', 'blob: SomeMadeUpType', 'bare', 'weird-key: number'],
          },
        ],
      },
    });
    expect(r.dts).toContain('  tags: string[];');
    expect(r.dts).toContain('  blob: unknown;'); // an unrecognised name is never emitted verbatim
    expect(r.dts).toContain('  bare: unknown;');
    expect(r.dts).toContain("  'weird-key': number;"); // not a bare identifier ⇒ quoted
    // The purpose lands in a JSDoc line with its comment terminator broken.
    expect(r.dts).not.toContain('a */ terminator');
  });

  it('emits a file the TypeScript compiler actually parses', async () => {
    // The whole point is that implementation code is checked AGAINST this file. A `.d.ts` with a
    // syntax error would surface as a compiler error in every page that imports it, blamed on the
    // page — so the emitter's output is parsed here for real.
    const ts = await import('typescript');
    const { ctx } = writerCtx();
    const r = await emit(ctx, CONTRACT);
    const source = ts.createSourceFile('contract.d.ts', r.dts, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
    // `parseDiagnostics` is internal but stable, and is the only way to see syntax errors from a
    // standalone `createSourceFile`.
    const syntax = (source as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics ?? [];
    expect(syntax).toEqual([]);
  });

  it('reports a missing writer as DATA rather than throwing', async () => {
    // A code node has no salvage path — a throw aborts the whole tasklist. `ProjectAuthoringGlobals`
    // currently exposes no free-form writer, so this is the live path until one is wired.
    const r = await emit({}, CONTRACT);
    expect(r.ok).toBe(false);
    expect(r.written).toBe(false);
    expect(r.error).toContain('writeProjectFile');
    expect(r.dts).toContain('export interface TripsRow {'); // the text is still carried downstream
  });

  it('never throws — not on an empty contract, a writer fault, or a malformed one', async () => {
    await expect(emit(writerCtx().ctx, {})).resolves.toMatchObject({ tableCount: 0, endpointCount: 0 });

    const thrower = {
      writeProjectFile: () => {
        throw new Error('disk full');
      },
    };
    const r = await emit(thrower, CONTRACT);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('disk full');

    // A contract whose lists are the wrong SHAPE (bare names, nulls) is ignored, not guessed at.
    const junk = await emit(writerCtx().ctx, { plan_tables: { tables: ['trips', null] }, plan_endpoints: { endpoints: 'nope' } });
    expect(junk.tableCount).toBe(0);
    expect(junk.dts).toContain('export type EndpointName = never;');
  });
});

// ── 11-reconcile_tables ─────────────────────────────────────────────────────

describe('build_live_project — reconcile_tables (11-reconcile_tables.ts)', () => {
  it('declares a node that runs after the tables land and can see the plan', () => {
    expect(reconcileNode.id).toBe('reconcile_tables');
    expect(reconcileNode.dependsOn).toContain('implement_tables');
    expect(reconcileNode.dependsOn).toContain('plan_tables');
    expect(reconcileNode.output['ok']).toBe('boolean');
    expect(reconcileNode.output['missingCount']).toBe('number'); // scalar twin of the array
  });

  it('re-emits the types from the LANDED schema, resolving ok when every table is there', async () => {
    const { ctx, written } = writerCtx({
      'database/trips.json': landedSchema(TRIPS),
      'database/cost_lines.json': landedSchema(COSTS),
    });
    const r = await reconcile(ctx, { ...CONTRACT, implement_tables: [{ name: 'trips', ok: true }, { name: 'cost_lines', ok: true }] });

    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.landed.sort()).toEqual(['cost_lines', 'trips']);
    expect(written['types/contract.d.ts']).toBe(r.dts);
    expect(r.dts).toContain('export interface TripsRow {');
    // The endpoint + component sections survive the re-emit.
    expect(r.dts).toContain('export interface CostLinesOutput { items: CostLinesItem[]; }');
    expect(r.dts).toContain('export interface TripCardProps {');
  });

  it('reconciles an EXTRA landed column silently — types follow disk, and ok stays true', async () => {
    // `writeProjectTable` MERGES and can never DROP a declared column, because the live table
    // cannot drop one either (`reconcileTable` only ever ADDs). A column that is on disk but not
    // in the plan is the writer working as designed, not a fault.
    const { ctx } = writerCtx({
      'database/trips.json': landedSchema(TRIPS, { booking_ref: { type: 'string', description: 'the booking reference' } }),
      'database/cost_lines.json': landedSchema(COSTS),
    });
    const r = await reconcile(ctx, CONTRACT);

    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.dts).toContain('  booking_ref?: string;'); // the contract now describes what exists
    expect(r.drift).toContainEqual({ table: 'trips', kind: 'extra-columns', columns: ['booking_ref'] });
    expect(r.driftCount).toBe(1);
  });

  it('resolves ok:false and NAMES a table that never landed', async () => {
    // Every endpoint planned against a missing table passes the compiler (the db surface is
    // dynamically typed) and 500s at runtime — so this is the one thing that fails.
    const { ctx } = writerCtx({ 'database/trips.json': landedSchema(TRIPS) });
    const r = await reconcile(ctx, CONTRACT);

    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['cost_lines']);
    expect(r.missingCount).toBe(1);
    // The types still describe reality — the row type of the table that IS there.
    expect(r.dts).toContain('export interface TripsRow {');
    expect(r.dts).not.toContain('export interface CostLinesRow {');
  });

  it('types a table that landed under a name the plan never had', async () => {
    // `implement_tables` may correct a name at write time (e.g. a kebab-case name the writer
    // rejects). The name that LANDED is what downstream endpoints wire to.
    const { ctx } = writerCtx({
      'database/trips.json': landedSchema(TRIPS),
      'database/cost_lines.json': landedSchema(COSTS),
      'database/receipts.json': landedSchema(table('receipts', { id: { type: 'string', primaryKey: true } })),
    });
    const r = await reconcile(ctx, CONTRACT);
    expect(r.ok).toBe(true);
    expect(r.dts).toContain('export interface ReceiptsRow {');
    expect(r.drift).toContainEqual({ table: 'receipts', kind: 'unplanned-table' });
  });

  it('keeps the endpoint/component sections when its inputs no longer carry them', async () => {
    // Guards a re-emit from DELETING working declarations if the wiring ever changes: the worst
    // case must be a stale section, never a missing one.
    const priorTypes = (await emit(writerCtx().ctx, CONTRACT)).dts;
    const { ctx } = writerCtx({
      'database/trips.json': landedSchema(TRIPS),
      'database/cost_lines.json': landedSchema(COSTS),
      'types/contract.d.ts': priorTypes,
    });
    const r = await reconcile(ctx, { plan_tables: { tables: [TRIPS, COSTS] } });

    expect(r.ok).toBe(true);
    expect(r.dts).toContain('export interface CostLinesOutput { items: CostLinesItem[]; }');
    expect(r.dts).toContain("| 'trips-detail'");
    expect(r.dts).toContain('export interface TripCardProps {');
  });

  it('never throws — not on a corrupt schema file, an empty database/, or a writer fault', async () => {
    const { ctx } = writerCtx({ 'database/trips.json': '{ not json', 'database/cost_lines.json': landedSchema(COSTS) });
    const corrupt = await reconcile(ctx, CONTRACT);
    expect(corrupt.ok).toBe(true); // the table EXISTS — a corrupt declaration is not a missing table
    expect(corrupt.drift.some((d) => d.kind === 'unreadable-schema')).toBe(true);
    expect(corrupt.dts).toContain('export interface TripsRow {');

    const empty = await reconcile(writerCtx().ctx, CONTRACT);
    expect(empty.ok).toBe(false);
    expect(empty.missing).toEqual(['trips', 'cost_lines']);

    const thrower = {
      ...writerCtx({ 'database/trips.json': landedSchema(TRIPS), 'database/cost_lines.json': landedSchema(COSTS) }).ctx,
      writeProjectFile: () => {
        throw new Error('disk full');
      },
    };
    const failed = await reconcile(thrower, CONTRACT);
    expect(failed.ok).toBe(true); // a write fault is not a MISSING TABLE — `ok` means exactly one thing
    expect(failed.written).toBe(false);
    expect(failed.error).toContain('disk full');
  });

  it('works against an async ctx — every authoring global is an rpc stub inside the worker', async () => {
    // `worker-load-entry.ts` proxies each authoring global as `(...a) => rpc('authoring', …)`, so
    // `listProjectDir`/`readProjectFile`/`writeProjectFile` return PROMISES at run time even
    // though the same functions are synchronous in-process.
    const base = writerCtx({ 'database/trips.json': landedSchema(TRIPS), 'database/cost_lines.json': landedSchema(COSTS) });
    const asyncCtx = {
      writeProjectFile: async (p: string, c: string) => base.ctx.writeProjectFile(p, c),
      listProjectDir: async (d: string) => base.ctx.listProjectDir(d),
      readProjectFile: async (p: string) => base.ctx.readProjectFile(p),
    };
    const r = await reconcile(asyncCtx, CONTRACT);
    expect(r.ok).toBe(true);
    expect(r.dts).toContain('export interface TripsRow {');
    expect(base.written['types/contract.d.ts']).toBe(r.dts);
  });
});
