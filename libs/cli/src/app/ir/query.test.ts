/**
 * {@link validateQueryIr} / {@link generateQueryHandler} — the declarative query IR (W7 / §7).
 *
 * Three layers, cheapest-first:
 *   1. validation — every IR-shape mistake reports a retryable, actionable message (mirrors
 *      `writeProjectApi`'s write-time lint contract).
 *   2. generation — the emitted source PARSES and TYPECHECKS as a self-contained handler (no
 *      dependency on `ApiCtx`/`types/contract.d.ts`), for every kind.
 *   3. **execution** — the generated handler is written into a real project alongside a real
 *      `openProjectDb`, loaded through the actual `createApiRuntime`, and invoked exactly like the
 *      browser would: this is the layer that would have caught both host bugs the live run found
 *      (route precedence, envelope unwrapping), so a compute/list/aggregate/toggle round-trip against
 *      REAL rows is the strongest proof this compiler is correct, not just well-typed.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { transformSync } from 'esbuild';
import ts from 'typescript';

import type { LoadedTable, TableSchema } from '@lmthing/core';
import { openProjectDb, schemaToCreateTableSql, type ProjectDb } from '../store.js';
import { createApiRuntime, type ApiRuntime, type SpawnRunner } from '../api/runtime.js';
import { compilerOptions } from '../build/typecheck.js';
import { validateQueryIr, generateQueryHandler, type QueryIr } from './query.js';

// ── Fixture tables ────────────────────────────────────────────────────────────

const JOB: TableSchema = {
  title: 'Job',
  description: 'A repair job.',
  columns: {
    id: { type: 'string', description: 'id', primaryKey: true, generated: 'uuid' },
    status: { type: 'string', description: 'status', required: true },
    hours: { type: 'number', description: 'labour hours', default: 0 },
    collected: { type: 'boolean', description: 'picked up?', default: false },
    createdAt: { type: 'date', description: 'created', generated: 'now' },
  },
  relations: { parts: { hasMany: 'part', via: 'jobId', description: 'parts fitted' } },
};

const PART: TableSchema = {
  title: 'Part',
  description: 'A part fitted to a job.',
  columns: {
    id: { type: 'string', description: 'id', primaryKey: true, generated: 'uuid' },
    jobId: { type: 'string', description: 'owning job', required: true },
    priceMinor: { type: 'number', description: 'price (minor units)', required: true },
  },
};

const TABLES = new Map<string, TableSchema>([
  ['job', JOB],
  ['part', PART],
]);

// ── Validation ────────────────────────────────────────────────────────────────

describe('validateQueryIr', () => {
  it('accepts a well-formed list IR', () => {
    const ir: QueryIr = {
      name: 'jobs-list',
      kind: 'list',
      entity: 'job',
      route: 'jobs/list',
      where: [{ field: 'status', op: 'in', input: 'status', default: ['quoted', 'in-progress'] }],
      order: [{ field: 'createdAt', dir: 'desc' }],
      limit: { input: 'limit', default: 50, max: 200 },
    };
    const res = validateQueryIr(ir, TABLES);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('rejects an unknown entity with the real table list', () => {
    const res = validateQueryIr({ name: 'x', kind: 'list', entity: 'nope', route: 'x' }, TABLES);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/no table "nope"/);
    expect(res.errors.join(' ')).toMatch(/job, part/);
  });

  it('rejects an unknown where/order column, naming the real columns', () => {
    const res = validateQueryIr(
      { name: 'x', kind: 'list', entity: 'job', route: 'x', where: [{ field: 'stat', op: '=', value: 'a' }] },
      TABLES,
    );
    expect(res.errors.join(' ')).toMatch(/no column "stat" on "job"/);
    expect(res.errors.join(' ')).toMatch(/status/); // the real column is named in the suggestion set
  });

  it('rejects an aggregate with no compute block', () => {
    const res = validateQueryIr({ name: 'x', kind: 'aggregate', entity: 'job', route: 'x' }, TABLES);
    expect(res.errors.join(' ')).toMatch(/needs a "compute" block/);
  });

  it('rejects a toggle on a non-boolean column', () => {
    const res = validateQueryIr(
      { name: 'x', kind: 'toggle', entity: 'job', route: 'jobs/[id]/toggle', toggleField: 'hours' },
      TABLES,
    );
    expect(res.errors.join(' ')).toMatch(/must be a boolean column/);
  });

  it('rejects a toggle/update with no [param] and no where', () => {
    const res = validateQueryIr(
      { name: 'x', kind: 'toggle', entity: 'job', route: 'jobs/toggle', toggleField: 'collected' },
      TABLES,
    );
    expect(res.errors.join(' ')).toMatch(/needs a \[param\]/);
  });

  it('rejects a create/update with no set map', () => {
    const res = validateQueryIr({ name: 'x', kind: 'create', entity: 'job', route: 'jobs/create' }, TABLES);
    expect(res.errors.join(' ')).toMatch(/needs a "set" map/);
  });

  it('rejects a set targeting an unknown column', () => {
    const res = validateQueryIr(
      { name: 'x', kind: 'create', entity: 'job', route: 'jobs/create', set: { bogus: { value: 1 } } },
      TABLES,
    );
    expect(res.errors.join(' ')).toMatch(/no column "bogus" on "job"/);
  });

  it('propagates a malformed compute formula error with the field name', () => {
    const res = validateQueryIr(
      {
        name: 'x',
        kind: 'aggregate',
        entity: 'job',
        route: 'x',
        compute: { total: { ref: 'settings.rate' } },
      },
      TABLES,
    );
    expect(res.errors.join(' ')).toMatch(/compute\.total:.*settings/i);
  });

  it('rejects an include of an undeclared relation', () => {
    const res = validateQueryIr(
      { name: 'x', kind: 'list', entity: 'job', route: 'x', include: ['nope'] },
      TABLES,
    );
    expect(res.errors.join(' ')).toMatch(/no relation "nope" on "job"/);
  });
});

// ── Generation: parse + typecheck every kind ─────────────────────────────────

/** Typecheck one generated handler in total isolation — no ambient, no contract.d.ts — proving the
 *  self-containment claim (§ module doc): it must compile on its own terms. */
