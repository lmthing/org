/**
 * `GET /api/store/spaces` (catalog listing), `POST /api/store/spaces/install`
 * (download + materialize ONE space into a project's `spaces/` dir), and
 * `GET /api/projects/:projectId/integrations` (scan installed integrations).
 *
 * There is NO local catalog in the pod — the catalog lives on the public store at
 * `${STORE_URL}/projects/manifest.json` (`spaces[]`). These tests stub `fetch` to
 * serve a fixture "store": the manifest plus the space's files at
 * `/spaces/<id>/<relpath>`. Mirrors `routes/apps.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  handleListStoreSpaces,
  handleInstallStoreSpace,
  handleListProjectIntegrations,
  type CatalogSpace,
} from './routes/store-spaces.js';
import { DEFAULT_PROJECT_ID, scaffoldProject } from './projects.js';

// ── Mock req/res (mirrors apps.test.ts) ───────────────────────────────────────

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

const SPACE = 'integration-demo';
const STORE_URL = 'http://store.test';

const AGENT_INSTRUCT = `---\ntitle: Demo\nknowledge: []\nfunctions: []\ncomponents: []\n---\n\nYou are the demo integration agent.\n`;

const DEMO_README = `# Connect Demo\n\n1. Get a token.\n2. Paste it below.\n`;

const SPACE_SETTINGS_SCHEMA = {
  type: 'object',
  properties: {
    DEMO_TOKEN: { type: 'string', title: 'Demo token', format: 'password' },
  },
  required: ['DEMO_TOKEN'],
};

/** Write the demo integration space's files under `<storeDir>/spaces/<SPACE>/`. */
async function writeDemoSpace(storeDir: string): Promise<void> {
  const spaceRoot = join(storeDir, 'spaces', SPACE);
  await mkdir(join(spaceRoot, 'agents', 'demo'), { recursive: true });
  await writeFile(join(spaceRoot, 'agents', 'demo', 'instruct.md'), AGENT_INSTRUCT, 'utf8');
  await writeFile(join(spaceRoot, 'README.md'), DEMO_README, 'utf8');
  await writeFile(
    join(spaceRoot, 'package.json'),
    JSON.stringify({
      name: SPACE,
      version: '1.0.0',
      private: true,
      lmthing: {
        kind: 'integration',
        title: 'Demo Integration',
        tags: ['integration'],
        icon: '🔌',
        description: 'A demo integration space.',
        settings: SPACE_SETTINGS_SCHEMA,
      },
    }),
    'utf8',
  );
}

/** A second, non-integration space (no `lmthing` block) — must never show up in
 *  `GET /api/projects/:projectId/integrations`. */
const PLAIN_SPACE = 'plain-demo';

