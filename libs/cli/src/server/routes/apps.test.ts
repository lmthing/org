/**
 * Phase 10 — store distribution: `GET /api/apps` (catalog listing) and
 * `POST /api/apps/install` (download + materialize + boot + build a catalog app).
 *
 * There is NO local catalog in the pod — the catalog lives on the public store at
 * `${STORE_URL}/projects/`. These tests stub `fetch` to serve a fixture "store": a
 * `manifest.json` (with each app's `files` download-list) plus the app's files at
 * `/projects/<id>/<relpath>`. The install path downloads into a staging dir, boots a
 * real SQLite db via `bootProjectApp` (through a manager stub), and runs the real
 * contracts/pages builds (best-effort — a failure there must never fail the install).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
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

// ── Fixture store (served via a stubbed fetch) ────────────────────────────────

const APP = 'demo';
const STORE_URL = 'http://store.test';

const DEMO_PAGE = `export default function Index() { return null; }\n`;
const DEMO_API = `
export const name = 'list'
export const description = 'List items.'
export interface Output { items: unknown[] }
export default async function handler(): Promise<Output> {
  return { items: [] }
}
`;

/** Write the demo app's template files under `<storeDir>/demo/`. */
async function writeDemoApp(storeDir: string): Promise<void> {
  const appRoot = join(storeDir, APP);
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
    JSON.stringify({ id: APP, title: 'Demo App', description: 'A demo catalog app', createdAt: new Date().toISOString() }),
    'utf8',
  );
}

/** Recursively list `<dir>` files, relative + `/`-joined + sorted. */
async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(abs, base)));
    else if (entry.isFile()) out.push(relative(base, abs).split('/').join('/'));
  }
  return out.sort();
}

/** A second app that ships ONLY package.json (no project.json) — mirrors an app
 *  authored by the `system-appbuilder` space. Install must synthesize project.json. */
const NOPROJ = 'noproj';

async function writeNoProjApp(storeDir: string): Promise<void> {
  const appRoot = join(storeDir, NOPROJ);
  await mkdir(join(appRoot, 'database'), { recursive: true });
  await writeFile(
    join(appRoot, 'database', 'items.json'),
    JSON.stringify({
      description: 'The items',
      columns: { id: { type: 'string', primaryKey: true, description: 'The id' } },
    }),
    'utf8',
  );
  await mkdir(join(appRoot, 'pages'), { recursive: true });
  await writeFile(join(appRoot, 'pages', 'index.tsx'), DEMO_PAGE, 'utf8');
  // NOTE: package.json only — deliberately NO project.json.
  await writeFile(
    join(appRoot, 'package.json'),
    JSON.stringify({ name: '@app/noproj', private: true, type: 'module', version: '0.0.0' }),
    'utf8',
  );
}