function typecheckStandalone(source: string): string[] {
  const fileName = '/virtual/handler.ts';
  const host = ts.createCompilerHost(compilerOptions(), true);
  const real = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, ...rest) =>
    fn === fileName ? ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS) : real(fn, ...rest);
  const realRead = host.readFile.bind(host);
  host.readFile = (fn) => (fn === fileName ? source : realRead(fn));
  const realExists = host.fileExists.bind(host);
  host.fileExists = (fn) => fn === fileName || realExists(fn);
  // '@app/runtime' is a bare specifier with no ambient declared here — deliberately: this proves the
  // handler needs NOTHING beyond it. Provide a minimal ambient just for HttpError so toggle/update kinds
  // (which throw it) don't spuriously fail on an unrelated "cannot find module".
  host.resolveModuleNameLiterals = (literals) =>
    literals.map(() => ({ resolvedModule: undefined }));
  const ambientForRuntime = `declare module '@app/runtime' { export class HttpError extends Error { status: number; constructor(status: number, message: string, details?: unknown); } }`;
  const AMBIENT_FILE = '/virtual/ambient.d.ts';
  const realGetSf2 = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, ...rest) => {
    if (fn === AMBIENT_FILE) return ts.createSourceFile(AMBIENT_FILE, ambientForRuntime, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
    return realGetSf2(fn, ...rest);
  };
  const realExists2 = host.fileExists.bind(host);
  host.fileExists = (fn) => fn === AMBIENT_FILE || realExists2(fn);
  const realRead2 = host.readFile.bind(host);
  host.readFile = (fn) => (fn === AMBIENT_FILE ? ambientForRuntime : realRead2(fn));

  const program = ts.createProgram({ rootNames: [fileName, AMBIENT_FILE], options: compilerOptions(), host });
  const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === fileName);
  return diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

function assertParses(source: string): void {
  expect(() => transformSync(source, { loader: 'ts', format: 'esm', logLevel: 'silent' })).not.toThrow();
}

