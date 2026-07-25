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
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, type BuildFailure, type BuildOptions, type Message, type Plugin } from 'esbuild';
import { isUnderMemoryPressure } from '../../server/mem-watchdog.js';
import { compile, Features } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

import { generateAppTypes, type EndpointContract } from './schema.js';
import type { AppCheckError } from './check.js';

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

/**
 * Bumped whenever the **builder itself** — or the bundled `@app/runtime` source it
 * inlines — changes what it emits (independent of project sources), so an existing
 * pod's cached bundle is invalidated and rebuilt. The content hash tracks only the
 * project's own files, so a runtime-only fix needs a bump here to reach cached apps.
 * `2` = Tailwind-compiled design-system CSS is now bundled (previously the theme
 *       tokens/utilities/`@apply` never made it into the output → apps rendered unstyled).
 * `3` = router `Link`/`navigate` re-apply the `…/app/<project>` base and accept the
 *       `href` prop (previously `<Link href>` degraded to a full-page nav that left
 *       the app — e.g. `/discover` instead of `/app/<project>/discover`).
 * `4` = `<Chat>` sends the platform `@lmthing/auth` Bearer token on session create +
 *       WS (previously the pod's JWT-gated `/api/*` proxy 401'd the curator chat).
 * `5` = generated HTML pins the light token theme so project apps don't inherit
 *       dark foreground tokens on light app surfaces.
 * `6` = router tolerates a stray `/pages/` prefix on a page-authored link
 *       (`stripPagesPrefix`): `matchRoutes` falls back to the prefix-stripped route
 *       and `toHref` normalizes it out (previously `<Link to="/pages/park-fees">`
 *       rendered "No page for /pages/park-fees" — live: scenario 06 index page).
 * `7` = `<Chat>` is self-floating: it now renders its own fixed-position launcher
 *       button and responsive open/close panel instead of filling its parent's
 *       box, so an already-built app's hand-rolled `_layout` dock chrome would
 *       double up with it until rebuilt.
 */
const BUILDER_VERSION = '7';

interface CacheMeta {
  hash: string;
  assetManifest: string[];
  routes: PageRoute[];
}

// Process-wide esbuild serialization: each page build peaks ~100 MB, so two
// concurrent builds double that. Chain them so at most one runs at a time.
let esbuildChain: Promise<unknown> = Promise.resolve();
function serializeEsbuild<T>(fn: () => Promise<T>): Promise<T> {
  const run = esbuildChain.then(fn, fn);
  esbuildChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Wait (bounded) for hard memory pressure to clear before a heavy build. No-op
 *  off-container (the watchdog never raises pressure there). */
async function waitForMemoryHeadroom(maxWaitMs = 30_000): Promise<void> {
  const start = Date.now();
  while (isUnderMemoryPressure() && Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 1000));
  }
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

/** Result of {@link buildProjectPagesChecked}. */
export interface CheckedPagesBuild {
  /** `true` iff a clean bundle was produced (esbuild did not throw). */
  built: boolean;
  /** The built route paths (`routePath` only — the model-facing shape). */
  routes: string[];
  /** Structured `phase:'build'` failures; empty on a clean build. */
  errors: AppCheckError[];
}

/**
 * {@link buildProjectPages} wrapped for the programmatic-check pipeline
 * ({@link ../build/check.js}'s `runProjectAppCheck`): an esbuild `BuildFailure` is
 * caught and its `errors` (esbuild `Message[]`) mapped to structured
 * {@link AppCheckError}s instead of propagating as an uncaught throw. Always forces
 * a fresh build (`force:true`) — the check must reflect the CURRENT sources, never
 * a stale cache hit. Any other (non-esbuild) throw is a real bug, not a build
 * failure, and is left to propagate.
 */
export async function buildProjectPagesChecked(
  projectRoot: string,
  opts: BuildPagesOpts = {},
): Promise<CheckedPagesBuild> {
  const outDir = join(projectRoot, OUT_SUBDIR);
  try {
    const res = await buildProjectPages(projectRoot, { ...opts, force: true });
    return { built: res.built, routes: res.routes.map((r) => r.routePath), errors: [] };
  } catch (err) {
    if (!isBuildFailure(err)) throw err;
    return { built: false, routes: [], errors: err.errors.map((m) => esbuildMessageToError(m, projectRoot, outDir)) };
  }
}

/** `true` for an esbuild `BuildFailure` — an `Error` carrying structured `errors`/`warnings`. */
function isBuildFailure(err: unknown): err is BuildFailure {
  return err instanceof Error && Array.isArray((err as { errors?: unknown }).errors);
}

