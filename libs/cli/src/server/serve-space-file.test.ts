/**
 * Per-file space REST endpoints (WP-6) — keyless, in-process HTTP test.
 *
 * Proves the pod's per-file CRUD surface added alongside the existing
 * wipe-and-rewrite `PUT /api/projects/:id/spaces/:spaceId/files`:
 *   - POST   /api/projects/:id/spaces/:spaceId/files            → create a file
 *   - PUT    /api/projects/:id/spaces/:spaceId/files/<relPath>  → update a file
 *   - DELETE /api/projects/:id/spaces/:spaceId/files/<relPath>  → delete a file
 * and that a path-traversal relPath is rejected with 400 on each verb.
 *
 * No API keys — these routes never touch the model/session machinery.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SessionManager } from './session-manager.js';
import type { BuildSessionArgs } from './session-manager.js';
import { startSessionServer } from './serve.js';
import type { SessionServerHandle } from './serve.js';

// Resolving react/agent-ui aliases for app bundling only needs an absolute
// path that lives next to a real package.json — it doesn't need to be a real
// app.tsx. Project mode (lmthingRoot set, no defaultSpaceDir) still bundles a
// component-less shell, so this must point somewhere resolvable.
const APP_TSX_PATH = fileURLToPath(new URL('./serve.ts', import.meta.url));

const tmpDirs: string[] = [];
const servers: SessionServerHandle[] = [];

afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

function makeManager(root: string): SessionManager {
  const opts = {
    lmthingRoot: root,
    snapshotsDir: join(root, '.snaps'),
    streamFn: () => Promise.reject(new Error('streamFn should not be called for file CRUD')),
    buildSession: (_args: BuildSessionArgs) => {
      throw new Error('buildSession should not be called for file CRUD');
    },
  } as unknown as ConstructorParameters<typeof SessionManager>[0];
  return new SessionManager(opts);
}

async function startServer(): Promise<{ base: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'lmthing-file-crud-'));
  tmpDirs.push(root);
  const manager = makeManager(root);
  const handle = await startSessionServer({
    port: 0,
    manager,
    appTsxPath: APP_TSX_PATH,
    lmthingRoot: root,
  });
  servers.push(handle);
  return { base: `http://localhost:${handle.port}`, root };
}

describe('Per-file space REST endpoints (keyless)', () => {
  it('POST creates a file, PUT updates it, DELETE removes it', async () => {
    const { base, root } = await startServer();
    const fileAbsPath = join(root, 'user', 'spaces', 'demo', 'notes.md');

    // POST — create.
    const createRes = await fetch(`${base}/api/projects/user/spaces/demo/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'notes.md', content: '# Hello' }),
    });
    expect(createRes.status).toBe(201);
    expect(await readFile(fileAbsPath, 'utf8')).toBe('# Hello');

    // PUT — update.
    const updateRes = await fetch(`${base}/api/projects/user/spaces/demo/files/notes.md`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# Updated' }),
    });
    expect(updateRes.status).toBe(200);
    expect(await readFile(fileAbsPath, 'utf8')).toBe('# Updated');

    // PUT with a nested path creates parent dirs.
    const nestedAbsPath = join(root, 'user', 'spaces', 'demo', 'agents', 'bot', 'instruct.md');
    const nestedRes = await fetch(`${base}/api/projects/user/spaces/demo/files/agents/bot/instruct.md`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Body' }),
    });
    expect(nestedRes.status).toBe(200);
    expect(await readFile(nestedAbsPath, 'utf8')).toBe('Body');

    // DELETE — remove.
    const deleteRes = await fetch(`${base}/api/projects/user/spaces/demo/files/notes.md`, {
      method: 'DELETE',
    });
    expect([200, 204]).toContain(deleteRes.status);
    await expect(access(fileAbsPath)).rejects.toBeTruthy();
  });

  it('DELETE on a missing file returns 404', async () => {
    const { base } = await startServer();
    const res = await fetch(`${base}/api/projects/user/spaces/demo/files/missing.md`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('rejects path-traversal relPaths on POST, PUT, and DELETE', async () => {
    const { base, root } = await startServer();

    const postRes = await fetch(`${base}/api/projects/user/spaces/demo/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '../../escape.md', content: 'pwned' }),
    });
    expect(postRes.status).toBe(400);

    // A literal "../../escape.md" in the URL path gets collapsed by URL
    // normalization before the request is even sent (so it never reaches the
    // server as traversal) — that's a property of URLs, not our guard. To
    // actually exercise the server-side `isSafeRelPath`/`assertUnder` check on
    // the wildcard segment, encode the slashes (%2f) so "../.." survives
    // normalization intact and is only revealed by the server's per-segment
    // decodeURIComponent.
    const encodedTraversal = '..%2f..%2fescape.md';

    const putRes = await fetch(`${base}/api/projects/user/spaces/demo/files/${encodedTraversal}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'pwned' }),
    });
    expect(putRes.status).toBe(400);

    const deleteRes = await fetch(`${base}/api/projects/user/spaces/demo/files/${encodedTraversal}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(400);

    // Nothing escaped the lmthing root.
    await expect(access(join(root, 'escape.md'))).rejects.toBeTruthy();
  });

  it('rejects excluded runtime-junk relPaths (.env, conversations/)', async () => {
    const { base } = await startServer();

    const envRes = await fetch(`${base}/api/projects/user/spaces/demo/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '.env', content: 'SECRET=1' }),
    });
    expect(envRes.status).toBe(400);

    const convRes = await fetch(`${base}/api/projects/user/spaces/demo/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'agents/bot/conversations/c1.json', content: '{}' }),
    });
    expect(convRes.status).toBe(400);
  });

  it('does not affect the existing bulk PUT .../files wipe-and-rewrite behavior', async () => {
    const { base, root } = await startServer();

    const bulkRes = await fetch(`${base}/api/projects/user/spaces/demo/files`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: { 'a.md': 'A', 'b.md': 'B' } }),
    });
    expect(bulkRes.status).toBe(200);
    expect(await readFile(join(root, 'user', 'spaces', 'demo', 'a.md'), 'utf8')).toBe('A');
    expect(await readFile(join(root, 'user', 'spaces', 'demo', 'b.md'), 'utf8')).toBe('B');
  });
});
