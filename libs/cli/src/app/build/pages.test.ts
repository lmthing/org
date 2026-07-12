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
import { mkdtemp, mkdir, writeFile, rm, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildProjectPages, uiElementsDirResolve } from './pages.js';

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

  // Regression (CSS loading): the bundle must ship **compiled** design-system CSS —
  // `@lmthing/css`'s `@theme` tokens + the Tailwind utilities the page uses + the
  // `@apply`/`@reference` element styles from `@lmthing/ui`, all expanded. esbuild's
  // raw `.css` loader passes those directives through verbatim (browser drops them),
  // so without the Tailwind compile step project apps render unstyled.
  it('emits compiled Tailwind CSS (tokens + utilities + expanded @apply), no raw directives', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lm-css-'));
    tmpDirs.push(dir);
    await mkdir(join(dir, 'pages'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'css-scratch', version: '0.0.0' }));
    await writeFile(
      join(dir, 'pages', 'index.tsx'),
      `import { Card } from '@lmthing/ui/elements/content/card/index.tsx';
export default function Home() {
  return <Card className="p-4 bg-background text-foreground">styled</Card>;
}
`,
    );
    const res = await buildProjectPages(dir, { force: true, minify: false });
    expect(res.built).toBe(true);

    // A CSS asset must be emitted and linked from index.html.
    const cssAsset = res.assetManifest.find((f) => /^assets\/.*\.css$/.test(f));
    expect(cssAsset).toBeDefined();
    const html = await readFile(join(res.outDir, 'index.html'), 'utf8');
    expect(html).toContain('rel="stylesheet"');

    const css = await readFile(join(res.outDir, cssAsset!), 'utf8');
    // Design tokens from `@theme` (the CSS custom properties element styles rely on).
    expect(css).toMatch(/--background\s*:/);
    // The utility classes the page uses were generated.
    expect(css).toMatch(/\.p-4\b/);
    expect(css).toMatch(/\.bg-background\b/);
    // The `@apply` element styles from `@lmthing/ui` were expanded, not passed through.
    expect(css).toContain('.card');
    expect(css).not.toMatch(/@apply\b/);
    expect(css).not.toMatch(/@reference\b/);
  }, 60_000);

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

  // Regression (scenario 05): esbuild resolves a package's `"exports"` subpaths EXACTLY —
  // no directory `index` fallback. `@lmthing/ui` maps `"./elements/*": "./src/elements/*"`
  // (directories with `index.tsx`), so `@lmthing/ui/elements/forms/input` failed to resolve
  // in the compute image's project-app build (Vite/workspace resolution had masked it),
  // breaking EVERY project-app page build the moment `<Chat>` pulled the studio
  // `SettingsSchemaForm` in. `uiElementsDirResolve` rewrites such a directory import to its
  // concrete `index.*`. Unit-tested directly because the pod's strict resolution isn't
  // reproducible under vitest's symlinked-workspace resolution.
  it('uiElementsDirResolve rewrites a bare elements dir import to its index file', async () => {
    const uiSrc = await mkdtemp(join(tmpdir(), 'lm-uisrc-'));
    tmpDirs.push(uiSrc);
    await mkdir(join(uiSrc, 'elements', 'forms', 'input'), { recursive: true });
    const indexFile = join(uiSrc, 'elements', 'forms', 'input', 'index.tsx');
    await writeFile(indexFile, 'export const Input = () => null;');

    const plugin = uiElementsDirResolve(uiSrc);
    let resolved: { path: string } | undefined;
    const build = {
      onResolve: (_opts: unknown, cb: (a: { path: string }) => { path: string } | undefined) => {
        resolved = cb({ path: '@lmthing/ui/elements/forms/input' }) ?? undefined;
      },
    };
    plugin.setup(build as unknown as Parameters<typeof plugin.setup>[0]);
    expect(resolved?.path).toBe(indexFile);

    // A specifier with no matching index directory is left for esbuild (returns undefined).
    let untouched: unknown = 'sentinel';
    const build2 = {
      onResolve: (_o: unknown, cb: (a: { path: string }) => unknown) => {
        untouched = cb({ path: '@lmthing/ui/elements/does/not-exist' });
      },
    };
    plugin.setup(build2 as unknown as Parameters<typeof plugin.setup>[0]);
    expect(untouched).toBeUndefined();
  });
});
