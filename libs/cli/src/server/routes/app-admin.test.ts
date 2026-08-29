/**
 * Phase 8A — admin/dev app-management routes (manifest, app-file R/W, data browser,
 * build status/rebuild). Uses a REAL tmp project on disk for the fs-driven handlers
 * (manifest, app-file writes, build status) and a MOCK manager for the db-backed
 * ones (data browser) so no better-sqlite3 boot is needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  handleAppManifest,
  handleGetAppFile,
  handlePutAppFile,
  handleListRows,
  handleUpdateRow,
  handleBuildStatus,
  type AppAdminManager,
} from './app-admin.js';
import type { ProjectDb } from '../../app/store.js';
import type { EndpointContract } from '../../app/build/schema.js';

// ── Mock req/res ──────────────────────────────────────────────────────────────

function mockReq(opts: { url?: string; method?: string; body?: string } = {}): IncomingMessage {
  const body = opts.body ?? '';
  const req = {
    url: opts.url ?? '/',
    method: opts.method ?? 'GET',
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(body, 'utf8');
    },
  };
  return req as unknown as IncomingMessage;
}

interface Captured {
  status: number;
  body: unknown;
}

function mockRes(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, body: undefined };
  const res = {
    writeHead(status: number) {
      captured.status = status;
      return this;
    },
    end(chunk?: string) {
      if (chunk) captured.body = JSON.parse(chunk);
    },
  };
  return { res: res as unknown as ServerResponse, captured };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

let root: string;
const APP = 'appA';
const SPACES_ONLY = 'spacesOnly';
const SPEC_APP = 'specApp';
const MIGRATED_APP = 'migratedApp';

const ENDPOINTS: EndpointContract[] = [
  {
    name: 'hello',
    method: 'GET',
    routePath: '/hello',
    description: 'say hello',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
    inputTsType: '{}',
    outputTsType: '{ msg: string }',
  },
];

// Mutable rows behind the mock ProjectDb (data-browser tests).
const rows: Array<Record<string, unknown>> = [
  { id: '1', title: 'first', done: false },
  { id: '2', title: 'second', done: false },
];

const fakeDb = {
  listTables: () => ['items'],
  db: {
    query: (_t: string, opts: { limit?: number; offset?: number } = {}) =>
      rows.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? rows.length)),
    update: (_t: string, o: { where: Record<string, unknown>; set: Record<string, unknown> }) => {
      const r = rows.find((x) => x.id === o.where.id);
      if (!r) return 0;
      Object.assign(r, o.set);
      return 1;
    },
  },
} as unknown as ProjectDb;

const manager: AppAdminManager = {
  getProjectDb: async () => fakeDb,
  getProjectContracts: async () => ({ endpoints: ENDPOINTS }),
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'app-admin-'));
  const appRoot = join(root, APP);

  // database/items.json — a valid single-PK table.
  await mkdir(join(appRoot, 'database'), { recursive: true });
  await writeFile(
    join(appRoot, 'database', 'items.json'),
    JSON.stringify({
      description: 'The items',
      columns: {
        id: { type: 'string', primaryKey: true, description: 'The id' },
        title: { type: 'string', required: true, description: 'The title' },
        done: { type: 'boolean', description: 'Done flag' },
      },
    }),
    'utf8',
  );

  // pages/ — one route (never built → stale).
  await mkdir(join(appRoot, 'pages'), { recursive: true });
  await writeFile(join(appRoot, 'pages', 'index.tsx'), 'export default () => null;\n', 'utf8');

  // api/ — presence flips hasApi; contracts come from the mock manager.
  await mkdir(join(appRoot, 'api', 'hello'), { recursive: true });
  await writeFile(
    join(appRoot, 'api', 'hello', 'GET.ts'),
    `export const name = 'hello';\nexport interface Output { msg: string }\nexport default async () => ({ msg: 'hi' });\n`,
    'utf8',
  );

  // hooks/ — one cron hook.
  await mkdir(join(appRoot, 'hooks'), { recursive: true });
  await writeFile(
    join(appRoot, 'hooks', 'daily.ts'),
    `export default { type: 'cron', every: '30m', trigger: 'news/fetcher#refresh' };\n`,
    'utf8',
  );

  // A spaces-only project (no app dirs).
  await mkdir(join(root, SPACES_ONLY, 'spaces'), { recursive: true });

  // A SPEC (viewbuilder) app: pages are `views/*.view.json`, NOT `pages/*.tsx`, and the generated
  // wrappers are gone — so `hasPages` is false and the routes come from `views/` alone.
  const specRoot = join(root, SPEC_APP);
  await mkdir(join(specRoot, 'views', 'trips'), { recursive: true });
  await mkdir(join(specRoot, 'views', 'settings'), { recursive: true });
  const view = (title: string) => JSON.stringify({ title, sections: [] });
  await writeFile(join(specRoot, 'views', 'index.view.json'), view('Home'), 'utf8');
  await writeFile(join(specRoot, 'views', 'trips.view.json'), view('Trips'), 'utf8');
  await writeFile(join(specRoot, 'views', 'settings', 'profile.view.json'), view('Profile'), 'utf8');
  // A DYNAMIC page — served as `/trips/:tripId`, still listed in the manifest (the sidebar is
  // what filters non-linkable routes, not the pod).
  await writeFile(join(specRoot, 'views', 'trips', '[tripId].view.json'), view('Trip'), 'utf8');

  // A MIGRATED app: a `views/` spec app that ALSO kept its generated `pages/` wrappers (one per
  // view) from before the builder became spec-only. Both describe the SAME routes.
  const migratedRoot = join(root, MIGRATED_APP);
  await mkdir(join(migratedRoot, 'views'), { recursive: true });
  await mkdir(join(migratedRoot, 'pages'), { recursive: true });
  await writeFile(join(migratedRoot, 'views', 'index.view.json'), view('Home'), 'utf8');
  await writeFile(join(migratedRoot, 'views', 'contacts.view.json'), view('Contacts'), 'utf8');
  // The generated wrappers for the same two routes.
  await writeFile(join(migratedRoot, 'pages', 'index.tsx'), 'export default () => null;\n', 'utf8');
  await writeFile(join(migratedRoot, 'pages', 'contacts.tsx'), 'export default () => null;\n', 'utf8');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ── 1. Manifest ────────────────────────────────────────────────────────────

describe('handleAppManifest', () => {
  it('assembles tables, pages, endpoints, hooks + build status', async () => {
    const { res, captured } = mockRes();
    await handleAppManifest(manager, root)(mockReq(), res, { projectId: APP });

    expect(captured.status).toBe(200);
    const m = captured.body as {
      hasApp: boolean;
      tables: Array<{ name: string }>;
      pages: Array<{ routePath: string; file: string }>;
      endpoints: Array<{ name: string; method: string; routePath: string; outputSchema: unknown }>;
      hooks: Array<{ slug: string; type?: string; every?: string; trigger?: string; pending?: boolean }>;
      build: { built: boolean; assetCount: number; stale: boolean };
    };

    expect(m.hasApp).toBe(true);
    expect(m.tables.map((t) => t.name)).toContain('items');
    expect(m.pages).toEqual([{ routePath: '/', file: 'pages/index.tsx' }]);
    expect(m.endpoints).toEqual([
      expect.objectContaining({ name: 'hello', method: 'GET', routePath: '/hello' }),
    ]);
    expect(m.hooks).toEqual([
      expect.objectContaining({ slug: 'daily', type: 'cron', every: '30m', trigger: 'news/fetcher#refresh', pending: false }),
    ]);
    // Never built → stale.
    expect(m.build).toEqual({ built: false, assetCount: 0, stale: true });
  });

  // "This app has no API routes" and "we could not read this app's API routes" are different
  // facts, and the manifest used to tell the same lie for both — the catch returned []. An app
  // whose api/ handlers all work then reads as endpoint-less: Studio shows nothing, and a caller
  // concludes the pages fetch nothing (scenario 07 saw exactly this, one run apart from a run
  // that listed six routes).
  it('surfaces a contract-generation failure as endpointsError instead of reporting zero routes', async () => {
    const broken: AppAdminManager = {
      getProjectDb: manager.getProjectDb,
      getProjectContracts: async () => {
        throw new Error('tsc exploded');
      },
    };
    const { res, captured } = mockRes();
    await handleAppManifest(broken, root)(mockReq(), res, { projectId: APP });

    expect(captured.status).toBe(200);
    const m = captured.body as { hasApp: boolean; endpoints: unknown[]; endpointsError?: string };
    expect(m.hasApp).toBe(true);
    expect(m.endpoints).toEqual([]);
    expect(m.endpointsError).toMatch(/tsc exploded/);
  });

  it('omits endpointsError when the contracts generate fine', async () => {
    const { res, captured } = mockRes();
    await handleAppManifest(manager, root)(mockReq(), res, { projectId: APP });
    expect((captured.body as { endpointsError?: string }).endpointsError).toBeUndefined();
  });

  it('reports hasApp:false for a spaces-only project', async () => {
    const { res, captured } = mockRes();
    await handleAppManifest(manager, root)(mockReq(), res, { projectId: SPACES_ONLY });

    expect(captured.status).toBe(200);
    const m = captured.body as {
      hasApp: boolean;
      tables: unknown[];
      pages: unknown[];
      endpoints: unknown[];
      hooks: unknown[];
    };
    expect(m.hasApp).toBe(false);
    expect(m.tables).toEqual([]);
    expect(m.pages).toEqual([]);
    expect(m.endpoints).toEqual([]);
    expect(m.hooks).toEqual([]);
  });

  // A spec (viewbuilder) app has NO `pages/` dir (its pages are `views/*.view.json`, and the
  // generated wrappers were dropped). Its pages must still reach the manifest — otherwise the
  // chat sidebar's APP section is empty for exactly the apps the native renderer can draw.
  it('lists a spec app’s views/ pages at their served routes (hasApp true, no pages/ dir)', async () => {
    const { res, captured } = mockRes();
    await handleAppManifest(manager, root)(mockReq(), res, { projectId: SPEC_APP });

    expect(captured.status).toBe(200);
    const m = captured.body as { hasApp: boolean; pages: Array<{ routePath: string; file: string }> };
    expect(m.hasApp).toBe(true);
    // `index` collapses to `/`, `[tripId]` becomes `:tripId` — the same `viewRoutePath` mapping a
    // legacy `.tsx` page goes through. Sorted by route.
    expect(m.pages).toEqual([
      { routePath: '/', file: 'views/index.view.json' },
      { routePath: '/settings/profile', file: 'views/settings/profile.view.json' },
      { routePath: '/trips', file: 'views/trips.view.json' },
      { routePath: '/trips/:tripId', file: 'views/trips/[tripId].view.json' },
    ]);
  });

  // A migrated app carries a `pages/` wrapper AND a `views/` spec for the same route. Listing both
  // showed every page twice in the chat sidebar (10 rows for 5 pages, on a device). Each route must
  // appear exactly once, and the spec (`views/…`) is the entry that survives — the wrapper is a
  // leftover.
  it('lists a route ONCE when a migrated app has both a pages/ wrapper and a views/ spec', async () => {
    const { res, captured } = mockRes();
    await handleAppManifest(manager, root)(mockReq(), res, { projectId: MIGRATED_APP });

    expect(captured.status).toBe(200);
    const m = captured.body as { hasApp: boolean; pages: Array<{ routePath: string; file: string }> };
    expect(m.hasApp).toBe(true);
    expect(m.pages).toEqual([
      { routePath: '/', file: 'views/index.view.json' },
      { routePath: '/contacts', file: 'views/contacts.view.json' },
    ]);
  });
});

// ── 2. App-file routes ────────────────────────────────────────────────────────

describe('handlePutAppFile / handleGetAppFile', () => {
  it('writes exactly one file and leaves siblings intact', async () => {
    const { res, captured } = mockRes();
    await handlePutAppFile(manager, root)(
      mockReq({ method: 'PUT', body: JSON.stringify({ content: 'export default () => null;\n' }) }),
      res,
      { projectId: APP, rest: 'pages/about.tsx' },
    );
    expect(captured.status).toBe(200);
    expect((captured.body as { ok: boolean }).ok).toBe(true);

    // The new file exists...
    expect(existsSync(join(root, APP, 'pages', 'about.tsx'))).toBe(true);
    // ...and the sibling was NOT bulk-deleted.
    expect(existsSync(join(root, APP, 'pages', 'index.tsx'))).toBe(true);

    // Round-trip via GET.
    const get = mockRes();
    await handleGetAppFile(manager, root)(mockReq(), get.res, { projectId: APP, rest: 'pages/about.tsx' });
    expect(get.captured.status).toBe(200);
    expect((get.captured.body as { content: string }).content).toContain('export default');
  });

  it('refuses a write under .data/ (no file written)', async () => {
    const { res, captured } = mockRes();
    await handlePutAppFile(manager, root)(
      mockReq({ method: 'PUT', body: JSON.stringify({ content: 'x' }) }),
      res,
      { projectId: APP, rest: '.data/hack.json' },
    );
    expect(captured.status).toBeGreaterThanOrEqual(400);
    expect(captured.status).toBeLessThan(500);
    expect(existsSync(join(root, APP, '.data', 'hack.json'))).toBe(false);
  });

  it('refuses a write under types/ (no file written)', async () => {
    const { res, captured } = mockRes();
    await handlePutAppFile(manager, root)(
      mockReq({ method: 'PUT', body: JSON.stringify({ content: 'x' }) }),
      res,
      { projectId: APP, rest: 'types/generated.d.ts' },
    );
    expect(captured.status).toBeGreaterThanOrEqual(400);
    expect(captured.status).toBeLessThan(500);
    expect(existsSync(join(root, APP, 'types', 'generated.d.ts'))).toBe(false);
  });

  it('refuses a `..` traversal (no escape write)', async () => {
    const { res, captured } = mockRes();
    await handlePutAppFile(manager, root)(
      mockReq({ method: 'PUT', body: JSON.stringify({ content: 'x' }) }),
      res,
      { projectId: APP, rest: '../escape.txt' },
    );
    expect(captured.status).toBeGreaterThanOrEqual(400);
    expect(captured.status).toBeLessThan(500);
    expect(existsSync(join(root, 'escape.txt'))).toBe(false);
  });

  it('refuses a disallowed root file', async () => {
    const { res, captured } = mockRes();
    await handlePutAppFile(manager, root)(
      mockReq({ method: 'PUT', body: JSON.stringify({ content: 'x' }) }),
      res,
      { projectId: APP, rest: 'secrets.env' },
    );
    expect(captured.status).toBe(403);
    expect(existsSync(join(root, APP, 'secrets.env'))).toBe(false);
  });

  it('404s a missing app file', async () => {
    const { res, captured } = mockRes();
    await handleGetAppFile(manager, root)(mockReq(), res, { projectId: APP, rest: 'lib/missing.ts' });
    expect(captured.status).toBe(404);
  });
});

// ── 3. Data browser ────────────────────────────────────────────────────────

describe('handleListRows / handleUpdateRow', () => {
  it('lists rows for a real table with paging', async () => {
    const { res, captured } = mockRes();
    await handleListRows(manager, root)(
      mockReq({ url: '/api/projects/appA/app/data/items?limit=1&offset=0' }),
      res,
      { projectId: APP, table: 'items' },
    );
    expect(captured.status).toBe(200);
    const body = captured.body as { table: string; rows: unknown[]; limit: number };
    expect(body.table).toBe('items');
    expect(body.limit).toBe(1);
    expect(body.rows).toHaveLength(1);
  });

  it('404s an unknown table', async () => {
    const { res, captured } = mockRes();
    await handleListRows(manager, root)(mockReq(), res, { projectId: APP, table: 'nope' });
    expect(captured.status).toBe(404);
  });

  it('updates a row (flips a field)', async () => {
    const { res, captured } = mockRes();
    await handleUpdateRow(manager, root)(
      mockReq({ method: 'PATCH', body: JSON.stringify({ done: true }) }),
      res,
      { projectId: APP, table: 'items', id: '1' },
    );
    expect(captured.status).toBe(200);
    expect(captured.body).toEqual({ ok: true, updated: 1 });
    expect(rows.find((r) => r.id === '1')!.done).toBe(true);
  });

  it('404s update on an unknown table', async () => {
    const { res, captured } = mockRes();
    await handleUpdateRow(manager, root)(
      mockReq({ method: 'PATCH', body: JSON.stringify({ done: true }) }),
      res,
      { projectId: APP, table: 'nope', id: '1' },
    );
    expect(captured.status).toBe(404);
  });
});

// ── 4. Build status ────────────────────────────────────────────────────────

describe('handleBuildStatus', () => {
  it('reports an unbuilt page app as stale', async () => {
    const { res, captured } = mockRes();
    await handleBuildStatus(manager, root)(mockReq(), res, { projectId: APP });
    expect(captured.status).toBe(200);
    const b = captured.body as { built: boolean; stale: boolean; assetManifest: string[] };
    expect(b.built).toBe(false);
    expect(b.stale).toBe(true);
    expect(b.assetManifest).toEqual([]);
  });
});

