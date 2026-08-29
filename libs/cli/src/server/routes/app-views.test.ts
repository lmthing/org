/**
 * `GET /api/apps/:id/views` — the spec-fetch route the NATIVE target renders from.
 *
 * What these assert is the transport contract, not the spec contract: the four keys
 * are present and correctly sourced, the route of record comes from the FILE PATH,
 * an appbuilder app answers `{ views: [] }` (the signal the mobile host branches
 * on), and one bad file costs one page rather than the whole app.
 *
 * The endpoint manifest is served from the manager's cached contracts when it has
 * them — the same fast path `handleAppManifest` takes — so these use a manager stub
 * rather than paying for `ts-json-schema-generator` per case.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleAppViews, readProjectViewSpecs, type AppViewsPayload } from './app-views.js';
import type { AppAdminManager } from './app-admin.js';
import type { EndpointContract } from '../../app/build/schema.js';

// ── Mock req/res (mirrors apps.test.ts / app-admin.test.ts) ───────────────────

function mockReq(): IncomingMessage {
  return { url: '/', method: 'GET' } as unknown as IncomingMessage;
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENDPOINTS: EndpointContract[] = [
  {
    name: 'listRecipes',
    method: 'GET',
    routePath: '/recipes',
    description: 'List recipes.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: { items: { type: 'array' } } },
    inputTsType: '{}',
    outputTsType: '{ items: unknown[] }',
  },
  {
    name: 'addRecipe',
    method: 'POST',
    routePath: '/recipes',
    description: 'Add a recipe.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    inputTsType: '{ title: string }',
    outputTsType: '{ id: string }',
  },
];

/** A manager whose contracts are already cached — the route's fast path. */
const manager: AppAdminManager = {
  getProjectDb: async () => null,
  getProjectContracts: async () => ({ endpoints: ENDPOINTS }),
};

let root: string;

async function writeProject(id: string, files: Record<string, string>): Promise<string> {
  const dir = join(root, id);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  await mkdir(dir, { recursive: true });
  return dir;
}

async function get(id: string): Promise<Captured> {
  const { res, captured } = mockRes();
  await handleAppViews(manager, root)(mockReq(), res, { id });
  return captured;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'lm-app-views-'));

  // An app: two pages (one nested + dynamic), a component, a shell, an api dir.
  await writeProject('kitchen', {
    'api/recipes/GET.ts': 'export const name = "listRecipes"\n',
    'views/index.view.json': JSON.stringify({
      route: 'index',
      title: 'Kitchen',
      sections: [{ kind: 'list', query: 'listRecipes', item: { title: '$.name' } }],
    }),
    'views/recipes/[id].view.json': JSON.stringify({
      // Deliberately WRONG — the file path is the route of record.
      route: 'stale/route',
      sections: [{ kind: 'detail', query: 'getRecipe' }],
    }),
    'components/RecipeCard.view.json': JSON.stringify({
      name: 'RecipeCard',
      props: { recipe: 'Recipe' },
      node: { el: 'surface', children: [{ el: 'heading', text: '$props.recipe.title' }] },
    }),
    'shell.view.json': JSON.stringify({
      brand: 'Kitchen',
      nav: [{ route: 'index', label: 'Home', icon: 'home' }],
    }),
  });

  // A db/api-only app: no views/ dir at all.
  await writeProject('blog', {
    'api/posts/GET.ts': 'export const name = "listPosts"\n',
  });

  // An app with one broken file among two.
  await writeProject('broken', {
    'views/index.view.json': JSON.stringify({ route: 'index', sections: [] }),
    'views/oops.view.json': '{ not json',
    'views/nope.view.json': JSON.stringify({ title: 'no route, no sections' }),
  });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

// ── The payload ───────────────────────────────────────────────────────────────

