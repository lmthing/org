/**
 * Per-project **page-app build** (Phase 5, 5A).
 *
 * Turns a project's `pages/` (client-side React, file-based routing) into a
 * cached, self-contained static bundle under `<projectRoot>/.data/pages-dist/`,
 * served (by 5B) under `…/app/<project>/*`. It runs **on save/boot, never per
 * request**, and short-circuits when nothing under `pages/`/`components/`/`lib/`/
 * `package.json` changed (content-hash cache).
 *
 * Pipeline:
 *   1. **Discover routes** — every non-`_`-prefixed `.tsx`/`.jsx` under `pages/`
 *      is a route (`index` → the dir's path, `[id]` → `:id`); `_app`/`_layout`
 *      are wrappers, not routes.
 *   2. **Endpoint manifest** — `generateAppTypes(projectRoot)` yields the typed
 *      `EndpointContract[]`; we project it to the client `name → { method,
 *      routePath }` manifest injected into the page app.
 *   3. **Generate an entry** (in `.data/pages-build/`, never the repo) that imports
 *      the pages + `_app`/`_layout`, builds the route table + manifest, and mounts
 *      the router (`@app/runtime` `mountApp`).
 *   4. **esbuild bundle** → hashed assets + `index.html` with **relative** URLs.
 *      `@app/runtime` aliases to this package's runtime module, `@app/types` to
 *      the project's generated dts; React is single-instanced from the cli's own
 *      node_modules so page hooks work.
 *
 * Node/build-time only (esbuild, fs). The emitted bundle is browser code.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, type BuildOptions } from 'esbuild';

import { generateAppTypes, type EndpointContract } from './schema.js';

/** A discovered page route. */
export interface PageRoute {
  /** Route pattern (`[id]` → `:id`), e.g. `/` or `/items/:id`. */
  routePath: string;
  /** Absolute path to the page `.tsx`/`.jsx` file. */
  file: string;
}

/** Result of {@link buildProjectPages}. */
export interface BuiltPages {
  /** The output dir (`<projectRoot>/.data/pages-dist`). */
  outDir: string;
  /** Emitted asset paths relative to {@link outDir} (incl. `index.html`, hashed JS/CSS). */
  assetManifest: string[];
  /** `true` when a build ran; `false` on a cache hit or when there is no `pages/`. */
  built: boolean;
  /** The discovered route table (`routePath` + source `file`). */
  routes: PageRoute[];
}

/** Options for {@link buildProjectPages}. */
export interface BuildPagesOpts {
  /** Force a rebuild even on a cache hit. */
  force?: boolean;
  /** Minify the bundle (default `true`). */
  minify?: boolean;
}

const PAGE_EXT = /\.(tsx|jsx)$/;
const OUT_SUBDIR = join('.data', 'pages-dist');
const BUILD_SUBDIR = join('.data', 'pages-build');
const CACHE_FILE = join('.data', 'pages-cache.json');

interface CacheMeta {
  hash: string;
  assetManifest: string[];
  routes: PageRoute[];
}

/**
 * Build (or cache-hit) a project's page app. Returns `{ built:false }` with empty
 * routes/manifest when the project has no `pages/` dir (a db/api-only project).
 */
export async function buildProjectPages(
  projectRoot: string,
  opts: BuildPagesOpts = {},
): Promise<BuiltPages> {
  const pagesDir = join(projectRoot, 'pages');
  const outDir = join(projectRoot, OUT_SUBDIR);

  if (!(await dirExists(pagesDir))) {
    return { outDir, assetManifest: [], built: false, routes: [] };
  }

  const routes = await discoverRoutes(pagesDir);
  const hash = await sourceHash(projectRoot);
  const cachePath = join(projectRoot, CACHE_FILE);

  if (!opts.force) {
    const cached = await readCache(cachePath);
    if (cached && cached.hash === hash && existsSync(join(outDir, 'index.html'))) {
      return { outDir, assetManifest: cached.assetManifest, built: false, routes: cached.routes };
    }
  }

  const assetManifest = await runBuild(projectRoot, pagesDir, outDir, routes, opts);
  await writeCache(cachePath, { hash, assetManifest, routes });
  return { outDir, assetManifest, built: true, routes };
}

// ── Route discovery ───────────────────────────────────────────────────────────

/** The two wrapper basenames that are NOT routes. */
const WRAPPERS = new Set(['_app', '_layout']);

/** Walk `pages/` collecting route files (skips `_`-prefixed and `components/`/`lib/`). */
async function discoverRoutes(pagesDir: string): Promise<PageRoute[]> {
  const routes: PageRoute[] = [];
  await walkPages(pagesDir, pagesDir, routes);
  routes.sort((a, b) => a.routePath.localeCompare(b.routePath));
  return routes;
}

async function walkPages(root: string, dir: string, out: PageRoute[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      // `components/`/`lib/` under pages/ hold shared code, not routes.
      if (entry.name === 'components' || entry.name === 'lib' || entry.name.startsWith('_')) continue;
      await walkPages(root, abs, out);
      continue;
    }
    if (!entry.isFile() || !PAGE_EXT.test(entry.name)) continue;
    const base = entry.name.replace(PAGE_EXT, '');
    if (base.startsWith('_')) continue; // _app / _layout / other wrappers
    out.push({ routePath: routePathFor(root, abs), file: abs });
  }
}

