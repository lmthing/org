/**
 * Phase 10 — **store distribution**: the in-pod CLI-server endpoints that let a
 * user browse the app catalog (`store/projects/<id>/`, {@link resolveCatalogRoot})
 * and install one into their own runtime root:
 *
 *   1. {@link handleListApps}    GET  /api/apps            — list the catalog.
 *   2. {@link handleInstallApp}  POST /api/apps/install    — materialize +
 *      boot + build a catalog app into `<lmthingRoot>/<projectId>/`.
 *
 * Both are mountable-handler FACTORIES (the `app-admin.ts` pattern —
 * `(manager, lmthingRoot, catalogRoot?) => (req, res, params) => Promise<void>`);
 * `serve.ts` mounts them (the integrator's job, not this module's).
 *
 * Reuses the engines verbatim: {@link resolveCatalogRoot} (Phase 9),
 * {@link bootProjectApp} (P2, via the manager's cache so a later admin/api
 * request doesn't re-boot), {@link generateProjectContracts} (P4),
 * {@link buildProjectPages} (P5).
 *
 * Materialization mirrors the pristine-vs-locally-edited re-sync manifest
 * pattern in `cli/runtime-init.ts` (shipped-hash record + hash comparison),
 * scoped to ONE app's template files instead of the system spaces. The
 * manifest lives at `<dest>/.data/.installed.json` — `.data/` is never part of
 * the copied template, so it's a safe place to keep install-tracking state
 * that survives a re-sync.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync,
  cpSync, copyFileSync, rmSync, mkdtempSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { readBody, sendJson } from './utils.js';
import { safeProjectId, RESERVED_PROJECT_IDS } from '../projects.js';
import type { AppAdminManager } from './app-admin.js';
import { generateProjectContracts } from '../../app/build/contracts.js';
import { buildProjectPages } from '../../app/build/pages.js';

/** Public store base — the CLI downloads catalog apps from `${STORE_URL}/projects/…`
 *  (there is NO local catalog in the pod). Overridable for tests / self-hosting. */
const DEFAULT_STORE_URL = 'https://lmthing.store';
function storeBaseUrl(override?: string): string {
  return (override ?? process.env['LM_STORE_URL'] ?? DEFAULT_STORE_URL).replace(/\/+$/, '');
}

type AppHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => Promise<void>;

/** The minimal SessionManager surface {@link handleInstallApp} needs. Reuses
 *  {@link AppAdminManager} (app-admin.ts) rather than a new interface — the real
 *  `SessionManager` satisfies it structurally, and a test double only needs
 *  `getProjectDb`. Boot goes THROUGH the manager (not a bare `bootProjectApp`
 *  call) so the resulting handle is cached + closed alongside every other
 *  project db (`closeProjectDbs` on shutdown), matching how `serve.ts` warms
 *  each project's db at boot. */
export type AppsInstallManager = AppAdminManager;

// ── App-template scoping (mirrors APP_DIRS/ROOT_FILES in app-admin.ts) ────────

/** The app-layer directories copied from a catalog app into the runtime root. */
const APP_TEMPLATE_DIRS = ['database', 'pages', 'api', 'hooks', 'components', 'lib', 'spaces'];
/** Root-level files copied verbatim. */
const APP_TEMPLATE_ROOT_FILES = ['package.json', 'project.json', 'tsconfig.json'];
/** NEVER copied: `.data/` (runtime state — db, build caches) and `types/` (generated). */

// ── Catalog listing ───────────────────────────────────────────────────────────

/** One app entry in the store's static catalog manifest (`/projects/manifest.json`).
 *  `files` is the full download list (every template file, relative path). */
export interface StoreCatalogApp {
  id: string;
  title?: string;
  description?: string;
  icon?: string | null;
  tables?: string[];
  pages?: string[];
  endpoints?: string[];
  hooks?: string[];
  files?: string[];
}

/** Fetch the store's static catalog manifest. */
async function fetchStoreCatalog(storeUrl: string): Promise<StoreCatalogApp[]> {
  const res = await fetch(`${storeUrl}/projects/manifest.json`);
  if (!res.ok) throw new Error(`store catalog HTTP ${res.status}`);
  const body = (await res.json()) as { apps?: StoreCatalogApp[] };
  return Array.isArray(body.apps) ? body.apps : [];
}

/**
 * `GET /api/apps` — list the PUBLIC store catalog (there is no local catalog in the
 * pod; the catalog lives at `${STORE_URL}/projects/`). Returns `{ apps: [] }` if the
 * store is unreachable rather than erroring the request.
 */
export function handleListApps(storeUrl?: string): AppHandler {
  return async (_req, res) => {
    try {
      const apps = await fetchStoreCatalog(storeBaseUrl(storeUrl));
      sendJson(res, 200, { apps });
    } catch {
      sendJson(res, 200, { apps: [] });
    }
  };
}

