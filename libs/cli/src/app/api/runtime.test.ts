/**
 * {@link createApiRuntime} — the main-process api runtime (worker-isolated
 * handlers). Exercises, against a scratch project + a **real** `openProjectDb`:
 *
 *   - method routing + path-param merge (`api/items/[id]/GET.ts` → `:id` in input)
 *   - db proxy actually executes main-side (`feedList` reads / `markRead` writes)
 *   - worker CRASH isolation — a `throw` and a `process.exit(1)` each map to a
 *     generic 500, the real message never leaks, and the next request still works
 *   - `HttpError(404, …)` → 404 `{ error: { status, message, details } }`
 *   - `spawn` returns a `runId`; a dead-run `spawnRunner` fires `onError`
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { LoadedTable } from '@lmthing/core';

import { openProjectDb, schemaToCreateTableSql, type ProjectDb } from '../store.js';
import { createApiRuntime, type ApiRuntime, type SpawnRunner } from './runtime.js';

const tmpDirs: string[] = [];
const dbs: ProjectDb[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lm-api-rt-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const d of dbs) d.close();
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

// ── Schemas ───────────────────────────────────────────────────────────────────
const FEED_ITEMS = {
  title: 'Feed items',
  description: 'One personalized item in the feed.',
  columns: {
    id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
    title: { type: 'string', description: 'headline', required: true },
    score: { type: 'number', description: 'rank', default: 0 },
    read: { type: 'boolean', description: 'opened?', default: false },
  },
} as const;

const RUNS = {
  title: 'Runs',
  description: 'A pending background run row a handler may fail-close.',
  columns: {
    id: { type: 'string', description: 'unique id', primaryKey: true, generated: 'uuid' },
    status: { type: 'string', description: 'pending|failed', required: true },
  },
} as const;

const SCHEMAS: LoadedTable[] = [
  { name: 'feed_items', schema: FEED_ITEMS as unknown as LoadedTable['schema'] },
  { name: 'runs', schema: RUNS as unknown as LoadedTable['schema'] },
];

// ── Handlers (authored as strings, written to the scratch api/ tree) ──────────
const HANDLERS: Record<string, string> = {
  'feed-list/GET.ts': `
export const name = 'feedList'
export const description = 'List feed items.'
export default async function handler(input, ctx) {
  const items = await ctx.db.query('feed_items', {})
  return { items }
}
`,
  'mark-read/POST.ts': `
export const name = 'markRead'
export const description = 'Mark an item read.'
export default async function handler(input, ctx) {
  const n = await ctx.db.update('feed_items', { where: { id: input.id }, set: { read: true } })
  return { ok: n > 0 }
}
`,
  'items/[id]/GET.ts': `
export const name = 'getItem'
export const description = 'Echo the path param.'
export default async function handler(input, ctx) {
  return { id: input.id }
}
`,
  'boom/POST.ts': `
export const name = 'boom'
export const description = 'Throws a non-HttpError.'
export default async function handler() {
  throw new Error('SECRET internal detail that must never leak')
}
`,
  'crash/POST.ts': `
export const name = 'crash'
export const description = 'Hard-exits the worker.'
export default async function handler() {
  process.exit(1)
}
`,
  'gone/GET.ts': `
import { HttpError } from '@app/runtime'
export const name = 'gone'
export const description = 'Throws a mapped HttpError.'
export default async function handler() {
  throw new HttpError(404, 'item gone', { hint: 'try again' })
}
`,
  'refresh/POST.ts': `
export const name = 'refresh'
export const description = 'Insert a pending run, spawn, fail-close on dead run.'
export default async function handler(input, ctx) {
  const inserted = await ctx.db.insert('runs', [{ status: 'pending' }])
  const row = inserted[0]
  const { runId } = await ctx.spawn('curation/curator#refresh', { rowId: row.id, dead: input.dead }, {
    onError: async () => {
      await ctx.db.update('runs', { where: { id: row.id }, set: { status: 'failed' } })
    },
  })
  return { runId, rowId: row.id }
}
`,
};

interface Harness {
  runtime: ApiRuntime;
  project: ProjectDb;
  spawnCalls: Array<{ ref: string; input: unknown }>;
}

async function makeHarness(): Promise<Harness> {
  const root = await scratch();
  for (const [rel, src] of Object.entries(HANDLERS)) {
    const abs = join(root, 'api', rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, src, 'utf8');
  }

  const project = openProjectDb(join(root, '.data', 'app.db'), { schemas: SCHEMAS });
  dbs.push(project);
  for (const { name, schema } of SCHEMAS) project.raw.exec(schemaToCreateTableSql(name, schema));

  let counter = 0;
  const spawnCalls: Harness['spawnCalls'] = [];
  const spawnRunner: SpawnRunner = (ref, input, onError) => {
    spawnCalls.push({ ref, input });
    const runId = `run-${++counter}`;
    // A "dead" run reports failure synchronously — P3's supported onError path.
    if (input && typeof input === 'object' && (input as { dead?: unknown }).dead) {
      onError?.(new Error('dead run'));
    }
    return { runId };
  };

  const runtime = createApiRuntime({
    projectRoot: root,
    db: project.async,
    spawnRunner,
    logError: () => {}, // silence the expected 500 logs
  });
  return { runtime, project, spawnCalls };
}

describe('createApiRuntime — routing, db proxy, path params', () => {
  it('merges a path param into the handler input', async () => {
    const { runtime } = await makeHarness();
    const res = await runtime.handle('GET', '/items/my.v2.item');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'my.v2.item' });
  });

  it('db proxy reads (feedList) and writes (markRead) execute main-side', async () => {
    const { runtime, project } = await makeHarness();
    const seeded = project.db.insert('feed_items', { title: 'hello' }) as { id: string };

    const list = await runtime.handle('GET', '/feed-list');
    expect(list.status).toBe(200);
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);

    const marked = await runtime.handle('POST', '/mark-read', { id: seeded.id });
    expect(marked.body).toEqual({ ok: true });

    // The write landed in the main-process db.
    const [row] = project.db.query('feed_items', { where: { id: seeded.id } }) as Array<{ read: boolean }>;
    expect(row.read).toBe(true);
  });

  it('callByName routes the agent-facing path', async () => {
    const { runtime, project } = await makeHarness();
    project.db.insert('feed_items', { title: 'a' });
    const res = await runtime.callByName('feedList');
    expect((res.body as { items: unknown[] }).items).toHaveLength(1);
  });
});

describe('createApiRuntime — error contract', () => {
  it('maps HttpError(404, …) to a 404 error body with details', async () => {
    const { runtime } = await makeHarness();
    const res = await runtime.handle('GET', '/gone');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { status: 404, message: 'item gone', details: { hint: 'try again' } } });
  });

  it('unmatched route → 404', async () => {
    const { runtime } = await makeHarness();
    const res = await runtime.handle('GET', '/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('createApiRuntime — worker crash isolation', () => {
  it('a thrown non-HttpError → generic 500, real message NOT leaked, next request still works', async () => {
    const { runtime } = await makeHarness();
    const boom = await runtime.handle('POST', '/boom');
    expect(boom.status).toBe(500);
    expect(boom.body).toEqual({ error: { status: 500, message: 'internal error' } });
    expect(JSON.stringify(boom.body)).not.toContain('SECRET');

    // The main process survived — a subsequent request is served normally.
    const ok = await runtime.handle('GET', '/items/abc');
    expect(ok.body).toEqual({ id: 'abc' });
  });

  it('a handler that process.exit(1)s the worker → 500, main survives', async () => {
    const { runtime } = await makeHarness();
    const crashed = await runtime.handle('POST', '/crash');
    expect(crashed.status).toBe(500);
    expect(crashed.body).toEqual({ error: { status: 500, message: 'internal error' } });

    const ok = await runtime.handle('GET', '/items/xyz');
    expect(ok.body).toEqual({ id: 'xyz' });
  });
});

describe('createApiRuntime — spawn fire-and-forget', () => {
  it('returns a runId and does NOT fail-close a healthy run', async () => {
    const { runtime, project, spawnCalls } = await makeHarness();
    const res = await runtime.handle('POST', '/refresh', { dead: false });
    const body = res.body as { runId: string; rowId: string };
    expect(body.runId).toMatch(/^run-\d+$/);
    expect(spawnCalls[0]?.ref).toBe('curation/curator#refresh');

    const [row] = project.db.query('runs', { where: { id: body.rowId } }) as Array<{ status: string }>;
    expect(row.status).toBe('pending');
  });

  it('a dead run fires onError, which fail-closes the pending row (main-side db write)', async () => {
    const { runtime, project } = await makeHarness();
    const res = await runtime.handle('POST', '/refresh', { dead: true });
    const body = res.body as { runId: string; rowId: string };
    expect(body.runId).toMatch(/^run-\d+$/);

    const [row] = project.db.query('runs', { where: { id: body.rowId } }) as Array<{ status: string }>;
    expect(row.status).toBe('failed');
  });
});
