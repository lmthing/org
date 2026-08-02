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
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
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
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
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

async function scratchSpecRoot(projectId: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lm-spec-mounts-'));
  tmpDirs.push(root);
  const project = join(root, projectId);
  await mkdir(join(project, 'views'), { recursive: true });
  await writeFile(join(project, 'app.json'), JSON.stringify({ format: 2, title: 'Spec app' }));
  await writeFile(
    join(project, 'views', 'index.view.json'),
    JSON.stringify({ route: 'index', title: 'Spec home', sections: [{ kind: 'markdown', text: 'Hello' }] }),
    'utf8',
  );
  return root;
}

async function shellDist(): Promise<string> {
  const dist = await mkdtemp(join(tmpdir(), 'app-shell-dist-'));
  tmpDirs.push(dist);
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(
    join(dist, 'index.html'),
    '<!doctype html><html><head></head><body data-app-shell="true"><div id="root"></div><script type="module" src="./assets/app-shell.js"></script></body></html>',
  );
  await writeFile(join(dist, 'assets', 'app-shell.js'), 'console.log("app shell")');
  return dist;
}

async function startServer(lmthingRoot: string, appShellDist?: string): Promise<string> {
  const previousAppShell = process.env['LM_APP_SHELL'];
  const previousAppShellDist = process.env['LM_APP_SHELL_DIST'];
  if (appShellDist) process.env['LM_APP_SHELL_DIST'] = appShellDist;
  else process.env['LM_APP_SHELL'] = '0';

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
  if (previousAppShell === undefined) delete process.env['LM_APP_SHELL'];
  else process.env['LM_APP_SHELL'] = previousAppShell;
  if (previousAppShellDist === undefined) delete process.env['LM_APP_SHELL_DIST'];
  else process.env['LM_APP_SHELL_DIST'] = previousAppShellDist;
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

  it.each([
    ['reserved prefix', (p: string) => `/app/${p}`],
    ['clean root URL', (p: string) => `/${p}`],
  ])('serves the prebuilt shell without a project page build on the %s mount', async (_label, mount) => {
    const projectId = 'spec-app';
    const root = await scratchSpecRoot(projectId);
    const base = await startServer(root, await shellDist());

    const page = await fetch(`${base}${mount(projectId)}/nested/route`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('data-app-shell="true"');
    expect(html).toContain(`<base href="${mount(projectId)}/">`);
    expect(html).toContain(`window.__APP_BASE__ = "${mount(projectId)}"`);

    const asset = await fetch(`${base}${mount(projectId)}/assets/app-shell.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('console.log("app shell")');

    await expect(stat(join(root, projectId, '.data', 'pages-dist'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60_000);

  it('keeps a legacy TSX project on its per-project bundle while the shell is enabled', async () => {
    const projectId = 'legacy-app';
    const base = await startServer(await scratchRoot(projectId), await shellDist());

    const page = await fetch(`${base}/app/${projectId}/`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).not.toContain('data-app-shell="true"');
    expect(html).toContain(`<base href="/app/${projectId}/">`);
  }, 60_000);

  it('uses the legacy bundle for a spec project when LM_APP_SHELL=0', async () => {
    const projectId = 'spec-with-wrapper';
    const root = await scratchSpecRoot(projectId);
    await mkdir(join(root, projectId, 'pages'), { recursive: true });
    await writeFile(join(root, projectId, 'pages', 'index.tsx'), 'export default function Home() { return <div>legacy wrapper</div> }');
    const base = await startServer(root);

    const page = await fetch(`${base}/app/${projectId}/`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).not.toContain('data-app-shell="true"');
    expect(html).toContain(`<base href="/app/${projectId}/">`);
  }, 60_000);
});
