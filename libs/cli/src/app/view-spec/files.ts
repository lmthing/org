/**
 * **Where a view spec lives on disk** — the one module that knows the layout, so the writers
 * (`../authoring/globals.ts`), the app-wide validators (`./validate.ts`) and the pod's
 * spec-fetch route all agree without importing each other.
 *
 * ## The layout
 *
 * ```
 * views/<route>.view.json              a page spec          (authored)
 * views/<seg>/_layout.view.json        a NESTED LAYOUT      (authored, any depth)
 * components/<Name>.view.json          a view component def (authored, TOP LEVEL)
 * shell.view.json                      the app shell        (authored, TOP LEVEL)
 * ```
 *
 *  - **`views/` holds JSON and nothing else.** The prebuilt app shell fetches these specs directly,
 *    so a spec app has no generated React source or per-project bundle.
 *  - **`components/` and `shell.view.json` are top level.** They no longer need to hide from a page
 *    route walk because AppHost fetches them alongside the view specs.
 *  - **`_layout.view.json` nests.** A layout frames every route beneath its directory, which is
 *    what lets an entity's header and sub-nav be authored once for a family instead of repeated
 *    on every child page.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { ShellSpec, ViewComponentSpec, ViewLayoutSpec, ViewSpec } from './schema.js';

/** The extension that marks a view artifact. */
export const VIEW_EXT = '.view.json';

/** The spec directory. */
export const VIEWS_DIR = 'views';

/** The component directory — top level. */
export const COMPONENT_DIR = 'components';

/** The shell path. */
export const SHELL_SPEC_PATH = `shell${VIEW_EXT}`;

/** The basename that marks a nested layout. */
export const LAYOUT_BASENAME = `_layout${VIEW_EXT}`;

/** `recipes/[id]` → `views/recipes/[id].view.json`. The WRITE path. */
export function viewSpecPath(route: string): string {
  return join(VIEWS_DIR, `${route}${VIEW_EXT}`);
}

/** `trips/[tripId]` → `views/trips/[tripId]/_layout.view.json`. The WRITE path. */
export function viewLayoutPath(prefix: string): string {
  return join(VIEWS_DIR, prefix, LAYOUT_BASENAME);
}

/** `RecipeCard` → `components/RecipeCard.view.json`. The WRITE path. */
export function viewComponentPath(name: string): string {
  return join(COMPONENT_DIR, `${name}${VIEW_EXT}`);
}

/** One artifact that is on disk but could not be read as JSON. Reported, never thrown. */
export interface MalformedArtifact {
  /** Project-relative path. */
  path: string;
  message: string;
}

/** Everything a whole-app check (or the spec-fetch route) needs, read in one pass. */
export interface LoadedViews {
  /** Every page spec, keyed by its authoring route. */
  views: { route: string; spec: ViewSpec; path: string }[];
  /** Every nested layout, keyed by the route prefix it frames. */
  layouts: { prefix: string; spec: ViewLayoutSpec; path: string }[];
  /** Every view component def. */
  components: { name: string; def: ViewComponentSpec; path: string }[];
  /** The app shell, when the app declares one. */
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

/**
 * Collect every `*.view.json` under a spec dir, separating pages from layouts.
 *
 * A `_`-prefixed basename is skipped as a page — that rule predates layouts and is what kept the
 * v1 shell out of the route table — so `_layout.view.json` is picked up explicitly rather than by
 * relaxing it. Relaxing it would make every future `_`-prefixed artifact a route by default.
 */
function walkViewFiles(dir: string, out: { pages: string[]; layouts: string[] }): void {
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
      if (entry === COMPONENT_DIR || entry === 'lib' || entry.startsWith('_') || entry.startsWith('.')) continue;
      walkViewFiles(abs, out);
      continue;
    }
    if (!entry.endsWith(VIEW_EXT)) continue;
    if (entry === LAYOUT_BASENAME) {
      out.layouts.push(abs);
      continue;
    }
    if (entry.startsWith('_')) continue;
    out.pages.push(abs);
  }
}

/** A view file's path back to its authoring route (`views/recipes/[id].view.json` → `recipes/[id]`). */
export function routeOfViewFile(specDir: string, abs: string): string {
  return relative(specDir, abs).slice(0, -VIEW_EXT.length).split(sep).join('/');
}

