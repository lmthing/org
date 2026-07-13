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

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { transformSync } from 'esbuild';
import { validateTableSchema, type TableSchema } from '@lmthing/core';

/**
 * Reject source that does not PARSE before it lands on disk. A live-project hook/event/api/page
 * write goes straight into the running project — an unparseable file (e.g. a model that emitted
 * literal `\n` escape sequences instead of newlines, so `hooks/<slug>.ts` is one line the loader
 * chokes on with `Syntax error "n"`) silently breaks the whole automation pipeline and can
 * destabilize the pod on the next load. Validating here turns that into an immediate `{ ok:false }`
 * the authoring agent SEES and retries — the same contract `writeProjectTable` already has via
 * `validateTableSchema`. Syntax-only (esbuild transform); undefined-identifier errors are a
 * typecheck concern, not a parse one. Found live in scenario 05 (every automator-authored hook
 * written with literal `\n`).
 */
function assertSourceParses(src: string, loader: 'ts' | 'tsx'): void {
  try {
    transformSync(src, { loader, format: 'esm', logLevel: 'silent' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`source failed to parse (write rejected — fix and retry): ${msg.split('\n')[0]}`);
  }
}

/**
 * The API routes a page source actually FETCHES — every `useApi('x')` / `useApiMutation('x')` /
 * `apiCall('x')` whose route is a literal first argument. This is the page's data: a page that
 * fetches nothing renders nothing (a `@app/runtime` page has no other way to reach the db).
 */
function fetchedRoutes(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/\b(?:useApi|useApiMutation|apiCall)\b/g)) {
    // Skip the generic (`useApi<{ items: Row[] }>(…)`) and take the first literal argument.
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const open = tail.indexOf('(');
    if (open < 0) continue;
    const lit = /^\(\s*['"`]([^'"`]+)['"`]/.exec(tail.slice(open));
    if (lit) out.add(lit[1]!);
  }
  return [...out];
}

/**
 * Guard a page OVERWRITE that would drop the page's data. Returns an error message when
 * `file` already exists, already fetches ≥1 API route, and `src` fetches none of them —
 * i.e. the replacement deletes every section the user could see. Returns `undefined`
 * (allowed) for a new page, for a page that fetched nothing anyway, or for a rewrite that
 * keeps at least one of the routes it had (a genuine edit/refactor, not a wipe).
 */
function wouldDropData(file: string, src: string): string | undefined {
  if (!existsSync(file)) return undefined;
  let before: string;
  try {
    before = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const had = fetchedRoutes(before);
  if (had.length === 0) return undefined;
  const now = fetchedRoutes(src);
  if (had.some((r) => now.includes(r))) return undefined;
  const rel = file.split(`${sep}pages${sep}`).pop() ?? file;
  return (
    `refusing to overwrite pages/${rel}: the page you are replacing fetches ${had.join(', ')} and the ` +
    `new source fetches ${now.length ? now.join(', ') : 'nothing'} — this DELETES the section(s) the user ` +
    `already has (they open the app to an empty page). Read it first — readProjectFile('pages/${rel}').content — ` +
    `and EXTEND it (keep its existing sections and ADD yours). Pass { replace: true } only if the user ` +
    `explicitly asked you to remove those sections.`
  );
}

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

/** Component names are PascalCase (`TripCard`, `FlightRow`) — the file basename is
 *  `<Name>.tsx` and the name is what a page imports/renders. Traversal-safe. */
const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

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
  /** Write `<projectRoot>/database/<name>.json` (a table schema) — the LIVE-project
   *  counterpart of the catalog's `writeTableSchema`. Optionally SEED initial `rows` at
   *  the same time (host-side insert after the db re-derives), so KNOWN data the user
   *  gave you to "move into the app" lands in one authoring pass — the `db` global is not
   *  injected until a table already exists, so an agent could not otherwise insert into a
   *  table it just created. */
  writeProjectTable: (name: string, schema: unknown, rows?: unknown[]) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/pages/<route>.tsx` (a React page) — the LIVE-project
   *  counterpart of the catalog's `writePage`. */
  writeProjectPage: (route: string, src: string, opts?: { replace?: boolean }) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/components/<Name>.tsx` (a shared React component a page imports).
   *  Name is PascalCase. There is no space-rooted fs writer for this — the typed writer IS
   *  the surface, so an app can gain shared components without any generic filesystem access. */
  writeProjectComponent: (name: string, src: string) => { ok: boolean; error?: string };
  /** Write `<projectRoot>/api/<path>/<METHOD>.ts` (a typed API handler) — the
   *  LIVE-project counterpart of the catalog's `writeApi`. */
  writeProjectApi: (route: string, src: string) => { ok: boolean; error?: string };
  /** List the files under `<projectRoot>/<dir>` (e.g. 'database', 'hooks', 'events') — the
   *  read-side twin of the writers. Project-rooted (NOT the space dir), so a delegated
   *  system-space agent can see the PROJECT's contents. Returns `entries: []` for a missing dir. */
  listProjectDir: (dir: string) => { ok: boolean; entries: string[]; error?: string };
  /** Read a project file's text (`<projectRoot>/<path>`). Project-rooted; the read twin of the
   *  writers, for inspecting an existing table schema / page / hook before editing it. */
  readProjectFile: (path: string) => { ok: boolean; content: string; error?: string };
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
  /** Called after a successful `writeProjectTable` — the host re-derives the project's
   *  db from `database/*.json` (a project with no tables has NO db at all, so the first
   *  table is what brings one into existence). When `rows` is passed, the host ALSO seeds
   *  those rows into the freshly-derived table (a project-authoring agent can't insert into
   *  a table it just created — `db` isn't injected until a table exists — so seeding is done
   *  host-side here). Fire-and-forget, like `republish`. */
  onSchemaWrite?: (table: string, rows?: unknown[]) => void;
  /** Called after a successful `writeProjectPage`/`writeProjectApi` — the host rebuilds
   *  the project's pages (so `/app/<id>/` serves the new UI) and drops any cached page-build
   *  or endpoint-contract state. Fire-and-forget, like `republish`. */
  onAppWrite?: (kind: 'page' | 'api' | 'component', route: string) => void;
}): ProjectAuthoringGlobals {
  const { projectRoot, republish, onSchemaWrite, onAppWrite } = opts;

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
      assertSourceParses(src, 'ts');
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    return writeUnder(join('hooks', `${slug}.ts`), src);
  }

  function writeProjectEvent(name: string, src: string): { ok: boolean; error?: string } {
    try {
      assertSlug('event name', name);
      assertSourceParses(src, 'ts');
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
    try {
      assertSourceParses(src, 'ts');
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    return writeUnder(join('functions', `${name}.ts`), src);
  }

  /**
   * Write a table schema into the LIVE project (`database/<name>.json`) and tell the
   * host to re-derive the project db.
   *
   * This is the live twin of the catalog `writeTableSchema`. Without it a project the
   * user is actually working in can never gain a data model: the catalog writer targets
   * `store/projects/<id>/` TEMPLATES, and `bootProjectApp()` returns `null` for a project
   * with no `database/*.json` — so "store every tip in a `tips` table" had nowhere to land
   * and every downstream hook had no `db` to write to. Found live in scenario 01.
   */
  function writeProjectTable(
    name: string,
    schema: unknown,
    rows?: unknown[],
  ): { ok: boolean; error?: string } {
    try {
      assertTableName(name);
      validateTableSchema(name, schema as TableSchema);
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    if (rows !== undefined && !Array.isArray(rows)) {
      return { ok: false, error: 'rows must be an array of row objects' };
    }
    const out = writeUnder(join('database', `${name}.json`), JSON.stringify(schema, null, 2) + '\n');
    if (out.ok) {
      try {
        // Pass the seed rows through: the host re-derives the db AND inserts them (the agent
        // can't — `db` isn't injected until a table exists). Undefined/empty rows just re-derive.
        onSchemaWrite?.(name, rows && rows.length ? rows : undefined);
      } catch {
        /* best-effort — the schema file already landed */
      }
    }
    return out;
  }

  /**
   * Write a React page into the LIVE project (`pages/<route>.tsx`) and tell the host to
   * rebuild the project's pages. The live twin of the catalog `writePage`: without it a
   * project the user is actually working in can gain a data model + automation
   * (writeProjectTable/Hook) but never a UI — "turn this into an app I can open" would
   * dead-end because the automator has only `writeProjectTable`, and an attempt to call a
   * page writer fails typecheck (found live in scenario 05: `Cannot find name
   * 'writeProjectPage'`). Route validation + `.tsx` normalization mirror the catalog writer.
   *
   * **Overwrites are guarded** (see {@link fetchedRoutes}). An app grows over its life: a
   * later "add an invoices section" turn that re-authors `pages/index.tsx` from scratch
   * silently DELETES the dashboard the user already had — the app still builds, every route
   * still 200s, and the user opens their vault to an empty page. Found live in scenario 07:
   * the home page came back as a stub linking to the newest section while `/vault-dashboard`
   * (which nothing fetched any more) still served the whole household. So: replacing a page
   * that fetches data with one that fetches NONE of it is rejected — the agent reads it and
   * extends it, or says it means it with `{ replace: true }`.
   */
  function writeProjectPage(
    route: string,
    src: string,
    opts?: { replace?: boolean },
  ): { ok: boolean; error?: string } {
    let rel: string;
    try {
      rel = assertPathSegments('page route', route);
      if (!rel.endsWith('.tsx')) rel = `${rel}.tsx`;
      assertSourceParses(src, 'tsx');
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    if (!opts?.replace) {
      const clobbered = wouldDropData(join(projectRoot, 'pages', rel), src);
      if (clobbered) return { ok: false, error: clobbered };
    }
    const out = writeUnder(join('pages', rel), src);
    if (out.ok) {
      try {
        onAppWrite?.('page', route);
      } catch {
        /* best-effort — the page file already landed */
      }
    }
    return out;
  }

  /**
   * Write a typed API handler into the LIVE project (`api/<path>/<METHOD>.ts`) and tell the
   * host to drop its cached endpoint contracts. The live twin of the catalog `writeApi`;
   * the route encodes its HTTP method last (`items-list/GET`). Path + method validation
   * mirror the catalog writer.
   */
  function writeProjectApi(route: string, src: string): { ok: boolean; error?: string } {
    let target: string;
    try {
      const rel = assertPathSegments('api route', route);
      const segments = rel.split('/');
      const method = segments.pop() as string;
      if (!METHODS.has(method)) {
        throw new Error(`api route "${route}" has an invalid method "${method}" (expected one of ${[...METHODS].join(', ')})`);
      }
      if (segments.length === 0) {
        throw new Error(`api route "${route}" is missing an endpoint path before the method`);
      }
      assertSourceParses(src, 'ts');
      target = join('api', ...segments, `${method}.ts`);
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    const out = writeUnder(target, src);
    if (out.ok) {
      try {
        onAppWrite?.('api', route);
      } catch {
        /* best-effort — the handler file already landed */
      }
    }
    return out;
  }

  /**
   * Write a shared React component into the LIVE project (`components/<Name>.tsx`) and tell the
   * host to rebuild the project's pages (a page may now import it). The typed twin of a page
   * writer for shared UI: without it an app-authoring agent that wants a reusable `<TripCard>`
   * had no typed writer and would have reached for the (now removed) space-rooted `writeFile`,
   * which mis-roots. `<Name>` is PascalCase; `.tsx` is enforced.
   */
  function writeProjectComponent(name: string, src: string): { ok: boolean; error?: string } {
    try {
      if (!COMPONENT_NAME_RE.test(name)) {
        throw new Error(`component name "${name}" is not PascalCase (expected /${COMPONENT_NAME_RE.source}/)`);
      }
      assertSourceParses(src, 'tsx');
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) };
    }
    const out = writeUnder(join('components', `${name}.tsx`), src);
    if (out.ok) {
      try {
        onAppWrite?.('component', name);
      } catch {
        /* best-effort — the component file already landed */
      }
    }
    return out;
  }

  /** List `<projectRoot>/<dir>` — project-rooted introspection (the read twin of the writers).
   *  A missing dir returns `entries: []` (not an error) so an agent can safely check "what tables
   *  exist?" on a fresh project. `safeResolve` keeps it inside the project (no traversal). */
  function listProjectDir(dir: string): { ok: boolean; entries: string[]; error?: string } {
    try {
      const target = safeResolve(projectRoot, dir || '.');
      if (!existsSync(target)) return { ok: true, entries: [] };
      if (!statSync(target).isDirectory()) return { ok: false, entries: [], error: `not a directory: ${dir}` };
      return { ok: true, entries: readdirSync(target).sort() };
    } catch (e) {
      return { ok: false, entries: [], error: String(e instanceof Error ? e.message : e) };
    }
  }

  /** Read `<projectRoot>/<path>` as UTF-8 text — project-rooted (the read twin of the writers). */
  function readProjectFile(path: string): { ok: boolean; content: string; error?: string } {
    try {
      const target = safeResolve(projectRoot, path);
      if (!existsSync(target)) return { ok: false, content: '', error: `no such file: ${path}` };
      return { ok: true, content: readFileSync(target, 'utf8') };
    } catch (e) {
      return { ok: false, content: '', error: String(e instanceof Error ? e.message : e) };
    }
  }

  return {
    writeProjectHook,
    writeProjectEvent,
    writeProjectFunction,
    writeProjectTable,
    writeProjectPage,
    writeProjectComponent,
    writeProjectApi,
    listProjectDir,
    readProjectFile,
  };
}