/** Write `<storeDir>/manifest.json` describing both fixture apps (incl. `files` lists). */
async function writeManifest(storeDir: string): Promise<void> {
  const files = await listFiles(join(storeDir, APP));
  const noprojFiles = await listFiles(join(storeDir, NOPROJ));
  const manifest = {
    apps: [
      {
        id: APP,
        title: 'Demo App',
        description: 'A demo catalog app',
        icon: null,
        tables: ['items'],
        pages: ['index.tsx'],
        endpoints: ['list'],
        hooks: [],
        files,
      },
      {
        id: NOPROJ,
        title: 'No-Project App',
        description: 'An app-builder app with no project.json',
        icon: null,
        tables: ['items'],
        pages: ['index.tsx'],
        endpoints: [],
        hooks: [],
        files: noprojFiles,
      },
    ],
  };
  await writeFile(join(storeDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

/** Stub `fetch` to serve `<storeDir>` at `${STORE_URL}/projects/<relpath>`. */
function stubStoreFetch(storeDir: string): void {
  vi.stubGlobal('fetch', async (url: string | URL): Promise<Response> => {
    const u = new URL(typeof url === 'string' ? url : url.toString());
    const m = /^\/projects\/(.+)$/.exec(u.pathname);
    if (!m) return new Response('not found', { status: 404 });
    const rel = decodeURIComponent(m[1]!);
    const filePath = join(storeDir, rel);
    if (!existsSync(filePath)) return new Response('not found', { status: 404 });
    return new Response(await readFile(filePath), { status: 200 });
  });
}

let storeDir: string;
let lmthingRoot: string;

const manager: AppsInstallManager = {
  getProjectDb: async (root, projectId) => bootProjectApp(join(root, projectId)),
};

beforeAll(async () => {
  storeDir = await mkdtemp(join(tmpdir(), 'lm-store-'));
  lmthingRoot = await mkdtemp(join(tmpdir(), 'lm-apps-root-'));
  await writeDemoApp(storeDir);
  await writeNoProjApp(storeDir);
  await writeManifest(storeDir);
  stubStoreFetch(storeDir);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(storeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(lmthingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ── GET /api/apps ────────────────────────────────────────────────────────────

describe('handleListApps', () => {
  it('lists the demo app from the store manifest', async () => {
    const { res, captured } = mockRes();
    await handleListApps(STORE_URL)(mockReq(), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as { apps: Array<Record<string, unknown>> };
    expect(body.apps.length).toBeGreaterThanOrEqual(1);
    const demo = body.apps.find((a) => a.id === 'demo')!;
    expect(demo.id).toBe('demo');
    expect(demo.title).toBe('Demo App');
    expect(demo.description).toBe('A demo catalog app');
    expect(demo.tables).toEqual(['items']);
  });

  it('tolerates an unreachable store (→ empty list)', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network down'); });
    try {
      const { res, captured } = mockRes();
      await handleListApps(STORE_URL)(mockReq(), res, {});
      expect(captured.status).toBe(200);
      expect(captured.body).toEqual({ apps: [] });
    } finally {
      stubStoreFetch(storeDir); // restore the fixture store for the remaining tests
    }
  });
});

// ── POST /api/apps/install ───────────────────────────────────────────────────

describe('handleInstallApp', () => {
  it('404s for an app not in the store catalog', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: 'nope' }) }), res, {});
    expect(captured.status).toBe(404);
  });

  it('refuses a path-traversal appId', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: '../x' }) }), res, {});
    expect(captured.status).toBe(400);
  });

  it('refuses the reserved "system" appId', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: 'system' }) }), res, {});
    expect(captured.status).toBe(400);
  });

  it('downloads, installs, boots, and best-effort builds a fresh app', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: APP }) }), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as {
      ok: boolean;
      projectId: string;
      installed: { tables: string[]; pages: string[]; endpoints: string[]; hooks: string[] };
    };
    expect(body.ok).toBe(true);
    expect(body.projectId).toBe(APP);
    expect(body.installed.tables).toEqual(['items']);
    expect(body.installed.pages).toEqual(['/']);
    expect(body.installed.endpoints).toEqual(['GET /list']);

    const dest = join(lmthingRoot, APP);
    expect(existsSync(join(dest, 'database', 'items.json'))).toBe(true);
    expect(existsSync(join(dest, 'pages', 'index.tsx'))).toBe(true);
    expect(existsSync(join(dest, 'api', 'list', 'GET.ts'))).toBe(true);
    expect(existsSync(join(dest, 'package.json'))).toBe(true);

    // Boot ran: a sqlite db (or its DR dump) exists.
    expect(existsSync(join(dest, '.data', 'app.db')) || existsSync(join(dest, '.data', 'app.sql'))).toBe(true);
  }, 30_000);

  it('re-installing an unedited (pristine) copy re-syncs ok, no divergence', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, STORE_URL);
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
    const handler = handleInstallApp(manager, lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: APP }) }), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; diverged?: boolean };
    expect(body.ok).toBe(false);
    expect(body.diverged).toBe(true);

    expect(await readFile(join(dest, 'pages', 'index.tsx'), 'utf8')).toContain('edited');
  }, 30_000);

  it('force:true overwrites a diverged copy', async () => {
    const dest = join(lmthingRoot, APP);
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: APP, force: true }) }), res, {});
    expect(captured.status).toBe(200);
    expect((captured.body as { ok: boolean }).ok).toBe(true);
    expect(await readFile(join(dest, 'pages', 'index.tsx'), 'utf8')).not.toContain('edited');
  }, 30_000);

  it('synthesizes project.json for an app that ships only package.json', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: NOPROJ }) }), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; projectId: string };
    expect(body.ok).toBe(true);
    expect(body.projectId).toBe(NOPROJ);

    const dest = join(lmthingRoot, NOPROJ);
    const projectJson = JSON.parse(await readFile(join(dest, 'project.json'), 'utf8')) as {
      id: string; title: string; description: string;
    };
    expect(projectJson.id).toBe(NOPROJ);
    expect(projectJson.title).toBe('No-Project App');
    expect(projectJson.description).toBe('An app-builder app with no project.json');
  }, 30_000);

  it('re-installing a synthesized-project app stays pristine (deterministic project.json)', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: NOPROJ }) }), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; diverged?: boolean };
    expect(body.ok).toBe(true);
    expect(body.diverged).toBeUndefined();
  }, 30_000);

  it('fires onInstalled(projectId) after a successful install (page-cache invalidation)', async () => {
    const seen: string[] = [];
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, STORE_URL, (pid) => seen.push(pid));
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: APP, projectId: 'cache-check' }) }), res, {});
    expect(captured.status).toBe(200);
    expect(seen).toEqual(['cache-check']);
  }, 30_000);

  it('installs into a custom projectId distinct from appId', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallApp(manager, lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ appId: APP, projectId: 'my-demo' }) }), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; projectId: string };
    expect(body.ok).toBe(true);
    expect(body.projectId).toBe('my-demo');
    expect(existsSync(join(lmthingRoot, 'my-demo', 'database', 'items.json'))).toBe(true);
  }, 30_000);
});