/**
 * An authoring route → the pattern it is SERVED at: `index` collapses (`index` → `/`,
 * `recipes/index` → `/recipes`) and a `[param]` segment becomes `:param` (`recipes/[id]` →
 * `/recipes/:id`). The single source of truth for that mapping — the rebuild route list, the
 * check pipeline's `routes`, and the legacy page walker all go through here so a spec app and a
 * TSX app describe their routes identically.
 */
export function viewRoutePath(route: string): string {
  const segs = route.split('/').filter((s) => s.length > 0);
  if (segs[segs.length - 1] === 'index') segs.pop();
  return '/' + segs.map((s) => s.replace(/^\[(.+)\]$/, ':$1')).join('/');
}

/** A layout file's path back to the prefix it frames (`views/trips/[id]/_layout.view.json` → `trips/[id]`). */
export function prefixOfLayoutFile(specDir: string, abs: string): string {
  const rel = relative(specDir, abs).split(sep);
  return rel.slice(0, -1).join('/');
}

/** Which spec directories this project actually has. */
function specDirs(projectRoot: string): string[] {
  const abs = join(projectRoot, VIEWS_DIR);
  return existsSync(abs) ? [abs] : [];
}

/**
 * Load every view artifact a project has. Never throws: a missing spec dir yields empty lists,
 * and an unparseable file lands in {@link LoadedViews.malformed} — an app-wide gate that crashed
 * on one bad file would report nothing at all about the other nineteen, which the pipeline reads
 * as "clean".
 */
export function loadProjectViews(projectRoot: string): LoadedViews {
  const malformed: MalformedArtifact[] = [];
  const views: LoadedViews['views'] = [];
  const layouts: LoadedViews['layouts'] = [];
  const components: LoadedViews['components'] = [];
  const seenRoutes = new Set<string>();
  const seenPrefixes = new Set<string>();

  for (const specDir of specDirs(projectRoot)) {
    const found = { pages: [] as string[], layouts: [] as string[] };
    walkViewFiles(specDir, found);

    for (const abs of found.pages.sort()) {
      const rel = relative(projectRoot, abs).split(sep).join('/');
      const route = routeOfViewFile(specDir, abs);
      if (seenRoutes.has(route)) continue;
      const spec = readJson<ViewSpec>(abs, rel, malformed);
      if (spec) {
        seenRoutes.add(route);
        views.push({ route, spec, path: rel });
      }
    }

    for (const abs of found.layouts.sort()) {
      const rel = relative(projectRoot, abs).split(sep).join('/');
      const prefix = prefixOfLayoutFile(specDir, abs);
      if (seenPrefixes.has(prefix)) continue;
      const spec = readJson<ViewLayoutSpec>(abs, rel, malformed);
      if (spec) {
        seenPrefixes.add(prefix);
        layouts.push({ prefix, spec, path: rel });
      }
    }
  }

  const componentDir = join(projectRoot, COMPONENT_DIR);
  if (existsSync(componentDir)) {
    for (const entry of readdirSync(componentDir).sort()) {
      if (!entry.endsWith(VIEW_EXT)) continue;
      const name = entry.slice(0, -VIEW_EXT.length);
      const abs = join(componentDir, entry);
      const rel = relative(projectRoot, abs).split(sep).join('/');
      const def = readJson<ViewComponentSpec>(abs, rel, malformed);
      if (def) components.push({ name, def, path: rel });
    }
  }

  let shell: ShellSpec | undefined;
  const shellAbs = join(projectRoot, SHELL_SPEC_PATH);
  if (existsSync(shellAbs)) shell = readJson<ShellSpec>(shellAbs, SHELL_SPEC_PATH, malformed);

  return { views, layouts, components, shell, malformed };
}

/**
 * The layout chain for a route, OUTERMOST first.
 *
 * A layout frames a route when the route is inside its directory — `trips/[tripId]` frames
 * `trips/[tripId]/expenses` but not `trips/[tripId]` itself... except that it does: a layout's
 * own index page is the commonest child there is (`views/trips/[tripId]/index.view.json`), and it
 * arrives here as the route `trips/[tripId]/index`. Matching on the segment path rather than on a
 * string prefix is what keeps `trips/[tripId]` from also framing `trips/[tripId]-archive`.
 */
export function layoutChainFor(route: string, prefixes: readonly string[]): string[] {
  const segs = route.split('/');
  return prefixes
    .filter((prefix) => {
      const p = prefix.split('/');
      return p.length < segs.length + 1 && p.every((seg, i) => segs[i] === seg);
    })
    .sort((a, b) => a.split('/').length - b.split('/').length);
}
