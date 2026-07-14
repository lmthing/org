/**
 * The two mounts a built project app is served on — `/app/<project>/…` (reserved
 * prefix) and `/<project>/…` (the clean root URL) — at the REAL server's route table.
 *
 * This is the regression test for "every app renders blank in prod": the root mount
 * used to be registered only when `LMTHING_GATEWAY_URL` was set, so on a pod whose
 * env lacked it, `/<project>/` matched no route, fell through to the pod's own SPA
 * shell, and answered 200 with HTML whose bundle is root-absolute `/assets/index-*.js`
 * — which 404s under the app's mount. The app built, served, and rendered empty, and
 * `/<project>/api/<route>` returned that same HTML instead of JSON. Every unit test of
 * the page handler passed the whole time, because nothing tested the route table.
 *
 * So: boot the actual server and assert, on BOTH mounts, that the shell is the APP's
 * (rebased, no root-absolute asset) and the app's own api route answers JSON — and
 * that the always-on root mount does not shadow the SPA.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Session, createMockStreamFn } from '@lmthing/core';
import { SessionManager } from './session-manager.js';
import type { BuildSessionArgs } from './session-manager.js';
import { startSessionServer } from './serve.js';
import type { SessionServerHandle } from './serve.js';

const tmpDirs: string[] = [];
const servers: SessionServerHandle[] = [];

afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

const mockStreamFn = createMockStreamFn(() => '');

/** A project with a table, one page and one api route — the minimum that is a real app. */
async function scratchRoot(projectId: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lm-mounts-'));
  tmpDirs.push(root);
  const proj = join(root, projectId);
  await mkdir(join(proj, 'pages'), { recursive: true });
  await mkdir(join(proj, 'api', 'feed-list'), { recursive: true });
  await mkdir(join(proj, 'database'), { recursive: true });
  await writeFile(join(proj, 'package.json'), JSON.stringify({ name: projectId, version: '0.0.0' }));
  // The app api runtime only exists for a project with a data model.
  await writeFile(
    join(proj, 'database', 'items.json'),
    JSON.stringify({
      title: 'Items',
      description: 'items',
      columns: { id: { type: 'string', description: 'unique id', primaryKey: true } },
    }),
    'utf8',
  );
  await writeFile(
    join(proj, 'pages', 'index.tsx'),
    `export default function Home() { return <div>home</div> }\n`,
    'utf8',
  );
  await writeFile(
    join(proj, 'api', 'feed-list', 'GET.ts'),
    `export const name = 'feedList'
export const description = 'the feed'
export default async function handler() { return { items: ['a'] } }
`,
    'utf8',
  );
  return root;
}

async function startServer(lmthingRoot: string): Promise<string> {
  const manager = new SessionManager({
    streamFn: mockStreamFn,
    snapshotsDir: join(lmthingRoot, '.snaps'),
    lmthingRoot,
    buildSession: (args: BuildSessionArgs) =>
      new Session(
        {
          spaceDir: args.spaceDir,
          agentSlug: args.agentSlug,
          modelAlias: 'mock',
          renderHost: args.renderHost,
          systemSpaceDirs: [],
        },
        { streamFn: mockStreamFn },
      ),
  });
  const handle = await startSessionServer({
    port: 0,
    manager,
    appTsxPath: 'unused',
    spacesRoot: join(lmthingRoot, '.spaces'),
    lmthingRoot,
  });
  servers.push(handle);
  return `http://localhost:${handle.port}`;
}

describe('project-app mounts (route table)', () => {
  it.each([
    ['reserved prefix', (p: string) => `/app/${p}`],
    ['clean root URL', (p: string) => `/${p}`],
  ])('serves the app\'s own shell + api on the %s mount', async (_label, mount) => {
    const projectId = 'demo-app';
    const base = await startServer(await scratchRoot(projectId));

    const page = await fetch(`${base}${mount(projectId)}/`);
    expect(page.status).toBe(200);
    const html = await page.text();

    // The shell must be the APP's build, rebased to the mount it is served on — not
    // the pod SPA's (which asks for a root-absolute bundle that 404s here).
    expect(html).toContain(`<base href="${mount(projectId)}/">`);
    expect(html).toContain(`window.__APP_BASE__ = "${mount(projectId)}"`);
    expect(html).not.toMatch(/src="\/assets\//);

    // …and the app's OWN api route answers JSON, not the HTML shell. A 200 whose body
    // is HTML is a BROKEN route: it is what a fall-through to the SPA looks like.
    const api = await fetch(`${base}${mount(projectId)}/api/feed-list`);
    expect(api.status).toBe(200);
    expect(api.headers.get('content-type')).toMatch(/application\/json/);
    expect(await api.json()).toEqual({ items: ['a'] });
  }, 60_000);

  it('the always-on root mount does not shadow the SPA or 404 a non-app path', async () => {
    const base = await startServer(await scratchRoot('demo-app'));

    // A reserved SPA route and an unknown first segment must both fall THROUGH to the
    // web handler — never be claimed by the app mount (which would answer with the
    // page handler's "no page app" 404, or with another project's bundle).
    for (const path of ['/studio', '/not-a-project/']) {
      const res = await fetch(`${base}${path}`);
      const body = await res.text();
      expect(body).not.toContain('has no page app');
      expect(body).not.toContain('window.__APP_BASE__');
    }
  }, 60_000);
});
