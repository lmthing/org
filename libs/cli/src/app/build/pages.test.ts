/**
 * {@link buildProjectPages} — route discovery, esbuild bundle, asset manifest,
 * and the content-hash cache.
 *
 * Most fixtures are intentionally tiny and import **only** React + `@app/runtime`
 * (no `@lmthing/ui`/`@lmthing/css`) so the bundle resolves entirely from the
 * cli's own node_modules and the build stays fast. `@app/runtime` and React are
 * aliased/single-instanced by `pages.ts` itself. The final test deliberately
 * exercises the full `<Chat>` closure (`@lmthing/ui/chat` → auth/css/core-ui) —
 * the resolution path that must also work in the compute image.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildProjectPages } from './pages.js';

const tmpDirs: string[] = [];
async function scratchProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lm-pages-'));
  tmpDirs.push(dir);
  await mkdir(join(dir, 'pages', 'items'), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'scratch', version: '0.0.0' }));
  await writeFile(
    join(dir, 'pages', 'index.tsx'),
    `import { useApi } from '@app/runtime';
export default function Home() {
  const { data } = useApi('home', {});
  return <div className="p-4">home {String(data)}</div>;
}
`,
  );
  await writeFile(
    join(dir, 'pages', 'items', '[id].tsx'),
    `import { useParams } from '@app/runtime';
export default function Item({ params }: { params: { id: string } }) {
  const p = useParams();
  return <article>item {params.id} {p.id}</article>;
}
`,
  );
  await writeFile(
    join(dir, 'pages', '_layout.tsx'),
    `export default function Layout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto">{children}</main>;
}
`,
  );
  return dir;
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('buildProjectPages', () => {
  it('builds pages → index.html + hashed JS, route table, and asset manifest', async () => {
    const root = await scratchProject();
    const res = await buildProjectPages(root);

    expect(res.built).toBe(true);
    expect(res.outDir).toBe(join(root, '.data', 'pages-dist'));

    // Route table: `/` and `/items/:id`.
    const paths = res.routes.map((r) => r.routePath).sort();
    expect(paths).toEqual(['/', '/items/:id']);

    // Emitted files exist on disk.
    expect(await exists(join(res.outDir, 'index.html'))).toBe(true);
    const jsAsset = res.assetManifest.find((f) => /^assets\/entry-.*\.js$/.test(f));
    expect(jsAsset).toBeDefined();
    expect(await exists(join(res.outDir, jsAsset!))).toBe(true);

    // The manifest lists index.html + the hashed JS.
    expect(res.assetManifest).toContain('index.html');
    expect(res.assetManifest).toContain(jsAsset);
  }, 30_000);

  it('a second build with no changes is a cache hit (built:false)', async () => {
    const root = await scratchProject();
    const first = await buildProjectPages(root);
    expect(first.built).toBe(true);

    const second = await buildProjectPages(root);
    expect(second.built).toBe(false);
    expect(second.assetManifest).toEqual(first.assetManifest);
    expect(second.routes).toEqual(first.routes);
  }, 30_000);

  it('a db/api-only project (no pages/) returns built:false with no routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lm-nopages-'));
    tmpDirs.push(root);
    const res = await buildProjectPages(root);
    expect(res).toMatchObject({ built: false, assetManifest: [], routes: [] });
  });

  // Regression: the `@app/runtime` barrel re-exports `<Chat>` from `@lmthing/ui/chat`,
  // whose closure reaches `@lmthing/auth`, `@lmthing/css/elements/*` (+tokens) and
  // `@lmthing/core/ui`. A Chat-using page (blog/discover, trips, health, kitchen)
  // must bundle for the browser — this guards against the barrel picking up a
  // node-only import, and (in the compute image) against those libs not being shipped.
  it('builds a page that imports <Chat> (full @lmthing/ui closure)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lm-chatpage-'));
    tmpDirs.push(dir);
    await mkdir(join(dir, 'pages'), { recursive: true });
    await writeFile(
      join(dir, 'pages', 'index.tsx'),
      `import { Chat } from '@app/runtime';
export default function Index() { return <Chat agent="space/agent" />; }
`,
    );
    const res = await buildProjectPages(dir, { force: true, minify: false });
    expect(res.built).toBe(true);
    expect(res.assetManifest.length).toBeGreaterThan(0);
  }, 60_000);
});
