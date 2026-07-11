/**
 * The pod-side {@link createStoreResolver} (plan S10) + its integration with the
 * core yield router's `installSpace` case: catalog search/inspect over the
 * public store manifest, the pure-install path (divergence guard respected,
 * `onInstalled(projectId, spaceId)` fired), and the END-TO-END order
 * consent → install → register → republish against a real fixture store —
 * including denied consent = NO install (nothing touches disk).
 *
 * The "store" is a fixture dir served by a stubbed `fetch` (same pattern as
 * `store-spaces.test.ts`).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { routeCommonYield } from '@lmthing/core';
import type { Space, YieldRequest, YieldRouterContext, InstallSpaceResult } from '@lmthing/core';

import { createStoreResolver } from './store-resolver.js';
import { DEFAULT_PROJECT_ID, scaffoldProject } from './projects.js';

// ── Fixture store (served via a stubbed fetch) ────────────────────────────────

const SPACE = 'integration-demo';
const OTHER_SPACE = 'plain-notes';
const STORE_URL = 'http://store.test';

const AGENT_INSTRUCT = `---\ntitle: Demo\nknowledge: []\nfunctions: []\ncomponents: []\n---\n\nYou are the demo integration agent.\n`;

async function writeSpace(storeDir: string, id: string, agent: string, extra: Record<string, unknown> = {}): Promise<void> {
  const spaceRoot = join(storeDir, 'spaces', id);
  await mkdir(join(spaceRoot, 'agents', agent), { recursive: true });
  await writeFile(join(spaceRoot, 'agents', agent, 'instruct.md'), AGENT_INSTRUCT, 'utf8');
  await writeFile(
    join(spaceRoot, 'package.json'),
    JSON.stringify({ name: id, version: '1.0.0', private: true, ...extra }),
    'utf8',
  );
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(abs, base)));
    else if (entry.isFile()) out.push(relative(base, abs).split('/').join('/'));
  }
  return out.sort();
}

async function writeManifest(storeDir: string): Promise<void> {
  const manifest = {
    apps: [],
    spaces: [
      {
        id: SPACE,
        title: 'Demo Integration',
        description: 'Posts messages to demo channels.',
        icon: '🔌',
        tags: ['integration', 'messaging'],
        kind: 'integration',
        settings: null,
        files: await listFiles(join(storeDir, 'spaces', SPACE)),
        // S12-style enrichment must flow through storeSearch/storeInspect verbatim.
        events: { 'message.posted': { payload: { text: 'string' } } },
      },
      {
        id: OTHER_SPACE,
        title: 'Plain Notes',
        description: 'A note-taking space.',
        icon: null,
        tags: [],
        kind: null,
        settings: null,
        files: await listFiles(join(storeDir, 'spaces', OTHER_SPACE)),
      },
    ],
  };
  await writeFile(join(storeDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function stubStoreFetch(storeDir: string): void {
  vi.stubGlobal('fetch', async (url: string | URL): Promise<Response> => {
    const u = new URL(typeof url === 'string' ? url : url.toString());
    if (u.pathname === '/projects/manifest.json') {
      return new Response(await readFile(join(storeDir, 'manifest.json')), { status: 200 });
    }
    const m = /^\/spaces\/(.+)$/.exec(u.pathname);
    if (!m) return new Response('not found', { status: 404 });
    const filePath = join(storeDir, 'spaces', decodeURIComponent(m[1]!));
    if (!existsSync(filePath)) return new Response('not found', { status: 404 });
    return new Response(await readFile(filePath), { status: 200 });
  });
}

let storeDir: string;
let lmthingRoot: string;

beforeAll(async () => {
  storeDir = await mkdtemp(join(tmpdir(), 'lm-store-resolver-store-'));
  lmthingRoot = await mkdtemp(join(tmpdir(), 'lm-store-resolver-root-'));
  await writeSpace(storeDir, SPACE, 'demo', { lmthing: { kind: 'integration' } });
  await writeSpace(storeDir, OTHER_SPACE, 'notes');
  await writeManifest(storeDir);
  stubStoreFetch(storeDir);
  await scaffoldProject(lmthingRoot, DEFAULT_PROJECT_ID, 'Personal');
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(storeDir, { recursive: true, force: true });
  await rm(lmthingRoot, { recursive: true, force: true });
});

function makeResolver(over: { republished?: string[]; installed?: Array<[string, string | undefined]> } = {}) {
  return createStoreResolver({
    root: lmthingRoot,
    projectId: DEFAULT_PROJECT_ID,
    storeUrl: STORE_URL,
    republish: async () => {
      over.republished?.push('republish');
    },
    onInstalled: (pid, sid) => {
      over.installed?.push([pid, sid]);
    },
  });
}

// ── search / inspect ──────────────────────────────────────────────────────────

describe('createStoreResolver — search/inspect', () => {
  it('returns the full catalog without a query, entries verbatim (enrichment intact)', async () => {
    const all = (await makeResolver().search()) as Array<Record<string, unknown>>;
    expect(all.map((s) => s['id'])).toEqual([SPACE, OTHER_SPACE]);
    expect(all[0]!['events']).toEqual({ 'message.posted': { payload: { text: 'string' } } });
  });

  it('filters case-insensitively across id/title/description/tags', async () => {
    const resolver = makeResolver();
    expect(((await resolver.search('MESSAGING')) as Array<{ id: string }>).map((s) => s.id)).toEqual([SPACE]);
    expect(((await resolver.search('note-taking')) as Array<{ id: string }>).map((s) => s.id)).toEqual([OTHER_SPACE]);
    expect(await resolver.search('zebra')).toEqual([]);
  });

  it('inspect returns the one entry (undefined when absent)', async () => {
    const resolver = makeResolver();
    const entry = (await resolver.inspect(SPACE)) as Record<string, unknown>;
    expect(entry['title']).toBe('Demo Integration');
    expect(await resolver.inspect('no-such-space')).toBeUndefined();
  });
});

// ── install (pure path via the resolver) ──────────────────────────────────────

describe('createStoreResolver — install', () => {
  it('materializes the space, reports installedDir, fires onInstalled(projectId, spaceId)', async () => {
    const installed: Array<[string, string | undefined]> = [];
    const outcome = await makeResolver({ installed }).install(SPACE);
    const dest = join(lmthingRoot, DEFAULT_PROJECT_ID, 'spaces', SPACE);
    expect(outcome).toEqual({ ok: true, spaceId: SPACE, projectId: DEFAULT_PROJECT_ID, installedDir: dest });
    expect(existsSync(join(dest, 'agents', 'demo', 'instruct.md'))).toBe(true);
    expect(existsSync(join(dest, '.installed.json'))).toBe(true);
    expect(installed).toEqual([[DEFAULT_PROJECT_ID, SPACE]]);
  });

  it('respects the pristine-hash divergence guard (agent path has no force)', async () => {
    const dest = join(lmthingRoot, DEFAULT_PROJECT_ID, 'spaces', SPACE);
    await writeFile(join(dest, 'agents', 'demo', 'instruct.md'), 'locally edited', 'utf8');
    const installed: Array<[string, string | undefined]> = [];
    const outcome = await makeResolver({ installed }).install(SPACE);
    expect(outcome.ok).toBe(false);
    expect(outcome.diverged).toBe(true);
    expect(outcome.message).toMatch(/local edits/);
    expect(installed).toEqual([]); // held back — no install notification
    // The local edit survives.
    expect(await readFile(join(dest, 'agents', 'demo', 'instruct.md'), 'utf8')).toBe('locally edited');
    await rm(dest, { recursive: true, force: true }); // reset for later tests
  });

  it('maps an unknown catalog id to a plain error outcome', async () => {
    const outcome = await makeResolver().install('no-such-space');
    expect(outcome.ok).toBe(false);
    expect(outcome.diverged).toBeUndefined();
    expect(outcome.error).toMatch(/not available in store catalog/);
  });
});

// ── end-to-end with the core yield router ─────────────────────────────────────

const noopDeferred = { resolve: () => {}, reject: () => {} };
function installYield(spaceId: string): YieldRequest {
  return { kind: 'installSpace', args: [spaceId], deferred: noopDeferred, vmPromiseHandle: undefined } as YieldRequest;
}

function routerCtx(over: Partial<YieldRouterContext>): YieldRouterContext {
  return {
    space: {} as Space,
    runDelegate: async () => {
      throw new Error('runDelegate not expected');
    },
    ...over,
  };
}

describe('installSpace end-to-end (router + real resolver + fixture store)', () => {
  it('consent → install → register → republish, live-registered for delegate()', async () => {
    const order: string[] = [];
    const republished: string[] = [];
    const dynamicSpaces = new Map<string, Space>();
    const origSet = dynamicSpaces.set.bind(dynamicSpaces);
    dynamicSpaces.set = (k, v) => {
      order.push('register');
      return origSet(k, v);
    };
    const resolver = createStoreResolver({
      root: lmthingRoot,
      projectId: DEFAULT_PROJECT_ID,
      storeUrl: STORE_URL,
      republish: async () => {
        order.push('republish');
        republished.push('yes');
      },
      onInstalled: () => order.push('install'),
    });

    const r = await routeCommonYield(
      installYield(SPACE),
      routerCtx({
        storeResolver: resolver,
        dynamicSpaces,
        requestConsent: async (card) => {
          order.push('consent');
          expect(card).toEqual({ function: 'installSpace', argsSummary: `["${SPACE}"]` });
          return true;
        },
      }),
    );

    expect(order).toEqual(['consent', 'install', 'register', 'republish']);
    const dest = join(lmthingRoot, DEFAULT_PROJECT_ID, 'spaces', SPACE);
    const value = (r as { handled: true; value: InstallSpaceResult }).value;
    expect(value).toEqual({
      ok: true,
      spaceId: SPACE,
      projectId: DEFAULT_PROJECT_ID,
      spaceKey: dest,
      agentSlug: 'demo',
    });
    // Live-registered: the loaded Space sits in the session-shared map.
    expect(dynamicSpaces.get(dest)?.agents['demo']).toBeDefined();
    expect(republished).toEqual(['yes']);
    await rm(dest, { recursive: true, force: true });
  });

  it('DENIED consent = no install: refusal thrown, nothing written to disk', async () => {
    const dest = join(lmthingRoot, DEFAULT_PROJECT_ID, 'spaces', SPACE);
    const dynamicSpaces = new Map<string, Space>();
    await expect(
      routeCommonYield(
        installYield(SPACE),
        routerCtx({
          storeResolver: makeResolver(),
          dynamicSpaces,
          requestConsent: async () => false,
        }),
      ),
    ).rejects.toThrow(/consent denied/i);
    expect(existsSync(dest)).toBe(false);
    expect(dynamicSpaces.size).toBe(0);
  });

  it('headless context (no prompter) fails closed: refusal thrown, nothing written', async () => {
    const dest = join(lmthingRoot, DEFAULT_PROJECT_ID, 'spaces', SPACE);
    await expect(
      routeCommonYield(installYield(SPACE), routerCtx({ storeResolver: makeResolver() })),
    ).rejects.toThrow(/requires user consent/i);
    expect(existsSync(dest)).toBe(false);
  });
});