/** Map one esbuild `Message` to a `phase:'build'` {@link AppCheckError}. */
function esbuildMessageToError(msg: Message, projectRoot: string, absWorkingDir: string): AppCheckError {
  const loc = msg.location;
  if (!loc) return { phase: 'build', file: '(unknown)', message: msg.text };
  const abs = isAbsolute(loc.file) ? loc.file : join(absWorkingDir, loc.file);
  return {
    phase: 'build',
    file: relative(projectRoot, abs).split(sep).join('/'),
    line: loc.line,
    column: loc.column,
    message: msg.text,
  };
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

  const { aliases, nodePaths, designSystem, uiSrcDir } = resolveEnv(projectRoot);

  // Generate the client entry in a scratch build dir (never the repo tree).
  const buildDir = join(projectRoot, BUILD_SUBDIR);
  await rm(buildDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });
  const wrappers = findWrappers(pagesDir);

  // Design-system stylesheet entry: pulls in `@lmthing/css` (theme tokens,
  // Tailwind base/utilities), scanned against the page + component + design-system
  // sources so every class the pages/`@lmthing/ui` use is generated. Compiled by
  // the Tailwind plugin below (esbuild alone can't expand `@theme`/`@apply`).
  const appCssFile = join(buildDir, 'app.css');
  await writeFile(appCssFile, renderAppCss(projectRoot, designSystem), 'utf8');

  const entryFile = join(buildDir, 'entry.tsx');
  await writeFile(
    entryFile,
    renderEntry(routes, wrappers, manifest, designSystem.themeCss ? './app.css' : undefined),
    'utf8',
  );

  // Fresh output dir (drop stale hashed assets).
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

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
    plugins: [
      ...(uiSrcDir ? [uiElementsDirResolve(uiSrcDir)] : []),
      tailwindCssPlugin(),
    ],
    logLevel: 'silent',
  };

  // Serialize esbuild across the process (each build peaks ~100 MB — two at once
  // can trip the memory watchdog) and defer while the pod is under hard memory
  // pressure, so a rare cold build never races resident sessions into an OOM.
  const result = await serializeEsbuild(async () => {
    await waitForMemoryHeadroom();
    return build(buildOpts);
  });

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
  cssEntry?: string,
): string {
  const lines: string[] = [];
  // The design-system stylesheet must be first so its tokens/base cascade under
  // element + page styles. Omitted when `@lmthing/css` can't be resolved.
  if (cssEntry) lines.push(`import ${JSON.stringify(cssEntry)};`);
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

/**
 * Emit the design-system stylesheet entry (`app.css`). It declares `@source` globs so the Tailwind
 * compiler generates every utility class the pages, shared components and `@lmthing/ui` actually use.
 * A tiny base gives pages the token-driven background / foreground / font by default. Compiled by
 * {@link tailwindCssPlugin}.
 *
 * **This file now brings its own Tailwind.** It used to get it for free, because
 * `@lmthing/css/theme.css` opened with `@import "tailwindcss"`. The design system is Tailwind-free as
 * of phase 4 of `docs/tamagui-final-steps.md`, so without the two imports below an agent-authored page
 * using `flex gap-2 rounded-lg` would compile to nothing and render unstyled — Tailwind for PROJECT
 * APP PAGES is a product feature and outlives the migration.
 *
 * `theme` + `utilities` only, deliberately NOT the `tailwindcss` barrel: the barrel also pulls
 * Tailwind's preflight, and `theme.css` already imports the design system's own `preflight.css` (which
 * *is* that preflight, checked in with its variables resolved). Importing the barrel would ship the
 * resets twice.
 */
/**
 * Re-declare the design system's tokens as a Tailwind theme, from `@lmthing/css`'s generated
 * `tokens.manifest.json` — the same source `theme.css` is generated from, so the two cannot drift.
 * `@theme inline` maps each utility name onto the custom property the theme already emits, which
 * keeps light/dark working (the utility resolves through `var(--token)`, it does not copy a value).
 */
function renderTokenTheme(ds: DesignSystem): string {
  if (!ds.tokensManifest) return '';
  const { colors, scales } = ds.tokensManifest;
  const lines: string[] = [];
  // Colours go through `@theme inline` so the utility resolves as `var(--token)` and keeps following
  // the light/dark override, rather than baking in one mode's value.
  lines.push('@theme inline {');
  for (const c of colors) lines.push(`  --color-${c.name}: var(${c.cssVar});`);
  lines.push('}');
  // Scales use a plain `@theme` with LITERAL values. They cannot use `inline`: Tailwind's theme key
  // for a radius/font is the same name as ours (`--radius-sm`, `--font-sans`), so
  // `@theme inline { --font-sans: var(--font-sans) }` emits a SELF-REFERENTIAL custom property and the
  // whole declaration is invalid. Scales are mode-independent, so a literal is exact anyway.
  lines.push('@theme {');
  for (const sc of scales) lines.push(`  --${sc.name}: ${sc.value};`);
  lines.push('}');
  return lines.join('\n');
}

function renderAppCss(projectRoot: string, ds: DesignSystem): string {
  if (!ds.themeCss) return '';
  const lines = [
    '@import "tailwindcss/theme" layer(theme);',
    '@import "tailwindcss/utilities" layer(utilities);',
    `@import ${JSON.stringify(ds.themeCss)};`,
  ];
  // Bridge the design-system tokens back into Tailwind's theme so a page can still write
  // `bg-background` / `text-agent` / `rounded-lg` / `font-sans`.
  //
  // `theme.css` used to carry this as an `@theme inline` block, which is how those utilities existed
  // at all; phase 4 turned it into plain `--color-*` custom properties, so Tailwind stopped knowing
  // the names and `@apply bg-background` failed with "Cannot apply unknown utility class". Rebuilding
  // it HERE is the right place: the SPA needs no Tailwind, and only project-app pages do.
  const themeBridge = renderTokenTheme(ds);
  if (themeBridge) lines.push(themeBridge);
  for (const dir of [
    join(projectRoot, 'pages'),
    join(projectRoot, 'components'),
    join(projectRoot, 'lib'),
    ...ds.sourceDirs,
  ]) {
    if (existsSync(dir)) lines.push(`@source ${JSON.stringify(dir)};`);
  }
  lines.push('@layer base {');
  lines.push('  html, body, #root { height: 100%; }');
  // Plain CSS, not `@apply`: this line must not depend on the token bridge above resolving.
  lines.push('  body {');
  lines.push('    background-color: var(--background);');
  lines.push('    color: var(--foreground);');
  lines.push('    font-family: var(--font-sans);');
  lines.push('    -webkit-font-smoothing: antialiased;');
  lines.push('    -moz-osx-font-smoothing: grayscale;');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

/** CSS files carrying any Tailwind v4 directive that esbuild can't expand on its own. */
const TAILWIND_DIRECTIVE =
  /@(tailwind|apply|reference|theme|source|variant|custom-variant|utility|plugin|config)\b|@import\s+["']tailwindcss/;

/**
 * esbuild plugin that runs the **Tailwind v4 compiler** over every CSS file
 * carrying a Tailwind directive — the design-system theme (`@import "tailwindcss"`
 * + `@theme` tokens + utilities) and the `@lmthing/ui` element styles
 * (`@reference` + `@apply`). Without this, esbuild's raw `.css` loader passes
 * those directives through verbatim and the browser drops them, so project apps
 * render **unstyled**. Plain third-party CSS (e.g. xterm) is passed through
 * untouched (and fast).
 */
function tailwindCssPlugin(): Plugin {
  return {
    name: 'lmthing-tailwind',
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: /\.css$/ }, async (args) => {
        const raw = await readFile(args.path, 'utf8');
        if (!TAILWIND_DIRECTIVE.test(raw)) return null; // plain CSS → esbuild's own loader
        const base = dirname(args.path);
        const compiler = await compile(raw, {
          base,
          shouldRewriteUrls: true,
          onDependency: () => {},
        });
        // Scanner sources = the compiler's auto-detected root + any `@source` globs.
        const sources = (
          compiler.root === 'none'
            ? []
            : compiler.root === null
              ? [{ base, pattern: '**/*', negated: false }]
              : [{ ...compiler.root, negated: false }]
        ).concat(compiler.sources);
        const candidates: string[] = [];
        if (compiler.features & Features.Utilities) {
          const scanner = new Scanner({ sources });
          for (const c of scanner.scan()) candidates.push(c);
        }
        const contents = compiler.build(candidates);
        return { contents, loader: 'css', resolveDir: base };
      });
    },
  };
}