describe('GET /api/apps/:id/views', () => {
  it('serves views, components, shell and the endpoint manifest', async () => {
    const captured = await get('kitchen');
    expect(captured.status).toBe(200);
    const body = captured.body as AppViewsPayload;

    expect(body.project).toBe('kitchen');
    expect(body.views.map((v) => v.route)).toEqual(['index', 'recipes/[id]']);
    expect(body.views[0]!.title).toBe('Kitchen');
    expect(body.components.map((c) => c.name)).toEqual(['RecipeCard']);
    expect(body.shell).toMatchObject({ brand: 'Kitchen' });
    expect(body.errors).toBeUndefined();
  });

  it('keys endpoints by NAME with the web manifest fields, plus the Input schema a create form needs', async () => {
    const body = (await get('kitchen')).body as AppViewsPayload;
    // The two fields `window.__APP_ENDPOINTS__` carries, so a spec resolves a name
    // identically on both targets.
    expect(body.endpoints['listRecipes']).toMatchObject({ method: 'GET', routePath: '/recipes' });
    expect(body.endpoints['addRecipe']).toMatchObject({ method: 'POST', routePath: '/recipes' });
    // Native has no second place to get a create section's fields from.
    expect(body.endpoints['addRecipe']!.inputSchema).toMatchObject({
      properties: { title: { type: 'string' } },
    });
  });

  it('takes the route from the FILE PATH, not the spec body', async () => {
    const body = (await get('kitchen')).body as AppViewsPayload;
    const detail = body.views.find((v) => v.sections[0]?.kind === 'detail');
    expect(detail?.route).toBe('recipes/[id]');
  });

  it('never mistakes a component def or the shell for a route', async () => {
    const body = (await get('kitchen')).body as AppViewsPayload;
    expect(body.views.map((v) => v.route)).not.toContain('components/RecipeCard');
    expect(body.views.map((v) => v.route)).not.toContain('_shell');
  });

  it('answers a views-less app with an empty view list — the branch signal, not an error', async () => {
    const captured = await get('blog');
    expect(captured.status).toBe(200);
    const body = captured.body as AppViewsPayload;
    expect(body.views).toEqual([]);
    expect(body.components).toEqual([]);
    expect(body.shell).toBeNull();
  });

  it('costs one page per bad file, never the whole app', async () => {
    const captured = await get('broken');
    expect(captured.status).toBe(200);
    const body = captured.body as AppViewsPayload;
    expect(body.views.map((v) => v.route)).toEqual(['index']);
    expect(body.errors?.map((e) => e.file).sort()).toEqual([
      'views/nope.view.json',
      'views/oops.view.json',
    ]);
    expect(body.errors?.find((e) => e.file.endsWith('oops.view.json'))?.message).toContain('not valid JSON');
  });

  it('omits the manifest without erroring when the project has no api dir', async () => {
    const body = (await get('broken')).body as AppViewsPayload;
    expect(body.endpoints).toEqual({});
    expect(body.endpointsError).toBeUndefined();
  });

  it('rejects an unsafe project id and 404s an unknown one', async () => {
    const bad = await get('../etc');
    expect(bad.status).toBe(400);
    const missing = await get('nosuch');
    expect(missing.status).toBe(404);
  });

  it('reports a contract-generation failure rather than reading as "no endpoints"', async () => {
    const failing: AppAdminManager = {
      getProjectDb: async () => null,
      getProjectContracts: async () => {
        throw new Error('ts-json-schema-generator exploded');
      },
    };
    const { res, captured } = mockRes();
    await handleAppViews(failing, root)(mockReq(), res, { id: 'kitchen' });
    const body = captured.body as AppViewsPayload;
    expect(body.endpoints).toEqual({});
    expect(body.endpointsError).toContain('exploded');
  });
});

describe('readProjectViewSpecs', () => {
  it('is the same reader the route serves from', () => {
    const specs = readProjectViewSpecs(join(root, 'kitchen'));
    expect(specs.views.map((v) => v.route)).toEqual(['index', 'recipes/[id]']);
    expect(specs.components.map((c) => c.name)).toEqual(['RecipeCard']);
    expect(specs.shell).not.toBeNull();
    expect(specs.errors).toEqual([]);
  });
});

// ── Mount order ───────────────────────────────────────────────────────────────

/**
 * The router is first-match-wins by registration order, and this route shares a prefix
 * with two others. Registration order in `serve.ts` is `/api/apps` → `/api/apps/install`
 * → `/api/apps/:id/views`; these assert the three cannot shadow each other.
 */
describe('route matching', () => {
  it('does not collide with the catalog or install routes', async () => {
    const { Router } = await import('../router.js');
    const hit: string[] = [];
    const router = new Router();
    const mark = (name: string) => async () => { hit.push(name); };
    router.add('GET', '/api/apps', mark('list'));
    router.add('POST', '/api/apps/install', mark('install'));
    router.add('GET', '/api/apps/:id/views', mark('views'));

    const dispatch = (method: string, url: string) =>
      router.dispatch(
        { url, method } as unknown as IncomingMessage,
        mockRes().res,
        {} as never,
      );

    expect(dispatch('GET', '/api/apps')).toBe(true);
    expect(dispatch('POST', '/api/apps/install')).toBe(true);
    expect(dispatch('GET', '/api/apps/kitchen/views')).toBe(true);
    // A nested route is not a project id, and an unknown sub-path falls through to the
    // `unknown API route` 404 rather than to one of these.
    expect(dispatch('GET', '/api/apps/kitchen/views/extra')).toBe(false);

    await new Promise((r) => setTimeout(r, 0));
    expect(hit).toEqual(['list', 'install', 'views']);
  });
});
