/**
 * Phase 10 — store distribution: `GET /api/apps` (catalog listing) and
 * `POST /api/apps/install` (materialize + boot + build a catalog app).
 *
 * Uses a REAL tmp `catalogRoot` (one `demo/` app: database/pages/api) and a
 * REAL tmp `lmthingRoot`, driving the handlers directly with faked req/res
 * objects (mirrors `app-admin.test.ts`). The install path boots a real SQLite
 * db via `bootProjectApp` (through a manager stub) and runs the real
 * contracts/pages builds (best-effort — a failure there must never fail the
 * install itself).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleListApps, handleInstallApp, type AppsInstallManager } from './apps.js';
import { bootProjectApp } from '../../app/boot.js';

// ── Mock req/res (mirrors app-admin.test.ts) ──────────────────────────────────

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

// ── Fixtures ───────────────────────────────────────────────────────────────

const APP = 'demo';

const DEMO_PAGE = `export default function Index() { return null; }\n`;

const DEMO_API = `
export const name = 'list'
export const description = 'List items.'
export interface Output { items: unknown[] }
export default async function handler(): Promise<Output> {
  return { items: [] }
}
`;

async function writeDemoApp(root: string): Promise<void> {
  const appRoot = join(root, APP);
  await mkdir(join(appRoot, 'database'), { recursive: true });
  await writeFile(
    join(appRoot, 'database', 'items.json'),
    JSON.stringify({
      description: 'The items',
      columns: {
        id: { type: 'string', primaryKey: true, description: 'The id' },
        title: { type: 'string', description: 'The title' },
      },
    }),
    'utf8',
  );
  await mkdir(join(appRoot, 'pages'), { recursive: true });
  await writeFile(join(appRoot, 'pages', 'index.tsx'), DEMO_PAGE, 'utf8');
  await mkdir(join(appRoot, 'api', 'list'), { recursive: true });
  await writeFile(join(appRoot, 'api', 'list', 'GET.ts'), DEMO_API, 'utf8');
  await writeFile(
    join(appRoot, 'package.json'),
    JSON.stringify({ name: '@app/demo', private: true, type: 'module', version: '0.0.0' }),
    'utf8',
  );
  await writeFile(
    join(appRoot, 'project.json'),
    JSON.stringify({
      id: APP,
      title: 'Demo App',
      description: 'A demo catalog app',
      createdAt: new Date().toISOString(),
    }),
    'utf8',
  );
  // Junk under `.data/`/`types/` in the SOURCE — these must never be copied to
  // the runtime dest (they're the runtime/generated dirs, excluded by design).
  await mkdir(join(appRoot, '.data'), { recursive: true });
  await writeFile(join(appRoot, '.data', 'junk.txt'), 'not a template file\n', 'utf8');
  await mkdir(join(appRoot, 'types'), { recursive: true });
  await writeFile(join(appRoot, 'types', 'junk.d.ts'), '// stray\n', 'utf8');
}

let catalogRoot: string;
let lmthingRoot: string;

const manager: AppsInstallManager = {
  getProjectDb: async (root, projectId) => bootProjectApp(join(root, projectId)),
};

beforeAll(async () => {
  catalogRoot = await mkdtemp(join(tmpdir(), 'lm-apps-catalog-'));
  lmthingRoot = await mkdtemp(join(tmpdir(), 'lm-apps-root-'));
  await writeDemoApp(catalogRoot);
});

afterAll(async () => {
  await rm(catalogRoot, { recursive: true, force: true });
  await rm(lmthingRoot, { recursive: true, force: true });
});

// ── GET /api/apps ────────────────────────────────────────────────────────────

describe('handleListApps', () => {
  it('lists the demo app with derived tables/pages/endpoints/hooks', async () => {
    const { res, captured } = mockRes();
    await handleListApps(catalogRoot)(mockReq(), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as { apps: Array<Record<string, unknown>> };
    expect(body.apps).toHaveLength(1);
    const demo = body.apps[0]!;
    expect(demo.id).toBe('demo');
    expect(demo.title).toBe('Demo App');
    expect(demo.description).toBe('A demo catalog app');
    expect(demo.tables).toEqual(['items']);
    expect(demo.pages).toEqual(['/']);
    expect(demo.endpoints).toEqual(['GET /list']);
    expect(demo.hooks).toEqual([]);
  });

  it('tolerates a missing catalog root', async () => {
    const { res, captured } = mockRes();
    const missing = join(tmpdir(), `lm-apps-does-not-exist-${Date.now()}`);
    await handleListApps(missing)(mockReq(), res, {});
    expect(captured.status).toBe(200);
    expect(captured.body).toEqual({ apps: [] });
  });
});

// ── POST /api/apps/install ───────────────────────────────────────────────────

describe('handleInstallApp', () => {
  it('404s for a non-existent appId', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, catalogRoot);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: 'nope' }) }), res, {});
    expect(captured.status).toBe(404);
  });

  it('refuses a path-traversal appId', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, catalogRoot);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: '../x' }) }), res, {});
    expect(captured.status).toBe(400);
  });

  it('refuses the reserved "system" appId', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, catalogRoot);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: 'system' }) }), res, {});
    expect(captured.status).toBe(400);
  });

  it('installs, boots, and best-effort builds a fresh app', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, catalogRoot);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: APP }) }), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as {
      ok: boolean;
      projectId: string;
      appId: string;
      installed: { tables: string[]; pages: string[]; endpoints: string[]; hooks: string[] };
      built: { contracts: { ok: boolean }; pages: { ok: boolean } };
    };
    expect(body.ok).toBe(true);
    expect(body.projectId).toBe(APP);
    expect(body.installed.tables).toEqual(['items']);
    expect(body.installed.pages).toEqual(['/']);
    expect(body.installed.endpoints).toEqual(['GET /list']);
    expect(body.installed.hooks).toEqual([]);

    const dest = join(lmthingRoot, APP);
    expect(existsSync(join(dest, 'database', 'items.json'))).toBe(true);
    expect(existsSync(join(dest, 'pages', 'index.tsx'))).toBe(true);
    expect(existsSync(join(dest, 'api', 'list', 'GET.ts'))).toBe(true);
    expect(existsSync(join(dest, 'package.json'))).toBe(true);

    // Never copied from the source's `.data/`/`types/`.
    expect(existsSync(join(dest, '.data', 'junk.txt'))).toBe(false);
    expect(existsSync(join(dest, 'types', 'junk.d.ts'))).toBe(false);

    // Boot ran: a sqlite db (or its DR dump) exists.
    const dbExists = existsSync(join(dest, '.data', 'app.db'));
    const sqlExists = existsSync(join(dest, '.data', 'app.sql'));
    expect(dbExists || sqlExists).toBe(true);
  }, 30_000);

  it('re-installing an unedited (pristine) copy re-syncs ok, no divergence', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, catalogRoot);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: APP }) }), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; diverged?: boolean };
    expect(body.ok).toBe(true);
    expect(body.diverged).toBeUndefined();
  }, 30_000);

  it('holds back an edited copy with diverged:true, preserving the edit', async () => {
    const dest = join(lmthingRoot, APP);
    await writeFile(join(dest, 'pages', 'index.tsx'), 'export default function Index() { return "edited"; }\n', 'utf8');

    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, catalogRoot);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: APP }) }), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; diverged?: boolean };
    expect(body.ok).toBe(false);
    expect(body.diverged).toBe(true);

    const content = await readFile(join(dest, 'pages', 'index.tsx'), 'utf8');
    expect(content).toContain('edited');
  });

  it('force:true overwrites a diverged copy', async () => {
    const dest = join(lmthingRoot, APP);
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, catalogRoot);
    await handler(
      mockReq({ method: 'POST', body: JSON.stringify({ appId: APP, force: true }) }),
      res,
      {},
    );
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean };
    expect(body.ok).toBe(true);

    const content = await readFile(join(dest, 'pages', 'index.tsx'), 'utf8');
    expect(content).not.toContain('edited');
  }, 30_000);

  it('installs into a custom projectId distinct from appId', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, catalogRoot);
    await handler(
      mockReq({ method: 'POST', body: JSON.stringify({ appId: APP, projectId: 'my-demo' }) }),
      res,
      {},
    );
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; projectId: string };
    expect(body.ok).toBe(true);
    expect(body.projectId).toBe('my-demo');
    expect(existsSync(join(lmthingRoot, 'my-demo', 'database', 'items.json'))).toBe(true);
  }, 30_000);
});