/** The static HTML shell — references the hashed bundle with **relative** URLs. */
function renderIndexHtml(jsRel: string, cssRel?: string): string {
  const css = cssRel ? `\n    <link rel="stylesheet" href="./${cssRel}">` : '';
  return `<!doctype html>
<html lang="en" data-theme="light">
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
function resolveEnv(projectRoot: string): {
  aliases: Record<string, string>;
  nodePaths: string[];
  designSystem: DesignSystem;
  /** `<@lmthing/ui>/src` — used by {@link uiElementsDirResolve} to fix esbuild's
   *  exact (no-index) resolution of the package's `./elements/*` directory exports. */
  uiSrcDir?: string;
} {
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
  let uiSrcDir: string | undefined;
  try {
    uiSrcDir = dirname(req.resolve('@lmthing/ui')); // `.` export is `src/index.ts` → `<ui>/src`
  } catch {
    /* ui not resolvable — the plugin simply never matches */
  }
  return { aliases, nodePaths, designSystem: resolveDesignSystem(req), uiSrcDir };
}

/**
 * esbuild resolves subpaths through a package's `"exports"` map EXACTLY — no directory
 * `index` fallback and no extension probing (matching Node's exports semantics). `@lmthing/ui`
 * maps `"./elements/*": "./src/elements/*"`, and every element is a DIRECTORY with an
 * `index.tsx` (`@lmthing/ui/elements/forms/input` → `src/elements/forms/input/index.tsx`), so
 * the bare directory target fails to resolve ("Could not resolve @lmthing/ui/elements/forms/input").
 * Vite (studio/chat) resolves it fine, so it went unnoticed until a project-app page pulled the
 * chat UI in (`@app/runtime` → `Chat` → `@lmthing/ui/chat` → `IntegrationsTab` → `SettingsSchemaForm`)
 * — which broke EVERY project-app page build. This plugin (project-app build ONLY, zero blast
 * radius on the Vite surfaces) rewrites such a directory import to its concrete `index.*` file;
 * a specifier that already resolves is left untouched (the plugin returns nothing and esbuild
 * proceeds normally).
 */