async function writePlainSpace(storeDir: string): Promise<void> {
  const spaceRoot = join(storeDir, 'spaces', PLAIN_SPACE);
  await mkdir(join(spaceRoot, 'agents', 'plain'), { recursive: true });
  await writeFile(join(spaceRoot, 'agents', 'plain', 'instruct.md'), AGENT_INSTRUCT, 'utf8');
  await writeFile(
    join(spaceRoot, 'package.json'),
    JSON.stringify({ name: PLAIN_SPACE, version: '1.0.0', private: true }),
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

/** Write `<storeDir>/manifest.json` describing both fixture spaces (`spaces[]`, incl. `files`). */
async function writeManifest(storeDir: string): Promise<void> {
  const demoFiles = await listFiles(join(storeDir, 'spaces', SPACE));
  const plainFiles = await listFiles(join(storeDir, 'spaces', PLAIN_SPACE));
  const manifest = {
    apps: [],
    spaces: [
      {
        id: SPACE,
        title: 'Demo Integration',
        description: 'A demo integration space.',
        icon: '🔌',
        tags: ['integration'],
        kind: 'integration',
        settings: SPACE_SETTINGS_SCHEMA,
        files: demoFiles,
      } satisfies CatalogSpace,
      {
        id: PLAIN_SPACE,
        title: 'Plain Demo',
        description: '',
        icon: null,
        tags: [],
        kind: null,
        settings: null,
        files: plainFiles,
      } satisfies CatalogSpace,
    ],
  };
  await writeFile(join(storeDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

/** Stub `fetch` to serve `<storeDir>` at `${STORE_URL}/projects/manifest.json` and
 *  `${STORE_URL}/spaces/<id>/<relpath>`. */
function stubStoreFetch(storeDir: string): void {
  vi.stubGlobal('fetch', async (url: string | URL): Promise<Response> => {
    const u = new URL(typeof url === 'string' ? url : url.toString());
    if (u.pathname === '/projects/manifest.json') {
      const filePath = join(storeDir, 'manifest.json');
      if (!existsSync(filePath)) return new Response('not found', { status: 404 });
      return new Response(await readFile(filePath), { status: 200 });
    }
    const m = /^\/spaces\/(.+)$/.exec(u.pathname);
    if (!m) return new Response('not found', { status: 404 });
    const rel = decodeURIComponent(m[1]!);
    const filePath = join(storeDir, 'spaces', rel);
    if (!existsSync(filePath)) return new Response('not found', { status: 404 });
    return new Response(await readFile(filePath), { status: 200 });
  });
}

let storeDir: string;
let lmthingRoot: string;

beforeAll(async () => {
  storeDir = await mkdtemp(join(tmpdir(), 'lm-space-store-'));
  lmthingRoot = await mkdtemp(join(tmpdir(), 'lm-spaces-root-'));
  await writeDemoSpace(storeDir);
  await writePlainSpace(storeDir);
  await writeManifest(storeDir);
  stubStoreFetch(storeDir);

  // Target projects the install tests install into.
  await scaffoldProject(lmthingRoot, DEFAULT_PROJECT_ID, 'Personal');
  await scaffoldProject(lmthingRoot, 'other-project', 'Other');
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(storeDir, { recursive: true, force: true });
  await rm(lmthingRoot, { recursive: true, force: true });
});

// ── GET /api/store/spaces ──────────────────────────────────────────────────────

describe('handleListStoreSpaces', () => {
  it('lists the demo integration space from the store manifest', async () => {
    const { res, captured } = mockRes();
    await handleListStoreSpaces(STORE_URL)(mockReq(), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as { spaces: CatalogSpace[] };
    expect(body.spaces.length).toBeGreaterThanOrEqual(2);
    const demo = body.spaces.find((s) => s.id === SPACE)!;
    expect(demo.title).toBe('Demo Integration');
    expect(demo.kind).toBe('integration');
    expect(demo.settings).toEqual(SPACE_SETTINGS_SCHEMA);
  });

  it('tolerates an unreachable store (→ empty list)', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network down'); });
    try {
      const { res, captured } = mockRes();
      await handleListStoreSpaces(STORE_URL)(mockReq(), res, {});
      expect(captured.status).toBe(200);
      expect(captured.body).toEqual({ spaces: [] });
    } finally {
      stubStoreFetch(storeDir);
    }
  });
});

// ── POST /api/store/spaces/install ─────────────────────────────────────────────

describe('handleInstallStoreSpace', () => {
  it('404s for a spaceId not in the store catalog', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallStoreSpace(lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ spaceId: 'nope' }) }), res, {});
    expect(captured.status).toBe(404);
  });

  it('refuses a path-traversal spaceId', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallStoreSpace(lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ spaceId: '../x' }) }), res, {});
    expect(captured.status).toBe(400);
  });

  it('404s when the target project does not exist', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallStoreSpace(lmthingRoot, STORE_URL);
    await handler(
      mockReq({ method: 'POST', body: JSON.stringify({ spaceId: SPACE, projectId: 'ghost-project' }) }),
      res,
      {},
    );
    expect(captured.status).toBe(404);
  });

  it('installs into the DEFAULT project ("user") when projectId is omitted', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallStoreSpace(lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ spaceId: SPACE }) }), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; projectId: string; spaceId: string };
    expect(body.ok).toBe(true);
    expect(body.projectId).toBe(DEFAULT_PROJECT_ID);
    expect(body.spaceId).toBe(SPACE);

    const dest = join(lmthingRoot, DEFAULT_PROJECT_ID, 'spaces', SPACE);
    expect(existsSync(join(dest, 'package.json'))).toBe(true);
    expect(existsSync(join(dest, 'agents', 'demo', 'instruct.md'))).toBe(true);
    // Marker written INSIDE the installed space dir.
    const marker = JSON.parse(await readFile(join(dest, '.installed.json'), 'utf8')) as {
      spaceId: string; sourceHash: string; installedAt: string;
    };
    expect(marker.spaceId).toBe(SPACE);
    expect(typeof marker.sourceHash).toBe('string');
  });

  it('re-installing an unedited (pristine) copy re-syncs ok, no divergence', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallStoreSpace(lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ spaceId: SPACE }) }), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; diverged?: boolean };
    expect(body.ok).toBe(true);
    expect(body.diverged).toBeUndefined();
  });

  it('holds back an edited copy with diverged:true, preserving the edit', async () => {
    const dest = join(lmthingRoot, DEFAULT_PROJECT_ID, 'spaces', SPACE);
    await writeFile(join(dest, 'agents', 'demo', 'instruct.md'), 'edited content', 'utf8');

    const { res, captured } = mockRes();
    const handler = handleInstallStoreSpace(lmthingRoot, STORE_URL);
    await handler(mockReq({ method: 'POST', body: JSON.stringify({ spaceId: SPACE }) }), res, {});
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; diverged?: boolean };
    expect(body.ok).toBe(false);
    expect(body.diverged).toBe(true);

    expect(await readFile(join(dest, 'agents', 'demo', 'instruct.md'), 'utf8')).toBe('edited content');
  });

  it('force:true overwrites a diverged copy', async () => {
    const dest = join(lmthingRoot, DEFAULT_PROJECT_ID, 'spaces', SPACE);
    const { res, captured } = mockRes();
    const handler = handleInstallStoreSpace(lmthingRoot, STORE_URL);
    await handler(
      mockReq({ method: 'POST', body: JSON.stringify({ spaceId: SPACE, force: true }) }),
      res,
      {},
    );
    expect(captured.status).toBe(200);
    expect((captured.body as { ok: boolean }).ok).toBe(true);
    expect(await readFile(join(dest, 'agents', 'demo', 'instruct.md'), 'utf8')).toBe(AGENT_INSTRUCT);
  });

  it('installs into an explicit, non-default projectId', async () => {
    const { res, captured } = mockRes();
    const handler = handleInstallStoreSpace(lmthingRoot, STORE_URL);
    await handler(
      mockReq({ method: 'POST', body: JSON.stringify({ spaceId: SPACE, projectId: 'other-project' }) }),
      res,
      {},
    );
    expect(captured.status).toBe(200);
    const body = captured.body as { ok: boolean; projectId: string };
    expect(body.ok).toBe(true);
    expect(body.projectId).toBe('other-project');
    expect(existsSync(join(lmthingRoot, 'other-project', 'spaces', SPACE, 'package.json'))).toBe(true);
  });

  it('fires onInstalled(projectId) after a successful install', async () => {
    const seen: string[] = [];
    const { res, captured } = mockRes();
    const handler = handleInstallStoreSpace(lmthingRoot, STORE_URL, (pid) => seen.push(pid));
    await handler(
      mockReq({ method: 'POST', body: JSON.stringify({ spaceId: SPACE, force: true }) }),
      res,
      {},
    );
    expect(captured.status).toBe(200);
    expect(seen).toEqual([DEFAULT_PROJECT_ID]);
  });
});