describe('generateQueryHandler — parses + typechecks standalone, every kind', () => {
  it('list: filter + order + limit + a computed relation-sum field', () => {
    const ir: QueryIr = {
      name: 'jobs-list',
      kind: 'list',
      entity: 'job',
      route: 'jobs/list',
      where: [{ field: 'status', op: '!=', value: 'done' }],
      order: [{ field: 'createdAt', dir: 'desc' }],
      limit: 50,
      include: ['parts'],
      compute: { partsTotalMinor: { sum: '$parts.priceMinor' } },
    };
    const { source } = generateQueryHandler(ir, TABLES);
    assertParses(source);
    expect(typecheckStandalone(source)).toEqual([]);
    expect(source).toContain(generateQueryHandlerBanner(ir.name));
  });

  it('get: [id] param resolves via the primary key', () => {
    const ir: QueryIr = { name: 'job-detail', kind: 'get', entity: 'job', route: 'jobs/[id]' };
    const { source } = generateQueryHandler(ir, TABLES);
    assertParses(source);
    expect(typecheckStandalone(source)).toEqual([]);
  });

  it('aggregate: multi-key compute with cross-key reference', () => {
    const ir: QueryIr = {
      name: 'dashboard-stats',
      kind: 'aggregate',
      entity: 'job',
      route: 'jobs/dashboard-stats',
      compute: {
        totalCount: { count: '' },
        openCount: { count: '' }, // simplistic, just proves multi-key emission
      },
    };
    const { source } = generateQueryHandler(ir, TABLES);
    assertParses(source);
    expect(typecheckStandalone(source)).toEqual([]);
  });

  it('create: inserts declared columns from input', () => {
    const ir: QueryIr = {
      name: 'job-create',
      kind: 'create',
      entity: 'job',
      route: 'jobs/create',
      set: { status: { input: 'status' } },
    };
    const { source } = generateQueryHandler(ir, TABLES);
    assertParses(source);
    expect(typecheckStandalone(source)).toEqual([]);
  });

  it('update: [id] param + set map', () => {
    const ir: QueryIr = {
      name: 'job-update',
      kind: 'update',
      entity: 'job',
      route: 'jobs/[id]',
      set: { status: { input: 'status' } },
    };
    const { source } = generateQueryHandler(ir, TABLES);
    assertParses(source);
    expect(typecheckStandalone(source)).toEqual([]);
  });

  it('toggle: flips the declared boolean field', () => {
    const ir: QueryIr = {
      name: 'job-toggle-collected',
      kind: 'toggle',
      entity: 'job',
      route: 'jobs/[id]/toggle-collected',
      toggleField: 'collected',
    };
    const { source } = generateQueryHandler(ir, TABLES);
    assertParses(source);
    expect(typecheckStandalone(source)).toEqual([]);
  });
});

function generateQueryHandlerBanner(name: string): string {
  return `@generated from api/${name}.query.json`;
}

// ── End-to-end: generated handlers actually EXECUTE against a real db ───────

const tmpDirs: string[] = [];
const dbs: ProjectDb[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lm-query-ir-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const d of dbs) d.close();
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

const SCHEMAS: LoadedTable[] = [
  { name: 'job', schema: JOB },
  { name: 'part', schema: PART },
];

const noopSpawnRunner: SpawnRunner = () => ({ runId: 'unused' });

async function runtimeFor(root: string): Promise<{ runtime: ApiRuntime; project: ProjectDb }> {
  const project = openProjectDb(join(root, '.data', 'app.db'), { schemas: SCHEMAS });
  dbs.push(project);
  for (const { name, schema } of SCHEMAS) project.raw.exec(schemaToCreateTableSql(name, schema));
  const runtime = createApiRuntime({
    projectRoot: root,
    db: project.async,
    spawnRunner: noopSpawnRunner,
    logError: () => {},
  });
  return { runtime, project };
}

async function writeHandler(root: string, ir: QueryIr): Promise<void> {
  const { source, apiRoute } = generateQueryHandler(ir, TABLES);
  const abs = join(root, 'api', apiRoute + '.ts');
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, source, 'utf8');
}