/** Map a page file to its route pattern (`index` collapses; `[id]` → `:id`). */
function routePathFor(root: string, file: string): string {
  const rel = relative(root, file).replace(PAGE_EXT, '');
  const segs = rel.split(sep).filter((s) => s.length > 0);
  if (segs.length > 0 && segs[segs.length - 1] === 'index') segs.pop();
  const parts = segs.map((s) => {
    const m = /^\[(.+)\]$/.exec(s);
    return m ? `:${m[1]}` : s;
  });
  return '/' + parts.join('/');
}

// ── Endpoint manifest ─────────────────────────────────────────────────────────

interface ManifestEntry {
  method: string;
  routePath: string;
}

/** Project the typed `EndpointContract[]` down to the client `name → routing` manifest. */
function endpointManifest(endpoints: EndpointContract[]): Record<string, ManifestEntry> {
  const manifest: Record<string, ManifestEntry> = {};
  for (const ep of endpoints) manifest[ep.name] = { method: ep.method, routePath: ep.routePath };
  return manifest;
}

// ── Build ─────────────────────────────────────────────────────────────────────

async function runBuild(
  projectRoot: string,
  pagesDir: string,
  outDir: string,
  routes: PageRoute[],
  opts: BuildPagesOpts,
): Promise<string[]> {
  // Endpoint contracts (also (re)writes types/generated.d.ts).
  const { endpoints } = await generateAppTypes(projectRoot);
  const manifest = endpointManifest(endpoints);

  // Generate the client entry in a scratch build dir (never the repo tree).
  const buildDir = join(projectRoot, BUILD_SUBDIR);
  await rm(buildDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });
  const wrappers = findWrappers(pagesDir);
  const entryFile = join(buildDir, 'entry.tsx');
  await writeFile(entryFile, renderEntry(routes, wrappers, manifest), 'utf8');

  // Fresh output dir (drop stale hashed assets).
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const { aliases, nodePaths } = resolveEnv(projectRoot);
  const generatedDts = join(projectRoot, 'types', 'generated.d.ts');
  if (existsSync(generatedDts)) aliases['@app/types'] = generatedDts;

  const buildOpts: BuildOptions = {
    entryPoints: { entry: entryFile },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    jsxImportSource: 'react',
    minify: opts.minify ?? true,
    sourcemap: false,
    metafile: true,
    write: true,
    absWorkingDir: outDir,
    outdir: '.',
    entryNames: 'assets/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',
    chunkNames: 'assets/[name]-[hash]',
    loader: { '.css': 'css', '.png': 'file', '.svg': 'file', '.jpg': 'file' },
    alias: aliases,
    nodePaths,
    logLevel: 'silent',
  };

  const result = await build(buildOpts);

  // Locate the entry's JS output (+ any extracted CSS bundle) from the metafile.
  let jsRel: string | undefined;
  let cssRel: string | undefined;
  for (const [outPath, meta] of Object.entries(result.metafile?.outputs ?? {})) {
    if (meta.entryPoint) {
      jsRel = outPath;
      if (meta.cssBundle) cssRel = meta.cssBundle;
    }
  }
  if (!jsRel) throw new Error('[pages-build] esbuild produced no entry output');

  await writeFile(join(outDir, 'index.html'), renderIndexHtml(jsRel, cssRel), 'utf8');

  // The asset manifest = every emitted file relative to outDir (incl. index.html).
  const files = await listFiles(outDir);
  return files.map((f) => relative(outDir, f).split(sep).join('/')).sort();
}

/** Which optional wrappers exist. */
function findWrappers(pagesDir: string): { app?: string; layout?: string } {
  const out: { app?: string; layout?: string } = {};
  for (const ext of ['tsx', 'jsx']) {
    if (!out.app && existsSync(join(pagesDir, `_app.${ext}`))) out.app = join(pagesDir, `_app.${ext}`);
    if (!out.layout && existsSync(join(pagesDir, `_layout.${ext}`)))
      out.layout = join(pagesDir, `_layout.${ext}`);
  }
  return out;
}