// ── GET /api/projects/:projectId/integrations ──────────────────────────────────

describe('handleListProjectIntegrations', () => {
  it('returns the installed integration with its settings schema', async () => {
    // Install the plain (non-integration) space too, alongside the integration one,
    // to prove the non-integration space is excluded from the result.
    const installHandler = handleInstallStoreSpace(lmthingRoot, STORE_URL);
    await installHandler(
      mockReq({ method: 'POST', body: JSON.stringify({ spaceId: PLAIN_SPACE }) }),
      mockRes().res,
      {},
    );

    const { res, captured } = mockRes();
    const handler = handleListProjectIntegrations(lmthingRoot);
    await handler(mockReq(), res, { projectId: DEFAULT_PROJECT_ID });
    expect(captured.status).toBe(200);
    const body = captured.body as {
      integrations: Array<{
        spaceId: string; title: string; icon: string | null;
        tags: string[]; settings: unknown; readme: string;
      }>;
    };
    expect(body.integrations.map((i) => i.spaceId)).toEqual([SPACE]);
    const demo = body.integrations[0]!;
    expect(demo.title).toBe('Demo Integration');
    expect(demo.icon).toBe('🔌');
    expect(demo.tags).toEqual(['integration']);
    expect(demo.settings).toEqual(SPACE_SETTINGS_SCHEMA);
    // The bundled README is materialized on install and surfaced verbatim.
    expect(demo.readme).toBe(DEMO_README);
  });

  it('returns [] for a project with no installed spaces', async () => {
    const { res, captured } = mockRes();
    const handler = handleListProjectIntegrations(lmthingRoot);
    // "empty-project" was never scaffolded — the handler must not throw, just
    // return an empty list (missing spaces dir is tolerated).
    await handler(mockReq(), res, { projectId: 'empty-project' });
    expect(captured.status).toBe(200);
    expect((captured.body as { integrations: unknown[] }).integrations).toEqual([]);
  });

  it('rejects an unsafe projectId', async () => {
    const { res, captured } = mockRes();
    const handler = handleListProjectIntegrations(lmthingRoot);
    await handler(mockReq(), res, { projectId: '../x' });
    expect(captured.status).toBe(400);
  });
});
