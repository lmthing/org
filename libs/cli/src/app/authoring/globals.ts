/**
 * Phase 9 **app-authoring globals** — the host-side (CLI) impls behind the
 * `AppGlobalImpls` `writePage`/`writeApi`/`writeHook`/`writeTableSchema`/
 * `createProject`/`selectProject` fields (`libs/core/src/exec/app-globals.ts`).
 *
 * These are pure, SYNCHRONOUS, validated file-writers into a `store/projects/<id>/`
 * catalog-source template (see {@link resolveCatalogRoot}). Authoring never
 * builds/migrates/installs the app — that ("apply") happens later, at
 * install+boot time, from the written source. A writer here does exactly one
 * thing: validate the input, write ONE file (creating its parent dirs), and
 * return `{ ok, error? }` — never a bulk delete, never a build step.
 *
 * Core only INJECTS these onto a VM for an agent holding the matching
 * authoring capability (`pages:write`/`api:write`/`hooks:write`/`db:schema`/
 * `project:manage`); THING and ordinary agents have none of those, so it is
 * harmless to always construct and pass this object through `appGlobals` —
 * it is simply never exposed to a capability-less agent.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { validateTableSchema, type TableSchema } from '@lmthing/core';

export interface AppAuthoringGlobals {
  writePage: (route: string, src: string) => { ok: boolean; error?: string };
  writeApi: (route: string, src: string) => { ok: boolean; error?: string };
  writeHook: (slug: string, src: string) => { ok: boolean; error?: string };
  writeTableSchema: (name: string, schema: unknown) => { ok: boolean; error?: string };
  createProject: (id: string, opts?: { title?: string }) => { ok: boolean; appId?: string; root?: string; error?: string };
  selectProject: (id: string) => { ok: boolean; appId?: string; root?: string; error?: string };
  /** For tests/inspection: the currently-selected authoring app, if any. */
  currentApp(): { id: string; root: string } | undefined;
}

/** Project ids and hook slugs are a lowercase kebab-slug: letters/digits/hyphen,
 *  must start with a letter. No dots, no slashes — traversal is structurally
 *  impossible in a value that matches this. */
const SLUG_RE = /^[a-z][a-z0-9-]*$/;

/** Table names are snake_case: letters/digits/UNDERSCORE, starting with a letter.
 *  Table names are used verbatim in `CREATE TABLE <name>` (unquoted), so hyphens
 *  are disallowed (they would need quoting) but underscores — the universal db
 *  convention every `database/*.json` uses (`feed_items`, `raw_items`) — are
 *  required. Still traversal-safe (no dots/slashes). */
const TABLE_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Function names are JS identifiers (camelCase like `slackPostMessage`), not
 *  kebab-slugs — the file basename becomes the function's callable name. Still
 *  traversal-safe (no dots/slashes). */
const FUNCTION_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** A single page/api path segment: letters/digits/hyphen/underscore, optionally
 *  wrapped in `[...]` for a dynamic route segment (e.g. `[id]`). */
const SEGMENT_RE = /^\[?[a-zA-Z0-9_-]+\]?$/;

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function assertSlug(kind: string, value: string): void {
  if (!SLUG_RE.test(value)) {
    throw new Error(`${kind} "${value}" is not a valid slug (expected /${SLUG_RE.source}/)`);
  }
}

/** Table names are snake_case (underscores), unlike kebab-case ids/hook slugs. */
function assertTableName(value: string): void {
  if (!TABLE_NAME_RE.test(value)) {
    throw new Error(`table name "${value}" is not a valid snake_case name (expected /${TABLE_NAME_RE.source}/)`);
  }
}

/** Validate a `/`-separated path made of {@link SEGMENT_RE} segments (rejects
 *  empty segments, `..`, and anything else that isn't a plain path/dynamic
 *  segment) and return the normalized (leading-slash-stripped) path. */