describe('generateQueryHandler — end-to-end execution against a real project db', () => {
  it('list with where/order/limit and a relation-sum compute field returns real rows', async () => {
    const root = await scratch();
    const ir: QueryIr = {
      name: 'jobs-list',
      kind: 'list',
      entity: 'job',
      route: 'jobs/list',
      where: [{ field: 'status', op: 'in', input: 'status', default: ['quoted', 'in-progress'] }],
      order: [{ field: 'hours', dir: 'desc' }],
      include: ['parts'],
      compute: { partsTotalMinor: { sum: '$parts.priceMinor' } },
    };
    await writeHandler(root, ir);
    const { runtime, project } = await runtimeFor(root);

    const j1 = project.db.insert('job', { status: 'quoted', hours: 3 }) as { id: string };
    const j2 = project.db.insert('job', { status: 'in-progress', hours: 5 }) as { id: string };
    project.db.insert('job', { status: 'done', hours: 1 }); // excluded by where
    project.db.insert('part', { jobId: j1.id, priceMinor: 1000 });
    project.db.insert('part', { jobId: j1.id, priceMinor: 500 });
    project.db.insert('part', { jobId: j2.id, priceMinor: 2000 });

    const res = await runtime.handle('GET', '/jobs/list');
    expect(res.status).toBe(200);
    const items = (res.body as { items: Array<{ id: string; partsTotalMinor: number }> }).items;
    expect(items).toHaveLength(2);
    // ordered by hours desc: j2 (5h) before j1 (3h)
    expect(items[0].id).toBe(j2.id);
    expect(items[0].partsTotalMinor).toBe(2000);
    expect(items[1].id).toBe(j1.id);
    expect(items[1].partsTotalMinor).toBe(1500);
  });

  it('get by [id] returns exactly one row, envelope-wrapped', async () => {
    const root = await scratch();
    await writeHandler(root, { name: 'job-detail', kind: 'get', entity: 'job', route: 'jobs/[id]' });
    const { runtime, project } = await runtimeFor(root);
    const j = project.db.insert('job', { status: 'quoted', hours: 2 }) as { id: string };

    const res = await runtime.handle('GET', `/jobs/${j.id}`);
    expect(res.status).toBe(200);
    const items = (res.body as { items: Array<{ id: string }> }).items;
    expect(items).toEqual([expect.objectContaining({ id: j.id })]);
  });

  it('aggregate produces one summary object over the full set — the dashboard-stats shape', async () => {
    const root = await scratch();
    await writeHandler(root, {
      name: 'dashboard-stats',
      kind: 'aggregate',
      entity: 'job',
      route: 'jobs/dashboard-stats',
      compute: {
        totalCount: { count: '' },
        totalHours: { sum: '$hours' },
      },
    });
    const { runtime, project } = await runtimeFor(root);
    project.db.insert('job', { status: 'quoted', hours: 3 });
    project.db.insert('job', { status: 'done', hours: 5 });

    const res = await runtime.handle('GET', '/jobs/dashboard-stats');
    expect(res.status).toBe(200);
    const [summary] = (res.body as { items: Array<{ totalCount: number; totalHours: number }> }).items;
    expect(summary).toEqual({ totalCount: 2, totalHours: 8 });
  });

  it('toggle flips the field and returns the new state — never a no-op', async () => {
    const root = await scratch();
    await writeHandler(root, {
      name: 'job-toggle-collected',
      kind: 'toggle',
      entity: 'job',
      route: 'jobs/[id]/toggle-collected',
      toggleField: 'collected',
    });
    const { runtime, project } = await runtimeFor(root);
    const j = project.db.insert('job', { status: 'quoted', hours: 1, collected: false }) as { id: string; collected: boolean };

    const first = await runtime.handle('PATCH', `/jobs/${j.id}/toggle-collected`);
    expect((first.body as { items: Array<{ collected: boolean }> }).items[0].collected).toBe(true);
    const [row1] = project.db.query('job', { where: { id: j.id } }) as Array<{ collected: boolean }>;
    expect(row1.collected).toBe(true);

    const second = await runtime.handle('PATCH', `/jobs/${j.id}/toggle-collected`);
    expect((second.body as { items: Array<{ collected: boolean }> }).items[0].collected).toBe(false);
  });

  it('create inserts exactly the declared columns and returns the created row', async () => {
    const root = await scratch();
    await writeHandler(root, {
      name: 'job-create',
      kind: 'create',
      entity: 'job',
      route: 'jobs/create',
      set: { status: { input: 'status' } },
    });
    const { runtime, project } = await runtimeFor(root);

    const res = await runtime.handle('POST', '/jobs/create', { status: 'quoted' });
    expect(res.status).toBe(200);
    const [item] = (res.body as { items: Array<{ id: string; status: string }> }).items;
    expect(item.status).toBe('quoted');
    const [row] = project.db.query('job', { where: { id: item.id } }) as Array<{ status: string }>;
    expect(row.status).toBe('quoted');
  });

  it('update writes the set map and 404s via HttpError for a missing row', async () => {
    const root = await scratch();
    await writeHandler(root, {
      name: 'job-update',
      kind: 'update',
      entity: 'job',
      route: 'jobs/[id]',
      set: { status: { input: 'status' } },
    });
    const { runtime, project } = await runtimeFor(root);
    const j = project.db.insert('job', { status: 'quoted', hours: 1 }) as { id: string };

    const res = await runtime.handle('PATCH', `/jobs/${j.id}`, { status: 'in-progress' });
    expect(res.status).toBe(200);
    expect((res.body as { items: Array<{ status: string }> }).items[0].status).toBe('in-progress');

    const missing = await runtime.handle('PATCH', '/jobs/does-not-exist', { status: 'x' });
    expect(missing.status).toBe(404);
  });
});