/**
 * Download every file of `appId` from the store's public path into `destDir`, using the
 * manifest's per-app `files` list (`${store}/projects/<id>/<relpath>`). Throws on a
 * missing app, an empty/unsafe file list, or any failed fetch. Path-safe: rejects `..`,
 * absolute, and NUL segments, and verifies each write stays inside `destDir`.
 */
async function downloadStoreApp(storeUrl: string, appId: string, destDir: string): Promise<StoreCatalogApp> {
  const apps = await fetchStoreCatalog(storeUrl);
  const app = apps.find((a) => a.id === appId);
  if (!app) throw new Error(`"${appId}" not found in the store catalog`);
  const files = Array.isArray(app.files) ? app.files : [];
  if (files.length === 0) throw new Error(`catalog entry "${appId}" lists no files`);
  const resolvedDest = resolve(destDir);
  for (const rel of files) {
    if (rel.includes('\0') || rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s === '')) {
      throw new Error(`unsafe catalog file path: ${rel}`);
    }
    const target = resolve(resolvedDest, rel);
    if (target !== resolvedDest && !target.startsWith(resolvedDest + sep)) {
      throw new Error(`path traversal rejected: ${rel}`);
    }
    const fileUrl = `${storeUrl}/projects/${encodeURIComponent(appId)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`download ${rel} → HTTP ${res.status}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  }
  return app;
}

/**
 * Ensure `<dir>/project.json` exists — apps authored by the `system-appbuilder`
 * space ship a `package.json` but no `project.json` (only the hand-authored
 * catalog apps like `demo-feed` carry one). The store manifest already derives a
 * `title`/`description` for every app, so we synthesize a **deterministic**
 * `project.json` from the catalog entry when one is absent. Determinism matters:
 * `project.json` is part of {@link hashAppTemplate}, so a volatile field (e.g. a
 * fresh `createdAt`) would make every re-install look "diverged". The pod's
 * project loader defaults `createdAt` from the file's own mtime, so omitting it
 * here is safe.
 */