function assertPathSegments(kind: string, route: string): string {
  let r = route.trim();
  if (r.startsWith('/')) r = r.slice(1);
  const segments = r.split('/');
  if (segments.length === 0 || segments.some((s) => s.length === 0)) {
    throw new Error(`${kind} "${route}" has an empty path segment`);
  }
  for (const s of segments) {
    if (s === '..' || s === '.' || !SEGMENT_RE.test(s)) {
      throw new Error(`${kind} "${route}" has an invalid path segment "${s}"`);
    }
  }
  return segments.join('/');
}

/** Resolve `relPath` under `root`, throwing if the resolved path escapes `root`
 *  (defense-in-depth traversal guard, on top of the segment validation above). */
function safeResolve(root: string, relPath: string): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relPath);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + sep)) {
    throw new Error(`path traversal rejected: "${relPath}"`);
  }
  return target;
}

/** Write `contents` to `absPath`, creating parent dirs as needed. */
function writeFile(absPath: string, contents: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, contents, 'utf8');
}

/**
 * Build the app-authoring globals bound to a single `catalogRoot`
 * (`<monorepoRoot>/store/projects`). Holds ONE piece of mutable state — the
 * currently-selected authoring app — shared across every call made through
 * this instance (a SessionManager caches one instance so a delegation tree
 * within it shares `currentApp`).
 */
