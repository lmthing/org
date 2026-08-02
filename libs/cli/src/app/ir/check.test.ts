/**
 * {@link checkGeneratedIr} — the `check()` leg of compile/generate/check (§7). Proves the hard-error
 * contract against a REAL scratch project on disk: a matching generated pair is clean, a missing
 * generated file is flagged, and — the acceptance criterion itself — a HAND-EDITED generated file
 * (table schema or handler) is caught and named, with a message pointing back at the IR source.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { compileEntity, type EntityIr } from './entity.js';
import { generateQueryHandler, type QueryIr } from './query.js';
import { checkGeneratedIr, serializeTableSchema } from './check.js';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lm-ir-check-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

const JOB_IR: EntityIr = {
  entity: 'job',
  title: 'Job',
  identity: 'id',
  fields: {
    id: { fact: 'job.id', type: 'id' },
    status: { fact: 'job.status', type: 'enum', values: ['quoted', 'done'] },
    hours: { fact: 'job.hours', type: 'number' },
  },
};

const JOBS_LIST_IR: QueryIr = {
  name: 'jobs-list',
  kind: 'list',
  entity: 'job',
  route: 'jobs/list',
};

/** Write a project laid out exactly as the writers would: `.entity.json`/`.query.json` alongside
 *  their freshly compiled/generated counterparts. */
async function writeInSyncProject(root: string): Promise<void> {
  await mkdir(join(root, 'model'), { recursive: true });
  await writeFile(join(root, 'model', 'job.entity.json'), JSON.stringify(JOB_IR, null, 2) + '\n', 'utf8');
  const { schema } = compileEntity(JOB_IR);
  await mkdir(join(root, 'database'), { recursive: true });
  await writeFile(join(root, 'database', 'job.json'), serializeTableSchema(schema), 'utf8');

  await mkdir(join(root, 'api'), { recursive: true });
  await writeFile(join(root, 'api', 'jobs-list.query.json'), JSON.stringify(JOBS_LIST_IR, null, 2) + '\n', 'utf8');
  const tables = new Map([['job', schema]]);
  const { source, apiRoute } = generateQueryHandler(JOBS_LIST_IR, tables);
  const handlerPath = join(root, 'api', ...apiRoute.split('/'));
  await mkdir(join(handlerPath, '..'), { recursive: true });
  await writeFile(handlerPath + '.ts', source, 'utf8');
}

describe('checkGeneratedIr', () => {
  it('reports clean when every generated artifact matches its IR', async () => {
    const root = await scratch();
    await writeInSyncProject(root);
    const res = await checkGeneratedIr(root);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('flags a MISSING generated table (entity.json with no database/*.json yet)', async () => {
    const root = await scratch();
    await mkdir(join(root, 'model'), { recursive: true });
    await writeFile(join(root, 'model', 'job.entity.json'), JSON.stringify(JOB_IR, null, 2) + '\n', 'utf8');

    const res = await checkGeneratedIr(root);
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual([
      expect.objectContaining({ kind: 'entity', reason: 'missing', generated: 'database/job.json' }),
    ]);
  });

  it('flags a HAND-EDITED generated table schema — the acceptance criterion', async () => {
    const root = await scratch();
    await writeInSyncProject(root);
    // Simulate a hand-edit: someone added a column directly to the generated table file.
    await writeFile(
      join(root, 'database', 'job.json'),
      JSON.stringify({ title: 'Job', description: 'Job', columns: { id: { type: 'string', description: 'id', primaryKey: true } } }, null, 2) + '\n',
      'utf8',
    );

    const res = await checkGeneratedIr(root);
    expect(res.ok).toBe(false);
    const err = res.errors.find((e) => e.kind === 'entity');
    expect(err?.reason).toBe('mismatch');
    expect(err?.message).toMatch(/hand-edited/);
    expect(err?.source).toBe('model/job.entity.json');
  });

  it('flags a HAND-EDITED generated handler — the query-side acceptance criterion', async () => {
    const root = await scratch();
    await writeInSyncProject(root);
    // Simulate a hand-edit: someone touched the generated handler directly.
    await writeFile(join(root, 'api', 'jobs', 'list', 'GET.ts'), 'export const name = "tampered";\n', 'utf8');

    const res = await checkGeneratedIr(root);
    expect(res.ok).toBe(false);
    const err = res.errors.find((e) => e.kind === 'query');
    expect(err?.reason).toBe('mismatch');
    expect(err?.message).toMatch(/hand-edited/);
    expect(err?.source).toBe('api/jobs-list.query.json');
    expect(err?.generated).toBe('api/jobs/list/GET.ts');
  });

  it('flags a MISSING generated handler (query.json with no handler yet)', async () => {
    const root = await scratch();
    await mkdir(join(root, 'model'), { recursive: true });
    await writeFile(join(root, 'model', 'job.entity.json'), JSON.stringify(JOB_IR, null, 2) + '\n', 'utf8');
    const { schema } = compileEntity(JOB_IR);
    await mkdir(join(root, 'database'), { recursive: true });
    await writeFile(join(root, 'database', 'job.json'), serializeTableSchema(schema), 'utf8');
    await mkdir(join(root, 'api'), { recursive: true });
    await writeFile(join(root, 'api', 'jobs-list.query.json'), JSON.stringify(JOBS_LIST_IR, null, 2) + '\n', 'utf8');

    const res = await checkGeneratedIr(root);
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual([
      expect.objectContaining({ kind: 'query', reason: 'missing', generated: 'api/jobs/list/GET.ts' }),
    ]);
  });

  it('reports an INVALID entity IR (a cross-entity fact-registry collision) rather than crashing', async () => {
    const root = await scratch();
    await mkdir(join(root, 'model'), { recursive: true });
    // Two entities sharing the SAME fact key on different fields. Entities are checked in
    // alphabetical order ("invoice" before "job"), so "invoice" claims the fact first and "job"
    // (processed second) is the one flagged for reusing it on a different entity/field.
    const dup: EntityIr = { entity: 'invoice', title: 'Invoice', identity: 'id', fields: { id: { fact: 'invoice.id', type: 'id' }, state: { fact: 'job.status', type: 'enum', values: ['x'] } } };
    await writeFile(join(root, 'model', 'invoice.entity.json'), JSON.stringify(dup, null, 2) + '\n', 'utf8');
    await writeFile(join(root, 'model', 'job.entity.json'), JSON.stringify(JOB_IR, null, 2) + '\n', 'utf8');
    const { schema: invoiceSchema } = compileEntity(dup);
    await mkdir(join(root, 'database'), { recursive: true });
    await writeFile(join(root, 'database', 'invoice.json'), serializeTableSchema(invoiceSchema), 'utf8');

    const res = await checkGeneratedIr(root);
    expect(res.ok).toBe(false);
    const err = res.errors.find((e) => e.source === 'model/job.entity.json');
    expect(err?.reason).toBe('invalid');
    expect(err?.message).toMatch(/previously declared on invoice\.state/);
  });
});