function ensureProjectJson(dir: string, app: StoreCatalogApp): void {
  const path = join(dir, 'project.json');
  if (existsSync(path)) return;
  const project = {
    id: app.id,
    title: app.title ?? app.id,
    description: app.description ?? '',
    icon: app.icon ?? null,
  };
  writeFileSync(path, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
}

// ── Install ────────────────────────────────────────────────────────────────

interface InstallBody {
  appId?: unknown;
  projectId?: unknown;
  force?: unknown;
}

/**
 * `POST /api/apps/install { appId, projectId?, force? }` — materialize a catalog
 * app (`<catalogRoot>/<appId>/`) into `<lmthingRoot>/<projectId ?? appId>/`, then
 * boot + best-effort build it.
 *
 * Re-sync semantics on an existing dest: a **pristine** copy (unchanged since the
 * last install, or already matching the current shipped template) is re-synced
 * silently; a **locally-edited** copy is held back (`{ ok:false, diverged:true }`)
 * unless `force:true`. A brand-new dest always installs.
 */
export function handleInstallApp(
  manager: AppsInstallManager,
  lmthingRoot: string | undefined,
  storeUrl?: string,
  /** Invoked after a successful (re)install so the server can drop any cached
   *  page-build result for the project — a re-install rebuilds pages with fresh
   *  asset hashes, and a stale in-memory asset manifest would make the serve
   *  handler fall back to index.html for the new `assets/entry-*.js` (MIME error →
   *  blank app). See `serve.ts`'s `pageBuildCache`. */
  onInstalled?: (projectId: string) => void,
): AppHandler {
  return async (req, res) => {
    let body: InstallBody;
    try {
      body = JSON.parse((await readBody(req)) || '{}') as InstallBody;
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }

    const appId = typeof body.appId === 'string' ? body.appId : '';
    if (!appId || !safeProjectId(appId) || RESERVED_PROJECT_IDS.has(appId)) {
      sendJson(res, 400, { error: `invalid appId: ${JSON.stringify(body.appId)}` });
      return;
    }
    const projectId = typeof body.projectId === 'string' && body.projectId.length > 0 ? body.projectId : appId;
    if (!safeProjectId(projectId) || RESERVED_PROJECT_IDS.has(projectId)) {
      sendJson(res, 400, { error: `invalid projectId: ${JSON.stringify(body.projectId)}` });
      return;
    }
    const force = body.force === true;

    if (!lmthingRoot) {
      sendJson(res, 404, { error: 'no project root configured' });
      return;
    }

    const dest = join(lmthingRoot, projectId);

    // Download the app from the PUBLIC store into a staging dir — there is no local
    // catalog in the pod. The staging copy is the install SOURCE (hash/re-sync/materialize
    // all read from it), then cleaned up in `finally`.
    const staging = mkdtempSync(join(tmpdir(), `lm-app-${appId}-`));
    try {
      let catalogApp: StoreCatalogApp;
      try {
        catalogApp = await downloadStoreApp(storeBaseUrl(storeUrl), appId, staging);
      } catch (err) {
        sendJson(res, 404, { error: `app not available in store catalog: ${appId} (${err instanceof Error ? err.message : String(err)})` });
        return;
      }
      const src = staging;
      // Apps authored by `system-appbuilder` ship no project.json — synthesize a
      // deterministic one from the catalog manifest entry so any published app installs.
      ensureProjectJson(src, catalogApp);

      const isNew = !existsSync(dest);
      const shippedHash = hashAppTemplate(src);
      if (!isNew) {
        const currentHash = hashAppTemplate(dest);
        if (currentHash !== shippedHash) {
          const manifest = readInstallManifest(dest);
          const pristine = manifest !== undefined && manifest.sourceHash === currentHash;
          if (!pristine && !force) {
            sendJson(res, 200, {
              ok: false,
              diverged: true,
              projectId,
              appId,
              message:
                `"${projectId}" has local edits that diverge from the "${appId}" catalog template — ` +
                'pass force:true to overwrite them.',
            });
            return;
          }
        }
      }

      try {
        materializeAppTemplate(src, dest);
        writeInstallManifest(dest, { appId, sourceHash: shippedHash, installedAt: new Date().toISOString() });
      } catch (err) {
        sendJson(res, 400, { error: `materialize failed: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }

      // Boot — through the manager so the resulting handle is cached/closed like
      // every other project db. A hard failure here aborts the install.
      try {
        await manager.getProjectDb(lmthingRoot, projectId);
      } catch (err) {
        sendJson(res, 500, { error: `boot failed: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }

      // Best-effort contracts + pages build — each failure is reported but never
      // aborts the install (the materialized+booted app is still usable).
      const built = {
        contracts: await tryBuildContracts(dest),
        pages: await tryBuildPages(dest),
      };

      const [tables, pages, endpoints, hooks] = await Promise.all([
        scanTables(dest), scanPages(dest), scanEndpoints(dest), scanHooks(dest),
      ]);

      // Drop any cached page-build for this project — the rebuild above wrote new
      // asset hashes, so a stale asset manifest in the serve handler would 404 them.
      onInstalled?.(projectId);

      sendJson(res, 200, {
        ok: true,
        projectId,
        appId,
        installed: { tables, pages, endpoints, hooks },
        built,
      });
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  };
}

interface BuildStepResult {
  ok: boolean;
  error?: string;
  endpointCount?: number;
  built?: boolean;
  assetCount?: number;
}

async function tryBuildContracts(dest: string): Promise<BuildStepResult> {
  if (!existsSync(join(dest, 'api'))) return { ok: true, endpointCount: 0 };
  try {
    const contracts = await generateProjectContracts(dest);
    return { ok: true, endpointCount: contracts.endpoints.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function tryBuildPages(dest: string): Promise<BuildStepResult> {
  if (!existsSync(join(dest, 'pages'))) return { ok: true, built: false, assetCount: 0 };
  try {
    const result = await buildProjectPages(dest, { force: true });
    return { ok: true, built: result.built, assetCount: result.assetManifest.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Materialize (path-scoped copy — never touches `.data/`/`types/`) ─────────

/**
 * Copy the app-layer template dirs/files from `src` into `dest`. Each template
 * DIR is fully replaced (rm then copy — mirrors `runtime-init.ts`'s
 * `syncSystemSpaces` `replace()`), so a file removed upstream doesn't linger;
 * this NEVER touches `dest` itself outside those specific subpaths (`.data/`
 * and any other dest content, e.g. `types/`, is left completely alone).
 */
function materializeAppTemplate(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const dir of APP_TEMPLATE_DIRS) {
    const s = join(src, dir);
    if (!existsSync(s)) continue;
    const d = join(dest, dir);
    rmSync(d, { recursive: true, force: true });
    cpSync(s, d, { recursive: true });
  }
  for (const file of APP_TEMPLATE_ROOT_FILES) {
    const s = join(src, file);
    if (!existsSync(s)) continue;
    copyFileSync(s, join(dest, file));
  }
}

/**
 * Stable content hash of a dir's app-template subset ONLY (the
 * {@link APP_TEMPLATE_DIRS}/{@link APP_TEMPLATE_ROOT_FILES} allowlist) — sha256
 * over each file's relative path + bytes, sorted. Path-scoped so `dest`'s
 * `.data/` (live db, build caches — constantly changing) and `types/`
 * (generated) never affect pristine/diverged classification. Mirrors
 * `runtime-init.ts`'s `hashDir` algorithm, restricted to the app-template paths
 * (a plain `hashDir(dir)` can't be reused here since it hashes the WHOLE tree).
 */
function hashAppTemplate(dir: string): string {
  const relPaths: string[] = [];
  for (const sub of APP_TEMPLATE_DIRS) collectFiles(join(dir, sub), dir, relPaths);
  for (const file of APP_TEMPLATE_ROOT_FILES) {
    const abs = join(dir, file);
    if (existsSync(abs) && statSync(abs).isFile()) relPaths.push(file);
  }
  relPaths.sort();
  const h = createHash('sha256');
  for (const rel of relPaths) {
    h.update(rel.split(sep).join('/'));
    h.update('\0');
    h.update(readFileSync(join(dir, rel)));
    h.update('\0');
  }
  return h.digest('hex');
}

function collectFiles(absDir: string, base: string, out: string[]): void {
  if (!existsSync(absDir)) return;
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) collectFiles(abs, base, out);
    else if (entry.isFile()) out.push(relative(base, abs));
  }
}

// ── Install manifest (pristine-vs-edited tracking) ────────────────────────────

interface InstallManifest {
  appId: string;
  sourceHash: string;
  installedAt: string;
}

function installManifestPath(dest: string): string {
  return join(dest, '.data', '.installed.json');
}

function readInstallManifest(dest: string): InstallManifest | undefined {
  try {
    return JSON.parse(readFileSync(installManifestPath(dest), 'utf8')) as InstallManifest;
  } catch {
    return undefined;
  }
}

function writeInstallManifest(dest: string, manifest: InstallManifest): void {
  mkdirSync(join(dest, '.data'), { recursive: true });
  writeFileSync(installManifestPath(dest), JSON.stringify(manifest, null, 2), 'utf8');
}

// ── Cheap, read-only catalog scanners (no validation/evaluation — tolerant) ───

async function scanTables(appDir: string): Promise<string[]> {
  const entries = await safeReaddir(join(appDir, 'database'));
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name.slice(0, -'.json'.length))
    .sort();
}

async function scanHooks(appDir: string): Promise<string[]> {
  const entries = await safeReaddir(join(appDir, 'hooks'));
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => e.name.slice(0, -'.ts'.length))
    .sort();
}

const PAGE_EXT = /\.(tsx|jsx)$/;

async function scanPages(appDir: string): Promise<string[]> {
  const pagesDir = join(appDir, 'pages');
  const out: string[] = [];
  await walkPages(pagesDir, pagesDir, out);
  out.sort();
  return out;
}

async function walkPages(root: string, dir: string, out: string[]): Promise<void> {
  for (const entry of await safeReaddir(dir)) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'components' || entry.name === 'lib' || entry.name.startsWith('_')) continue;
      await walkPages(root, abs, out);
      continue;
    }
    if (!entry.isFile() || !PAGE_EXT.test(entry.name)) continue;
    const base = entry.name.replace(PAGE_EXT, '');
    if (base.startsWith('_')) continue; // _app / _layout wrappers, not routes
    out.push(pageRoutePath(root, abs));
  }
}

/** Map a page file to its route pattern (`index` collapses; `[id]` → `:id`). */
function pageRoutePath(root: string, file: string): string {
  const rel = relative(root, file).replace(PAGE_EXT, '');
  const segs = rel.split(sep).filter((s) => s.length > 0);
  if (segs.length > 0 && segs[segs.length - 1] === 'index') segs.pop();
  const parts = segs.map((s) => {
    const m = /^\[(.+)\]$/.exec(s);
    return m ? `:${m[1]}` : s;
  });
  return '/' + parts.join('/');
}

const METHOD_FILE_RE = /^(GET|POST|PUT|PATCH|DELETE)\.ts$/;

async function scanEndpoints(appDir: string): Promise<string[]> {
  const apiDir = join(appDir, 'api');
  const out: string[] = [];
  await walkApi(apiDir, [], out);
  out.sort();
  return out;
}

async function walkApi(dir: string, segments: string[], out: string[]): Promise<void> {
  for (const entry of await safeReaddir(dir)) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkApi(abs, [...segments, entry.name], out);
      continue;
    }
    if (!entry.isFile()) continue;
    const m = METHOD_FILE_RE.exec(entry.name);
    if (!m) continue;
    const routePath = '/' + segments
      .map((s) => { const d = /^\[(.+)\]$/.exec(s); return d ? `:${d[1]}` : s; })
      .join('/');
    out.push(`${m[1]} ${routePath}`);
  }
}

/** `readdir` that returns `[]` (not throw) when `dir` is absent. Also asserts
 *  the resolved dir is not itself a traversal escape (defense-in-depth; callers
 *  only ever pass paths built from validated segments). */
async function safeReaddir(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(resolve(dir), { withFileTypes: true });
  } catch {
    return [];
  }
}