export function uiElementsDirResolve(uiSrcDir: string): Plugin {
  const prefix = '@lmthing/ui/elements/';
  return {
    name: 'lmthing-ui-elements-dir-resolve',
    setup(build) {
      build.onResolve({ filter: /^@lmthing\/ui\/elements\// }, (args) => {
        const rest = args.path.slice(prefix.length); // e.g. "forms/input"
        for (const ext of ['index.tsx', 'index.ts', 'index.jsx', 'index.js']) {
          const candidate = join(uiSrcDir, 'elements', rest, ext);
          if (existsSync(candidate)) return { path: candidate };
        }
        return undefined; // not a directory-with-index — let esbuild resolve normally
      });
    },
  };
}

/** Resolved design-system assets for the Tailwind CSS build. */
interface TokensManifest {
  colors: { name: string; cssVar: string }[];
  scales: { name: string; cssVar: string; value: string }[];
}

interface DesignSystem {
  /** Absolute path to `@lmthing/css`'s theme stylesheet, if resolvable. */
  themeCss?: string;
  /** Source dirs to scan for Tailwind class candidates (`@lmthing/ui`/`@lmthing/css`). */
  sourceDirs: string[];
  /**
   * `@lmthing/css`'s generated token index. Needed since phase 4: the theme is plain CSS now, so the
   * Tailwind theme that gives pages `bg-*`/`text-*`/`rounded-*` has to be rebuilt from the tokens.
   */
  tokensManifest?: TokensManifest;
}

/**
 * Locate `@lmthing/css` (theme tokens/utilities) and the design-system source
 * trees the Tailwind compiler must scan for used classes. Missing packages leave
 * `themeCss` undefined — the build proceeds without the injected stylesheet rather
 * than failing (mirrors the tiny React-only fixtures in tests).
 */
function resolveDesignSystem(req: NodeRequire): DesignSystem {
  const sourceDirs: string[] = [];
  let themeCss: string | undefined;
  let tokensManifest: TokensManifest | undefined;
  try {
    // `@lmthing/css` exports `./theme` → `src/theme.css`; scan its whole `src`.
    themeCss = req.resolve('@lmthing/css/theme');
    sourceDirs.push(dirname(themeCss));
  } catch {
    /* design system not resolvable (e.g. a minimal fixture) — skip */
  }
  try {
    // The token index behind the Tailwind theme bridge (see `renderTokenTheme`).
    tokensManifest = JSON.parse(
      readFileSync(req.resolve('@lmthing/css/tokens.manifest.json'), 'utf8'),
    ) as TokensManifest;
  } catch {
    /* no manifest (minimal fixture) — pages then get no token utilities, only the plain base */
  }
  try {
    // `@lmthing/ui` components carry raw utility classNames the theme must emit.
    // Its `.` export is `src/index.ts`, so its dir is the source tree to scan.
    sourceDirs.push(dirname(req.resolve('@lmthing/ui')));
  } catch {
    /* ui not resolvable — pages that avoid it still style correctly */
  }
  return { themeCss, sourceDirs, tokensManifest };
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
  hash.update('builder\0').update(BUILDER_VERSION).update('\0');
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
