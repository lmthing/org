/**
 * Phase 8A — the **admin/dev app-management surface** (`lmthing.studio`).
 *
 * Everything here lives under the RESERVED top-level `/api/projects/:projectId/app/*`
 * (the management surface Studio drives), NOT under the app's own runtime
 * `/app/<project>/api/*`. Five capabilities, each an exported mountable-handler
 * FACTORY (the pattern of {@link createAppApiHandler}/{@link createHookRunHandler} —
 * `(manager, lmthingRoot) => (req, res, params) => Promise<void>`); `serve.ts` mounts
 * them (the integrator's job):
 *
 *   1. {@link handleAppManifest}   GET   /api/projects/:projectId/app
 *   2. {@link handleGetAppFile}    GET   /api/projects/:projectId/app/files/*
 *      {@link handlePutAppFile}    PUT   /api/projects/:projectId/app/files/*
 *   3. {@link handleListRows}      GET   /api/projects/:projectId/app/data/:table
 *      {@link handleUpdateRow}     PATCH /api/projects/:projectId/app/data/:table/:id
 *   4. {@link handleBuildStatus}   GET   /api/projects/:projectId/app/build
 *      {@link handleRebuild}       POST  /api/projects/:projectId/app/build
 *
 * The engines (loader / schema-contracts / hooks / pages build / ProjectDb) are
 * reused verbatim — this module is thin routing + path-scoping + safety.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { readBody, sendJson } from './utils.js';
import { safeProjectId, isSafeRelPath } from '../projects.js';
import { loadProjectApp } from '../../app/loader.js';
import { generateProjectContracts } from '../../app/build/contracts.js';
import type { EndpointContract } from '../../app/build/schema.js';
import { loadHooks, loadHooksState, type LoadedHook } from '../../app/hooks/index.js';
import { buildProjectPages } from '../../app/build/pages.js';
import type { ProjectDb } from '../../app/store.js';

// ── Structural manager surface (satisfied by SessionManager; mockable in tests) ─

/** The minimal SessionManager surface 8A needs. `getProjectContracts` is optional
 *  (cache-friendly fast path); when absent we fall back to {@link generateProjectContracts}. */
export interface AppAdminManager {
  getProjectDb(root: string, projectId: string): Promise<ProjectDb | null>;
  getProjectContracts?(
    root: string,
    projectId: string,
  ): Promise<{ endpoints: EndpointContract[] } | null>;
}

type AppHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => Promise<void>;

// ── Path scoping ────────────────────────────────────────────────────────────

/** The app-layer directories that are siblings of `spaces/` (writable via app-file routes). */
const APP_DIRS = new Set(['database', 'pages', 'api', 'hooks', 'components', 'lib']);
/** Root files (no dir prefix) the app-file routes may touch. */
const ROOT_FILES = new Set(['package.json', 'tsconfig.json']);
/** Segments that are NEVER reachable: `.data/` (runtime state) + `types/` (generated). */
const BLOCKED_DIRS = new Set(['.data', 'types']);

interface ScopeOk {
  ok: true;
  abs: string;
  rel: string;
}
interface ScopeErr {
  ok: false;
  status: number;
  message: string;
}

/**
 * Vet + resolve an app-file path (`rest`) against a project root. PATH-SCOPED and
 * SAFE: rejects absolute/`..`/empty-segment paths (400), refuses anything under
 * `.data/` or `types/` (403), constrains reachable paths to the app dirs + a small
 * root-file allowlist (403), and finally verifies the resolved path stays inside
 * `projectRoot` (defense-in-depth traversal guard, 403).
 */
function scopeAppFile(projectRoot: string, rest: string): ScopeOk | ScopeErr {
  if (typeof rest !== 'string' || rest.length === 0) {
    return { ok: false, status: 400, message: 'file path required' };
  }
  if (!isSafeRelPath(rest)) {
    return { ok: false, status: 400, message: `unsafe file path: ${rest}` };
  }
  const segments = rest.split('/');
  const first = segments[0]!;
  if (BLOCKED_DIRS.has(first)) {
    return { ok: false, status: 403, message: `path under "${first}/" is not writable/readable via this route` };
  }
  if (segments.length === 1) {
    if (!ROOT_FILES.has(first)) {
      return { ok: false, status: 403, message: `root file "${first}" is not allowed (allowed: ${[...ROOT_FILES].join(', ')})` };
    }
  } else if (!APP_DIRS.has(first)) {
    return { ok: false, status: 403, message: `directory "${first}/" is not an app dir (allowed: ${[...APP_DIRS].join(', ')})` };
  }
  const abs = resolve(projectRoot, rest);
  const rootResolved = resolve(projectRoot);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) {
    return { ok: false, status: 403, message: 'path escapes the project root' };
  }
  return { ok: true, abs, rel: rest };
}