/** Emit the generated client entry that mounts the router. */
function renderEntry(
  routes: PageRoute[],
  wrappers: { app?: string; layout?: string },
  manifest: Record<string, ManifestEntry>,
): string {
  const lines: string[] = [];
  lines.push(`import { mountApp } from '@app/runtime';`);
  routes.forEach((r, i) => lines.push(`import Page${i} from ${JSON.stringify(r.file)};`));
  if (wrappers.app) lines.push(`import App from ${JSON.stringify(wrappers.app)};`);
  if (wrappers.layout) lines.push(`import Layout from ${JSON.stringify(wrappers.layout)};`);
  lines.push('');
  const routeItems = routes
    .map((r, i) => `  { routePath: ${JSON.stringify(r.routePath)}, Component: Page${i} }`)
    .join(',\n');
  lines.push('mountApp({');
  lines.push(`  manifest: ${JSON.stringify(manifest)},`);
  lines.push(`  app: ${wrappers.app ? 'App' : 'null'},`);
  lines.push(`  layout: ${wrappers.layout ? 'Layout' : 'null'},`);
  lines.push(`  routes: [\n${routeItems}\n  ],`);
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/** The static HTML shell — references the hashed bundle with **relative** URLs. */
function renderIndexHtml(jsRel: string, cssRel?: string): string {
  const css = cssRel ? `\n    <link rel="stylesheet" href="./${cssRel}">` : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />${css}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./${jsRel}"></script>
  </body>
</html>
`;
}

// ── Module/asset resolution ───────────────────────────────────────────────────

/**
 * Resolve the build environment: `@app/runtime` alias to this package's runtime
 * **source**, single-instanced React aliases, and every `node_modules` up from
 * the cli root on the resolution path so page imports (`@lmthing/ui`/`@lmthing/css`,
 * `react/jsx-runtime`, project deps) resolve even though the project lives outside
 * this workspace.
 *
 * Critically, the cli root is found by **walking up to the `@lmthing/cli`
 * `package.json`** — NOT by a `dist/`-relative path — so it works identically when
 * this module runs from `src/` (vitest) and from the **built** cli under `dist/`
 * (where a `dist/`-relative `../runtime` would be absent; the real runtime source
 * lives at `<cliRoot>/src/app/runtime/`, present on disk because the built cli runs
 * from the repo).
 */
function resolveEnv(projectRoot: string): { aliases: Record<string, string>; nodePaths: string[] } {
  const here = dirname(fileURLToPath(import.meta.url)); // src/app/build OR dist/…
  const cliRoot = findCliRoot(here);

  const runtimeIndex = firstExisting([
    join(cliRoot, 'src', 'app', 'runtime', 'index.ts'),
    join(cliRoot, 'src', 'app', 'runtime', 'index.js'),
    join(cliRoot, 'src', 'app', 'runtime', 'index.tsx'),
    // Last-ditch: relative to this module (covers an unusual on-disk layout).
    join(here, '..', 'runtime', 'index.ts'),
    join(here, '..', 'runtime', 'index.js'),
  ]);

  const req = createRequire(join(cliRoot, 'package.json'));

  const aliases: Record<string, string> = {};
  if (runtimeIndex) aliases['@app/runtime'] = runtimeIndex;
  // Resolve React subpaths to concrete files so single-instancing + `jsx-runtime`
  // never depend on esbuild's exports-map walk from the scratch entry dir.
  for (const pkg of [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-dom/client',
  ]) {
    try {
      aliases[pkg] = req.resolve(pkg);
    } catch {
      /* not present — leave to node_modules resolution below */
    }
  }

  // Every node_modules from the cli root up to the fs root (pnpm hoists to the
  // workspace root), plus the project's own — so bare + subpath imports resolve.
  const nodePaths = [...nodeModulesUpward(cliRoot), join(projectRoot, 'node_modules')].filter((p) =>
    existsSync(p),
  );
  return { aliases, nodePaths };
}

/** Walk up from `startDir` to the dir whose `package.json` is `@lmthing/cli`. */
function findCliRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const { name } = JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string };
        if (name === '@lmthing/cli') return dir;
      } catch {
        /* unreadable/!json — keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break; // fs root
    dir = parent;
  }
  // Fallback to the src layout (src/app/build → libs/cli).
  return join(startDir, '..', '..', '..');
}

/** Collect every existing `node_modules` from `start` up to the filesystem root. */
function nodeModulesUpward(start: string): string[] {
  const out: string[] = [];
  let dir = start;
  for (;;) {
    const nm = join(dir, 'node_modules');
    if (existsSync(nm)) out.push(nm);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((p) => existsSync(p));
}

// ── Cache ─────────────────────────────────────────────────────────────────────

/**
 * Content hash of everything that affects the page bundle: `package.json` +
 * every file under `pages/`/`components/`/`lib/` (path + bytes). Content-based
 * (not mtime) so a write-then-immediate-rebuild in the same second still hits.
 */
async function sourceHash(projectRoot: string): Promise<string> {
  const hash = createHash('sha256');
  const pkg = join(projectRoot, 'package.json');
  if (existsSync(pkg)) hash.update('package.json\0').update(await readFile(pkg));
  for (const sub of ['pages', 'components', 'lib']) {
    const dir = join(projectRoot, sub);
    const files = (await listFiles(dir)).sort();
    for (const f of files) {
      hash.update(relative(projectRoot, f).split(sep).join('/')).update('\0').update(await readFile(f));
    }
  }
  return hash.digest('hex');
}

/** Recursively list all files under `dir` (absolute paths); `[]` if absent. */
async function listFiles(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(abs)));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

async function readCache(cachePath: string): Promise<CacheMeta | null> {
  try {
    return JSON.parse(await readFile(cachePath, 'utf8')) as CacheMeta;
  } catch {
    return null;
  }
}

async function writeCache(cachePath: string, meta: CacheMeta): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(meta), 'utf8');
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}
