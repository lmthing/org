/**
 * {@link loadApiRoutes} — walks `<projectRoot>/api/`, maps each `<METHOD>.ts`
 * under a route dir to `(method, pattern)` + `name`, derives `[id]` → `:id`
 * params, ignores non-method `.ts` helpers, and fails loud on a duplicate name.
 *
 * Filesystem only — no worker, no db.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadApiRoutes, matchRoute, routeKey } from './loader.js';

const tmpDirs: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lm-api-loader-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function writeHandler(
  root: string,
  routeDir: string,
  method: string,
  name: string,
  description = 'x',
): Promise<void> {
  const dir = join(root, 'api', routeDir);
  await mkdir(dir, { recursive: true });
  const src = `
export const name = '${name}'
export const description = '${description}'
export default async function handler(input, ctx) { return { ok: true } }
`;
  await writeFile(join(dir, `${method}.ts`), src, 'utf8');
}

describe('loadApiRoutes — discovery + patterns', () => {
  it('maps dir→route, filename→method, [id]→:id, and indexes by name', async () => {
    const root = await scratch();
    await writeHandler(root, 'feed-list', 'GET', 'feedList');
    await writeHandler(root, 'mark-read', 'POST', 'markRead');
    await writeHandler(root, 'items/[id]', 'GET', 'getItem');
    await writeHandler(root, 'items/[id]', 'PATCH', 'updateItem');
    // A non-method helper file in a route dir must be ignored.
    await writeFile(join(root, 'api', 'items', '[id]', 'types.ts'), 'export type T = string\n', 'utf8');

    const table = await loadApiRoutes(root);

    expect(table.byMethodPattern.get(routeKey('GET', '/feed-list'))?.name).toBe('feedList');
    expect(table.byMethodPattern.get(routeKey('POST', '/mark-read'))?.name).toBe('markRead');

    const getItem = table.byMethodPattern.get(routeKey('GET', '/items/:id'));
    expect(getItem?.name).toBe('getItem');
    expect(getItem?.paramNames).toEqual(['id']);

    const patch = table.byMethodPattern.get(routeKey('PATCH', '/items/:id'));
    expect(patch?.name).toBe('updateItem');

    // name index
    expect(table.byName.get('updateItem')?.method).toBe('PATCH');
    // 4 endpoints, the helper ignored
    expect(table.endpoints).toHaveLength(4);
  });

  it('matchRoute extracts path params', async () => {
    const root = await scratch();
    await writeHandler(root, 'items/[id]', 'GET', 'getItem');
    const table = await loadApiRoutes(root);

    const m = matchRoute(table, 'GET', '/items/my.v2.item');
    expect(m?.endpoint.name).toBe('getItem');
    expect(m?.params).toEqual({ id: 'my.v2.item' });

    expect(matchRoute(table, 'GET', '/items')).toBeNull(); // arity mismatch
    expect(matchRoute(table, 'POST', '/items/x')).toBeNull(); // wrong method
  });

  it('a STATIC route beats a [id] sibling — /jobs/list is the list, not the detail with id="list"', async () => {
    const root = await scratch();
    // Register the dynamic route FIRST so a first-match-wins matcher would pick it. The static
    // sibling must still win: routing /jobs/list to jobs-detail (id="list") is the empty-dashboard bug.
    await writeHandler(root, 'jobs/[id]', 'GET', 'jobsDetail');
    await writeHandler(root, 'jobs/list', 'GET', 'jobsList');
    await writeHandler(root, 'jobs/dashboard-stats', 'GET', 'jobsDashboardStats');
    const table = await loadApiRoutes(root);

    expect(matchRoute(table, 'GET', '/jobs/list')?.endpoint.name).toBe('jobsList');
    expect(matchRoute(table, 'GET', '/jobs/dashboard-stats')?.endpoint.name).toBe('jobsDashboardStats');
    // A genuine id (no static sibling) still routes to the detail handler with the param bound.
    const detail = matchRoute(table, 'GET', '/jobs/abc-123');
    expect(detail?.endpoint.name).toBe('jobsDetail');
    expect(detail?.params).toEqual({ id: 'abc-123' });
  });

  it('returns an empty table when there is no api/ dir', async () => {
    const root = await scratch();
    const table = await loadApiRoutes(root);
    expect(table.endpoints).toEqual([]);
  });
});

describe('loadApiRoutes — fail-loud', () => {
  it('throws on a duplicate endpoint name', async () => {
    const root = await scratch();
    await writeHandler(root, 'a', 'GET', 'dup');
    await writeHandler(root, 'b', 'GET', 'dup');
    await expect(loadApiRoutes(root)).rejects.toThrow(/duplicate endpoint name "dup"/);
  });

  it('throws on a method file missing `export const name`', async () => {
    const root = await scratch();
    const dir = join(root, 'api', 'nameless');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'GET.ts'),
      'export default async function handler() { return {} }\n',
      'utf8',
    );
    await expect(loadApiRoutes(root)).rejects.toThrow(/missing `export const name`/);
  });
});