// ── 1. Manifest ─────────────────────────────────────────────────────────────

/**
 * `GET /api/projects/:projectId/app` — assemble the app manifest: tables (+schema),
 * pages, endpoints (name/method/route/IO schema), hooks (+ last-run state), and the
 * page-build status. Tolerates a spaces-only project → `hasApp:false` with empty
 * arrays. Never runs a heavy rebuild — reads cached/if-present state (endpoints via
 * the cache-friendly {@link generateProjectContracts}, guarded).
 */
export function handleAppManifest(manager: AppAdminManager, lmthingRoot: string | undefined): AppHandler {
  return async (_req, res, params) => {
    const projectId = params['projectId']!;
    if (!safeProjectId(projectId)) {
      sendJson(res, 400, { error: `invalid project id: ${projectId}` });
      return;
    }
    if (!lmthingRoot) {
      sendJson(res, 404, { error: 'no project root configured' });
      return;
    }
    const projectRoot = join(lmthingRoot, projectId);

    let app;
    try {
      app = await loadProjectApp(projectRoot);
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const tables = app.tables.map((t) => ({ name: t.name, schema: t.schema }));

    // Spaces-only project (e.g. the synthetic `system`) — no app layer.
    if (!app.hasApp) {
      sendJson(res, 200, {
        project: projectId,
        hasApp: false,
        tables: [],
        pages: [],
        endpoints: [],
        hooks: [],
        build: { built: false, assetCount: 0, stale: false },
      });
      return;
    }

    const [pages, api, hooks, build] = await Promise.all([
      app.hasPages ? discoverPageRoutes(projectRoot) : Promise.resolve([]),
      app.hasApi
        ? loadEndpoints(manager, lmthingRoot, projectId, projectRoot)
        : Promise.resolve<Awaited<ReturnType<typeof loadEndpoints>>>({ endpoints: [] }),
      app.hasHooks ? loadHookSummaries(projectRoot) : Promise.resolve([]),
      pagesBuildInfo(projectRoot),
    ]);

    sendJson(res, 200, {
      project: projectId,
      hasApp: true,
      tables,
      pages,
      endpoints: api.endpoints,
      // Present ONLY when the app HAS api handlers whose contracts could not be generated —
      // "zero endpoints" and "we failed to read your endpoints" are different facts.
      ...(api.error ? { endpointsError: api.error } : {}),
      hooks,
      build: { built: build.built, assetCount: build.assetCount, stale: build.stale },
    });
  };
}

/** Endpoint contracts, projected to the manifest shape. Prefers the manager's cached
 *  contracts; falls back to a guarded {@link generateProjectContracts}.
 *
 *  When contract generation FAILS this must not read as "the app has no API routes". It used to:
 *  the catch swallowed the error and returned `[]`, so an app whose `api/` dir is full of working
 *  handlers reported zero endpoints with a 200 — Studio shows no routes and a caller concludes the
 *  pages fetch nothing (seen live in scenario 07, one run apart from a run that listed six). The
 *  failure now travels with the manifest as `endpointsError`. */
async function loadEndpoints(
  manager: AppAdminManager,
  root: string,
  projectId: string,
  projectRoot: string,
): Promise<{
  endpoints: Array<{ name: string; method: string; routePath: string; inputSchema: unknown; outputSchema: unknown }>;
  error?: string;
}> {
  let contracts: EndpointContract[] = [];
  let error: string | undefined;
  try {
    const cached = manager.getProjectContracts
      ? await manager.getProjectContracts(root, projectId)
      : null;
    contracts = cached?.endpoints ?? (await generateProjectContracts(projectRoot)).endpoints;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.warn(`[app-manifest] ${projectId}: endpoint contracts failed to generate — ${error}`);
    contracts = [];
  }
  return {
    endpoints: contracts.map((e) => ({
      name: e.name,
      method: e.method,
      routePath: e.routePath,
      inputSchema: e.inputSchema,
      outputSchema: e.outputSchema,
    })),
    ...(error ? { error } : {}),
  };
}

/** Hooks + their last-run state, projected to the manifest shape. */
async function loadHookSummaries(projectRoot: string): Promise<
  Array<{
    slug: string;
    type?: string;
    on?: { table: string; event: string };
    every?: string;
    trigger?: string;
    lastRunAt?: number;
    lastFiredAt?: number;
    pending?: boolean;
  }>
> {
  let loaded: LoadedHook[] = [];
  try {
    loaded = await loadHooks(projectRoot);
  } catch {
    return [];
  }
  const state = await loadHooksState(projectRoot);
  return loaded.map((h) => {
    const def = h.def as {
      type?: string;
      on?: { table: string; event: string };
      every?: string;
      trigger?: string;
    };
    return {
      slug: h.slug,
      type: def.type,
      ...(def.on ? { on: def.on } : {}),
      ...(def.every ? { every: def.every } : {}),
      ...(def.trigger ? { trigger: def.trigger } : {}),
      ...(state.cron[h.slug] ? { lastRunAt: state.cron[h.slug]!.lastRunAt } : {}),
      ...(state.lastFiredAt[h.slug] !== undefined ? { lastFiredAt: state.lastFiredAt[h.slug] } : {}),
      pending: state.pending.includes(h.slug),
    };
  });
}

// ── 2. App-file routes ────────────────────────────────────────────────────────

/**
 * `GET /api/projects/:projectId/app/files/*` — read one app file (`{ path, content }`).
 * PATH-SCOPED via {@link scopeAppFile}; 404 when the file is absent.
 */
export function handleGetAppFile(_manager: AppAdminManager, lmthingRoot: string | undefined): AppHandler {
  return async (_req, res, params) => {
    const projectId = params['projectId']!;
    const rest = params['rest'] ?? '';
    if (!safeProjectId(projectId)) {
      sendJson(res, 400, { error: `invalid project id: ${projectId}` });
      return;
    }
    if (!lmthingRoot) {
      sendJson(res, 404, { error: 'no project root configured' });
      return;
    }
    const projectRoot = join(lmthingRoot, projectId);
    const scoped = scopeAppFile(projectRoot, rest);
    if (!scoped.ok) {
      sendJson(res, scoped.status, { error: scoped.message });
      return;
    }
    try {
      const content = await readFile(scoped.abs, 'utf8');
      sendJson(res, 200, { path: scoped.rel, content });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        sendJson(res, 404, { error: `file not found: ${scoped.rel}` });
      } else {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  };
}

/**
 * `PUT /api/projects/:projectId/app/files/*` — write EXACTLY one app file (mkdir -p
 * its parent). NEVER bulk-deletes a directory. PATH-SCOPED via {@link scopeAppFile}
 * (refuses `.data/`, `types/`, traversal, and non-app paths). Body is either JSON
 * `{ content }` or the raw request body. Returns `{ ok, bytes }`.
 */
export function handlePutAppFile(_manager: AppAdminManager, lmthingRoot: string | undefined): AppHandler {
  return async (req, res, params) => {
    const projectId = params['projectId']!;
    const rest = params['rest'] ?? '';
    if (!safeProjectId(projectId)) {
      sendJson(res, 400, { error: `invalid project id: ${projectId}` });
      return;
    }
    if (!lmthingRoot) {
      sendJson(res, 404, { error: 'no project root configured' });
      return;
    }
    const projectRoot = join(lmthingRoot, projectId);
    const scoped = scopeAppFile(projectRoot, rest);
    if (!scoped.ok) {
      sendJson(res, scoped.status, { error: scoped.message });
      return;
    }
    const raw = await readBody(req);
    let content: string;
    try {
      const parsed = JSON.parse(raw || '{}') as { content?: unknown };
      content = typeof parsed.content === 'string' ? parsed.content : raw;
    } catch {
      content = raw; // not JSON — treat the body itself as the file content
    }
    try {
      await mkdir(dirname(scoped.abs), { recursive: true });
      await writeFile(scoped.abs, content, 'utf8');
      sendJson(res, 200, { ok: true, bytes: Buffer.byteLength(content, 'utf8') });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

// ── 3. Data browser ─────────────────────────────────────────────────────────

/**
 * `GET /api/projects/:projectId/app/data/:table` — list rows with `limit`/`offset`
 * query-param paging. 404 when the project has no app db or `:table` is unknown.
 */
export function handleListRows(manager: AppAdminManager, lmthingRoot: string | undefined): AppHandler {
  return async (req, res, params) => {
    const projectId = params['projectId']!;
    const table = params['table']!;
    if (!safeProjectId(projectId)) {
      sendJson(res, 400, { error: `invalid project id: ${projectId}` });
      return;
    }
    if (!lmthingRoot) {
      sendJson(res, 404, { error: 'no project root configured' });
      return;
    }
    const pdb = await manager.getProjectDb(lmthingRoot, projectId);
    if (!pdb) {
      sendJson(res, 404, { error: `project "${projectId}" has no app database` });
      return;
    }
    if (!pdb.listTables().includes(table)) {
      sendJson(res, 404, { error: `unknown table: ${table}` });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const limit = parsePositiveInt(url.searchParams.get('limit'), 50);
    const offset = parsePositiveInt(url.searchParams.get('offset'), 0);
    try {
      const rows = pdb.db.query(table, { limit, offset });
      sendJson(res, 200, { table, rows, limit, offset });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

/**
 * `PATCH /api/projects/:projectId/app/data/:table/:id` — update the row whose `id`
 * matches, assigning the JSON body's fields. 404 for an unknown table; returns
 * `{ ok, updated }` (rows affected).
 */
export function handleUpdateRow(manager: AppAdminManager, lmthingRoot: string | undefined): AppHandler {
  return async (req, res, params) => {
    const projectId = params['projectId']!;
    const table = params['table']!;
    const id = params['id']!;
    if (!safeProjectId(projectId)) {
      sendJson(res, 400, { error: `invalid project id: ${projectId}` });
      return;
    }
    if (!lmthingRoot) {
      sendJson(res, 404, { error: 'no project root configured' });
      return;
    }
    const pdb = await manager.getProjectDb(lmthingRoot, projectId);
    if (!pdb) {
      sendJson(res, 404, { error: `project "${projectId}" has no app database` });
      return;
    }
    if (!pdb.listTables().includes(table)) {
      sendJson(res, 404, { error: `unknown table: ${table}` });
      return;
    }
    let set: Record<string, unknown>;
    try {
      const parsed = JSON.parse((await readBody(req)) || '{}') as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendJson(res, 400, { error: 'body must be an object of column/value pairs' });
        return;
      }
      set = parsed as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    try {
      const updated = pdb.db.update(table, { where: { id }, set });
      sendJson(res, 200, { ok: true, updated });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

// ── 4. Build status / rebuild ──────────────────────────────────────────────────

/**
 * `GET /api/projects/:projectId/app/build` — page-build status without rebuilding:
 * `{ built, stale, assetManifest? }`, read from `.data/pages-dist` + the page cache.
 */
export function handleBuildStatus(_manager: AppAdminManager, lmthingRoot: string | undefined): AppHandler {
  return async (_req, res, params) => {
    const projectId = params['projectId']!;
    if (!safeProjectId(projectId)) {
      sendJson(res, 400, { error: `invalid project id: ${projectId}` });
      return;
    }
    if (!lmthingRoot) {
      sendJson(res, 404, { error: 'no project root configured' });
      return;
    }
    const projectRoot = join(lmthingRoot, projectId);
    const info = await pagesBuildInfo(projectRoot);
    sendJson(res, 200, { built: info.built, stale: info.stale, assetManifest: info.assetManifest });
  };
}

/**
 * `POST /api/projects/:projectId/app/build` — force a page rebuild
 * ({@link buildProjectPages} with `force:true`) and return its result.
 */
export function handleRebuild(
  _manager: AppAdminManager,
  lmthingRoot: string | undefined,
  /** Drop the server's cached page bundle for this project. A forced rebuild emits NEW
   *  content-hashed assets, so any bundle cached from the previous build is stale: its manifest
   *  no longer contains the `entry-*.js` the fresh index.html asks for, the asset request falls
   *  through to the SPA shell (`text/html`), and the app renders BLANK. */
  onBuilt?: (projectId: string) => void,
): AppHandler {
  return async (_req, res, params) => {
    const projectId = params['projectId']!;
    if (!safeProjectId(projectId)) {
      sendJson(res, 400, { error: `invalid project id: ${projectId}` });
      return;
    }
    if (!lmthingRoot) {
      sendJson(res, 404, { error: 'no project root configured' });
      return;
    }
    const projectRoot = join(lmthingRoot, projectId);
    try {
      const result = await buildProjectPages(projectRoot, { force: true });
      onBuilt?.(projectId);
      sendJson(res, 200, {
        built: result.built,
        assetManifest: result.assetManifest,
        routes: result.routes.map((r) => ({ routePath: r.routePath, file: relFile(projectRoot, r.file) })),
      });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

// ── Read-only helpers (no build side effects) ────────────────────────────────

const PAGE_EXT = /\.(tsx|jsx)$/;

/** Walk `pages/` (skipping `components/`/`lib/`/`_`-prefixed) collecting `{ routePath,
 *  file }` — a light, read-only mirror of the page-build discovery, so the manifest
 *  lists routes WITHOUT triggering a rebuild. `file` is relative to the project root. */
async function discoverPageRoutes(projectRoot: string): Promise<Array<{ routePath: string; file: string }>> {
  const pagesDir = join(projectRoot, 'pages');
  const out: Array<{ routePath: string; file: string }> = [];
  await walkPages(pagesDir, pagesDir, out, projectRoot);
  out.sort((a, b) => a.routePath.localeCompare(b.routePath));
  return out;
}

async function walkPages(
  pagesRoot: string,
  dir: string,
  out: Array<{ routePath: string; file: string }>,
  projectRoot: string,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'components' || entry.name === 'lib' || entry.name.startsWith('_')) continue;
      await walkPages(pagesRoot, abs, out, projectRoot);
      continue;
    }
    if (!entry.isFile() || !PAGE_EXT.test(entry.name)) continue;
    if (entry.name.replace(PAGE_EXT, '').startsWith('_')) continue; // _app / _layout
    out.push({ routePath: pageRoutePath(pagesRoot, abs), file: relFile(projectRoot, abs) });
  }
}

/** Map a page file to its route pattern (`index` collapses; `[id]` → `:id`). */
function pageRoutePath(pagesRoot: string, file: string): string {
  const rel = relative(pagesRoot, file).replace(PAGE_EXT, '');
  const segs = rel.split(sep).filter((s) => s.length > 0);
  if (segs.length > 0 && segs[segs.length - 1] === 'index') segs.pop();
  const parts = segs.map((s) => {
    const m = /^\[(.+)\]$/.exec(s);
    return m ? `:${m[1]}` : s;
  });
  return '/' + parts.join('/');
}

interface PagesCache {
  hash: string;
  assetManifest: string[];
}

/**
 * Read-only page-build status: `built` (dist `index.html` present), `assetManifest`
 * + `assetCount` (from the page cache), and `stale` (the cached content hash no
 * longer matches the current `package.json`+`pages`/`components`/`lib` bytes, or
 * there is no built bundle). Mirrors the page build's own content-hash so no rebuild
 * is triggered.
 */
async function pagesBuildInfo(
  projectRoot: string,
): Promise<{ built: boolean; assetCount: number; stale: boolean; assetManifest: string[] }> {
  const pagesDir = join(projectRoot, 'pages');
  if (!(await dirExists(pagesDir))) {
    return { built: false, assetCount: 0, stale: false, assetManifest: [] };
  }
  const built = existsSync(join(projectRoot, '.data', 'pages-dist', 'index.html'));
  const cache = await readPagesCache(join(projectRoot, '.data', 'pages-cache.json'));
  const assetManifest = cache?.assetManifest ?? [];
  if (!cache) {
    return { built, assetCount: assetManifest.length, stale: true, assetManifest };
  }
  const fresh = await pagesSourceHash(projectRoot);
  const stale = !built || cache.hash !== fresh;
  return { built, assetCount: assetManifest.length, stale, assetManifest };
}

async function readPagesCache(cachePath: string): Promise<PagesCache | null> {
  try {
    return JSON.parse(await readFile(cachePath, 'utf8')) as PagesCache;
  } catch {
    return null;
  }
}

/** Content hash of everything that affects the page bundle (mirrors pages.ts). */
async function pagesSourceHash(projectRoot: string): Promise<string> {
  const hash = createHash('sha256');
  const pkg = join(projectRoot, 'package.json');
  if (existsSync(pkg)) hash.update('package.json\0').update(await readFile(pkg));
  for (const sub of ['pages', 'components', 'lib']) {
    const files = (await listFiles(join(projectRoot, sub))).sort();
    for (const f of files) {
      hash.update(relative(projectRoot, f).split(sep).join('/')).update('\0').update(await readFile(f));
    }
  }
  return hash.digest('hex');
}

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

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function relFile(projectRoot: string, abs: string): string {
  return relative(projectRoot, abs).split(sep).join('/');
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