export function createAppAuthoringGlobals(opts: { catalogRoot: string }): AppAuthoringGlobals {
  const { catalogRoot } = opts;
  let current: { id: string; root: string } | undefined;

  function requireCurrent(): { id: string; root: string } {
    if (!current) {
      throw new Error('no project selected — call createProject/selectProject first');
    }
    return current;
  }

  function createProject(id: string, opts?: { title?: string }): { ok: boolean; appId?: string; root?: string; error?: string } {
    try {
      assertSlug('project id', id);
      if (id === 'system') {
        throw new Error('project id "system" is reserved');
      }
      const root = safeResolve(catalogRoot, id);
      if (existsSync(root)) {
        throw new Error(`project "${id}" already exists at ${root}`);
      }
      mkdirSync(root, { recursive: true });
      for (const dir of ['database', 'pages', 'api', 'hooks', 'components', 'lib']) {
        mkdirSync(join(root, dir), { recursive: true });
      }
      const pkg = {
        name: `@app/${id}`,
        private: true,
        type: 'module',
        version: '0.0.0',
      };
      writeFile(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
      const project = {
        id,
        title: opts?.title ?? id,
        createdAt: new Date().toISOString(),
      };
      writeFile(join(root, 'project.json'), JSON.stringify(project, null, 2) + '\n');
      current = { id, root };
      return { ok: true, appId: id, root };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
  }

  function selectProject(id: string): { ok: boolean; appId?: string; root?: string; error?: string } {
    try {
      assertSlug('project id', id);
      const root = safeResolve(catalogRoot, id);
      if (!existsSync(root)) {
        throw new Error(`project "${id}" does not exist at ${root}`);
      }
      current = { id, root };
      return { ok: true, appId: id, root };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
  }

  function writeTableSchema(name: string, schema: unknown): { ok: boolean; error?: string } {
    try {
      const { root } = requireCurrent();
      assertTableName(name);
      validateTableSchema(name, schema as TableSchema);
      const target = safeResolve(root, join('database', `${name}.json`));
      writeFile(target, JSON.stringify(schema, null, 2) + '\n');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
  }

  function writePage(route: string, src: string): { ok: boolean; error?: string } {
    try {
      const { root } = requireCurrent();
      let rel = assertPathSegments('page route', route);
      if (!rel.endsWith('.tsx')) rel = `${rel}.tsx`;
      const target = safeResolve(root, join('pages', rel));
      writeFile(target, src);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
  }

  function writeApi(route: string, src: string): { ok: boolean; error?: string } {
    try {
      const { root } = requireCurrent();
      const rel = assertPathSegments('api route', route);
      const segments = rel.split('/');
      const method = segments.pop() as string;
      if (!METHODS.has(method)) {
        throw new Error(`api route "${route}" has an invalid method "${method}" (expected one of ${[...METHODS].join(', ')})`);
      }
      if (segments.length === 0) {
        throw new Error(`api route "${route}" is missing an endpoint path before the method`);
      }
      const target = safeResolve(root, join('api', ...segments, `${method}.ts`));
      writeFile(target, src);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
  }

  function writeHook(slug: string, src: string): { ok: boolean; error?: string } {
    try {
      const { root } = requireCurrent();
      assertSlug('hook slug', slug);
      const target = safeResolve(root, join('hooks', `${slug}.ts`));
      writeFile(target, src);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
  }

  return {
    writePage,
    writeApi,
    writeHook,
    writeTableSchema,
    createProject,
    selectProject,
    currentApp: () => current,
  };
}

/** The plan-S11 LIVE-PROJECT authoring writers — the `hooks:write`-gated globals that
 *  the automator (event hooks + emitter defs) and engineer (project functions) call. */
export interface ProjectAuthoringGlobals {
  /** Write `<projectRoot>/hooks/<slug>.ts` (an event/cron hook def). */
  writeProjectHook: (slug: string, src: string) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/events/<name>.ts` (an emitter def). */
  writeProjectEvent: (name: string, src: string) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/functions/<name>.ts` (a project function). */
  writeProjectFunction: (name: string, src: string) => { ok: boolean; error?: string };
}

/**
 * Build the LIVE-PROJECT authoring writers (plan S11). Unlike
 * {@link createAppAuthoringGlobals} — which targets `store/projects/<id>/` catalog
 * TEMPLATES and carries a mutable createProject/selectProject "current app" — these
 * are bound to ONE fixed live project root (`<lmthingRoot>/<projectId>`) and write
 * directly into the running project's `hooks/`, `events/`, and `functions/` dirs.
 *
 * After a successful write each calls `republish` (fire-and-forget — the writers are
 * SYNCHRONOUS host globals, so they cannot await the async re-publish) so the new
 * event hook / emitter def / crontab entry goes live WITHOUT a pod restart. The write
 * itself has already landed on disk when the writer returns `{ ok: true }`; the
 * republish only re-derives the pod's published artifacts (webhook manifest + crontab
 * + emitter scan cache) from that source.
 *
 * Path safety reuses the same slug/name validation + `safeResolve` traversal guard as
 * the catalog writers (names are a kebab-slug — no dots, no slashes — and the resolved
 * path must stay under the project root).
 */
export function createProjectAuthoringGlobals(opts: {
  projectRoot: string;
  republish?: () => void;
}): ProjectAuthoringGlobals {
  const { projectRoot, republish } = opts;

  /** Write `rel` under the project root, then fire the republish (best-effort). */
  function writeUnder(rel: string, src: string): { ok: boolean; error?: string } {
    try {
      const target = safeResolve(projectRoot, rel);
      writeFile(target, src);
      // Fire-and-forget: a republish failure must not fail the write (the file is
      // already on disk; the next boot picks it up even if the live re-derive throws).
      try {
        republish?.();
      } catch {
        /* best-effort — the write itself succeeded */
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
  }

  function writeProjectHook(slug: string, src: string): { ok: boolean; error?: string } {
    try {
      assertSlug('hook slug', slug);
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    return writeUnder(join('hooks', `${slug}.ts`), src);
  }

  function writeProjectEvent(name: string, src: string): { ok: boolean; error?: string } {
    try {
      assertSlug('event name', name);
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    return writeUnder(join('events', `${name}.ts`), src);
  }

  function writeProjectFunction(name: string, src: string): { ok: boolean; error?: string } {
    if (!FUNCTION_NAME_RE.test(name)) {
      return {
        ok: false,
        error: `function name "${name}" is not a valid identifier (expected /${FUNCTION_NAME_RE.source}/)`,
      };
    }
    return writeUnder(join('functions', `${name}.ts`), src);
  }

  return { writeProjectHook, writeProjectEvent, writeProjectFunction };
}
