/**
 * **Where a view spec lives on disk** — the one module that knows the layout, so the writers
 * (`../authoring/globals.ts`), the app-wide validators (`./validate.ts`) and the pod's
 * spec-fetch route all agree without importing each other.
 *
 * ## The layout, and why every path is under `pages/`
 *
 * ```
 * pages/<route>.view.json              the page spec        (the artifact the model authors)
 * pages/<route>.tsx                    the wrapper          (HOST-GENERATED from the spec)
 * pages/components/<Name>.view.json    a view component def
 * pages/_shell.view.json               the app shell
 * ```
 *
 * The **key move of the design**: the spec sits beside a trivial generated `.tsx` that renders
 * it. `walkPages` (`../build/pages.ts`) discovers the `.tsx`, hashes it, bundles it and caches it
 * exactly as it does a hand-written page — so the build pipeline never learns that view specs
 * exist and needs ZERO changes. The two non-route paths are equally deliberate:
 * `walkPages` already skips a `components/` dir under `pages/` and any `_`-prefixed basename,
 * and `.json` is not a page extension anyway, so neither the component defs nor the shell can
 * ever be mistaken for a route.
 *
 * Because the wrapper INLINES the spec (plus the components and the shell it renders with), a
 * component or shell write invalidates every wrapper — which is why {@link listViewRoutes} exists:
 * the writers re-emit all of them rather than trying to work out which pages used what.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { ShellSpec, ViewComponentSpec, ViewSpec } from './schema.js';

/** The extension that marks a view artifact. Chosen so `<route>.view.json` sorts beside `<route>.tsx`. */
export const VIEW_EXT = '.view.json';

/** The `pages/`-relative dir holding view component defs. Skipped by `walkPages` by name. */
export const VIEW_COMPONENT_DIR = 'components';

/** The project-relative path of the app shell spec. `_`-prefixed, so it is never a route. */
export const SHELL_SPEC_PATH = `pages/_shell${VIEW_EXT}`;

/** `recipes/[id]` → `pages/recipes/[id].view.json`. */
export function viewSpecPath(route: string): string {
  return join('pages', `${route}${VIEW_EXT}`);
}

/** `recipes/[id]` → `pages/recipes/[id].tsx` — the generated wrapper the pages build discovers. */
export function viewWrapperPath(route: string): string {
  return join('pages', `${route}.tsx`);
}

/** `RecipeCard` → `pages/components/RecipeCard.view.json`. */
export function viewComponentPath(name: string): string {
  return join('pages', VIEW_COMPONENT_DIR, `${name}${VIEW_EXT}`);
}

/** One artifact that is on disk but could not be read as JSON. Reported, never thrown. */
export interface MalformedArtifact {
  /** Project-relative path. */
  path: string;
  message: string;
}

/** Everything a whole-app check (or the spec-fetch route) needs, read in one pass. */
export interface LoadedViews {
  /** Every `pages/**\/*.view.json`, keyed by its authoring route. */
  views: { route: string; spec: ViewSpec; path: string }[];
  /** Every `pages/components/*.view.json`. */
  components: { name: string; def: ViewComponentSpec; path: string }[];
  /** `pages/_shell.view.json`, when the app declares one. */
  shell?: ShellSpec;
  /** Files that exist but did not parse — a finding, not a crash. */
  malformed: MalformedArtifact[];
}

/** Read + parse one JSON artifact, or record it as malformed. */
function readJson<T>(abs: string, rel: string, malformed: MalformedArtifact[]): T | undefined {
  try {
    return JSON.parse(readFileSync(abs, 'utf8')) as T;
  } catch (e) {
    malformed.push({ path: rel, message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` });
    return undefined;
  }
}

/** Collect every `*.view.json` under `pages/`, skipping the component dir and the shell. */
function walkViewFiles(pagesDir: string, dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      if (entry === VIEW_COMPONENT_DIR || entry === 'lib' || entry.startsWith('_') || entry.startsWith('.')) continue;
      walkViewFiles(pagesDir, abs, out);
      continue;
    }
    if (!entry.endsWith(VIEW_EXT) || entry.startsWith('_')) continue;
    out.push(abs);
  }
}

/** A view file's path back to its authoring route (`pages/recipes/[id].view.json` → `recipes/[id]`). */
export function routeOfViewFile(pagesDir: string, abs: string): string {
  return relative(pagesDir, abs).slice(0, -VIEW_EXT.length).split(sep).join('/');
}

/**
 * Load every view artifact a project has. Never throws: a missing `pages/` dir yields empty
 * lists, and an unparseable file lands in {@link LoadedViews.malformed} — an app-wide gate that
 * crashed on one bad file would report nothing at all about the other nineteen, which the
 * pipeline reads as "clean".
 */
export function loadProjectViews(projectRoot: string): LoadedViews {
  const malformed: MalformedArtifact[] = [];
  const pagesDir = join(projectRoot, 'pages');
  const views: LoadedViews['views'] = [];
  const components: LoadedViews['components'] = [];

  const files: string[] = [];
  if (existsSync(pagesDir)) walkViewFiles(pagesDir, pagesDir, files);
  for (const abs of files.sort()) {
    const rel = relative(projectRoot, abs).split(sep).join('/');
    const spec = readJson<ViewSpec>(abs, rel, malformed);
    if (spec) views.push({ route: routeOfViewFile(pagesDir, abs), spec, path: rel });
  }

  const compDir = join(pagesDir, VIEW_COMPONENT_DIR);
  if (existsSync(compDir)) {
    for (const entry of readdirSync(compDir).sort()) {
      if (!entry.endsWith(VIEW_EXT)) continue;
      const abs = join(compDir, entry);
      const rel = `pages/${VIEW_COMPONENT_DIR}/${entry}`;
      const def = readJson<ViewComponentSpec>(abs, rel, malformed);
      if (def) components.push({ name: entry.slice(0, -VIEW_EXT.length), def, path: rel });
    }
  }

  let shell: ShellSpec | undefined;
  const shellAbs = join(projectRoot, SHELL_SPEC_PATH);
  if (existsSync(shellAbs)) shell = readJson<ShellSpec>(shellAbs, SHELL_SPEC_PATH, malformed);

  return { views, components, shell, malformed };
}

/** Every authoring route that has a view spec — what the writers re-emit wrappers for. */
export function listViewRoutes(projectRoot: string): string[] {
  const pagesDir = join(projectRoot, 'pages');
  if (!existsSync(pagesDir)) return [];
  const files: string[] = [];
  walkViewFiles(pagesDir, pagesDir, files);
  return files.map((f) => routeOfViewFile(pagesDir, f)).sort();
}
