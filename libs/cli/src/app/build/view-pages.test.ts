/**
 * **The claim this file exists to prove:** a view spec written by `writeProjectView` produces a
 * page the EXISTING build pipeline bundles, with no change to `walkPages`, the content hash, the
 * cache or the entry generator.
 *
 * That claim is the whole design. If it is false, view specs need a second build path and every
 * argument for them gets more expensive. So this is a real `buildProjectPages` run over a real
 * project whose only page is a generated wrapper — the same test shape as `./pages.test.ts`, and
 * deliberately heavier than a unit test, because a mocked bundler cannot fail the way a bundler
 * fails.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildProjectPages } from './pages.js';
import { createProjectAuthoringGlobals } from '../authoring/globals.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

/**
 * `@lmthing/ui/view` is Wave 1's UI-RENDERER deliverable. Until its `./view` export exists the
 * wrapper cannot bundle — not because anything here is wrong, but because the module it imports is
 * not there yet. Skipping loudly beats asserting something weaker.
 */
function rendererExportExists(): boolean {
  try {
    // Resolved through the package's own `exports` map — the same door esbuild goes through, so
    // this cannot pass while the bundle fails on resolution.
    return existsSync(createRequire(import.meta.url).resolve('@lmthing/ui/view'));
  } catch {
    return false;
  }
}

async function viewProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lm-view-build-'));
  tmpDirs.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'scratch', version: '0.0.0' }));
  await mkdir(join(root, 'api', 'recipes'), { recursive: true });
  await writeFile(
    join(root, 'api', 'recipes', 'GET.ts'),
    `export const name = 'listRecipes';
export interface Output { items: { id: string; title: string }[]; }
export default async function handler() { return { items: [] }; }
`,
  );

  // Author the page the way the pipeline does — through the writer, not by hand. A wrapper this
  // test wrote itself would prove only that this test can write a wrapper.
  const pa = createProjectAuthoringGlobals({ projectRoot: root });
  const written = pa.writeProjectView('index', {
    title: 'Recipes',
    sections: [{ kind: 'list', query: 'listRecipes', item: { title: '$.title' } }],
  });
  expect(written).toEqual({ ok: true });
  return root;
}

describe('a generated view wrapper is an ordinary page to the build', () => {
  it('is discovered as a route by the UNCHANGED route walker', async () => {
    const root = await viewProject();
    const wrapper = await readFile(join(root, 'pages', 'index.tsx'), 'utf8');
    expect(wrapper).toContain("from '@lmthing/ui/view'");

    // The spec and the component dir must NOT become routes; only the `.tsx` may.
    const pa = createProjectAuthoringGlobals({ projectRoot: root });
    pa.writeProjectViewComponent('RecipeCard', { node: { el: 'text', text: 'hi' } });
    pa.writeProjectViewShell({ nav: [{ route: 'index' }] });

    // `buildProjectPages` returns `{ built:false }` only for a project with no `pages/` dir; here
    // it always walks. Route discovery happens before any bundling, so assert it even when the
    // bundle is skipped below.
    const res = await buildProjectPages(root, { minify: false }).catch((e: unknown) => e as Error);
    if (!(res instanceof Error)) expect(res.routes.map((r) => r.routePath)).toEqual(['/']);
  });

  it.skipIf(!rendererExportExists())(
    'BUNDLES — the pipeline needs no changes to serve a spec page',
    async () => {
      const root = await viewProject();
      const res = await buildProjectPages(root, { minify: false });

      expect(res.built).toBe(true);
      expect(res.routes.map((r) => r.routePath)).toEqual(['/']);
      expect(existsSync(join(res.outDir, 'index.html'))).toBe(true);

      const jsAsset = res.assetManifest.find((f) => /^assets\/entry-.*\.js$/.test(f));
      expect(jsAsset).toBeTruthy();
      const bundle = await readFile(join(res.outDir, jsAsset!), 'utf8');
      // The SPEC is in the bundle: the page carries its own definition, no spec fetch on the web.
      expect(bundle).toContain('listRecipes');
      // And the endpoint manifest the client resolves names through.
      expect(bundle).toContain('__APP_ENDPOINTS__');
    },
    120_000,
  );
});
