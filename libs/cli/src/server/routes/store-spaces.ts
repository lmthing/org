/**
 * Store-installable **integration spaces** — the pod endpoints that let a project
 * browse the store's space catalog (`store/spaces/<id>/`, published in
 * `store/projects/manifest.json`'s `spaces[]` array) and install one into a
 * SPECIFIC project's `spaces/` dir:
 *
 *   1. {@link handleListStoreSpaces}         GET  /api/store/spaces
 *      — list the catalog (`{ spaces: CatalogSpace[] }`, `[]` on failure).
 *   2. {@link handleInstallStoreSpace}       POST /api/store/spaces/install
 *      — download + materialize ONE space dir into `<root>/<projectId>/spaces/<spaceId>/`.
 *   3. {@link handleListProjectIntegrations} GET  /api/projects/:projectId/integrations
 *      — scan a project's installed spaces for ones carrying `lmthing.kind === 'integration'`.
 *
 * `POST /api/spaces` is ALREADY TAKEN by `routes/spaces.ts` (space-sync) — these
 * live under the `/api/store/spaces*` prefix instead. `serve.ts` mounts all three
 * (the integrator's job, not this module's).
 *
 * Mirrors `routes/apps.ts`'s engine (same store-base resolution, same
 * download-into-staging + path-safety, same pristine-vs-diverged hash-guard +
 * `.installed.json` marker pattern) but scoped to a SINGLE space dir living
 * INSIDE a project (`<project>/spaces/<spaceId>/`) rather than a whole project —
 * so there is no db boot and no page build here, just a file materialization.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync,
  cpSync, rmSync, mkdtempSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { readBody, sendJson } from './utils.js';
import { safeProjectId, RESERVED_PROJECT_IDS, DEFAULT_PROJECT_ID, listProjects } from '../projects.js';
import { buildWebhookManifest, publishWebhookManifest } from '../webhook-manifest.js';

/** Public store base — mirrors `routes/apps.ts`'s `storeBaseUrl` (there is NO local
 *  catalog in the pod). Overridable for tests / self-hosting. */
const DEFAULT_STORE_URL = 'https://lmthing.store';
function storeBaseUrl(override?: string): string {
  return (override ?? process.env['LM_STORE_URL'] ?? DEFAULT_STORE_URL).replace(/\/+$/, '');
}

type StoreHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => Promise<void>;

// ── Catalog listing ───────────────────────────────────────────────────────────

/** One space entry in the store's static catalog manifest (`/projects/manifest.json`
 *  `spaces[]`). `files` is the full download list (every file under the space dir,
 *  relative path, `/`-joined). */
export interface CatalogSpace {
  id: string;
  title: string;
  description: string;
  icon: string | null;
  tags: string[];
  kind: string | null;
  settings: unknown | null;
  files: string[];
}

/** Fetch the store's static catalog manifest and return its `spaces[]` array. */
async function fetchStoreSpaces(storeUrl: string): Promise<CatalogSpace[]> {
  const res = await fetch(`${storeUrl}/projects/manifest.json`);
  if (!res.ok) throw new Error(`store catalog HTTP ${res.status}`);
  const body = (await res.json()) as { spaces?: CatalogSpace[] };
  return Array.isArray(body.spaces) ? body.spaces : [];
}

/**
 * `GET /api/store/spaces` — list the PUBLIC store's space catalog. Returns
 * `{ spaces: [] }` if the store is unreachable rather than erroring the request.
 */
export function handleListStoreSpaces(storeUrl?: string): StoreHandler {
  return async (_req, res) => {
    try {
      const spaces = await fetchStoreSpaces(storeBaseUrl(storeUrl));
      sendJson(res, 200, { spaces });
    } catch {
      sendJson(res, 200, { spaces: [] });
    }
  };
}

/**
 * Download every file of `spaceId` from the store's public path into `destDir`,
 * using the manifest's per-space `files` list (`${store}/spaces/<id>/<relpath>`).
 * Throws on a missing space, an empty/unsafe file list, or any failed fetch.
 * Path-safe: rejects `..`, absolute, and NUL segments, and verifies each write
 * stays inside `destDir`. Mirrors `apps.ts`'s `downloadStoreApp` verbatim, just
 * against the `/spaces/` store path instead of `/projects/`.
 */
async function downloadStoreSpace(storeUrl: string, spaceId: string, destDir: string): Promise<CatalogSpace> {
  const spaces = await fetchStoreSpaces(storeUrl);
  const space = spaces.find((s) => s.id === spaceId);
  if (!space) throw new Error(`"${spaceId}" not found in the store catalog`);
  const files = Array.isArray(space.files) ? space.files : [];
  if (files.length === 0) throw new Error(`catalog entry "${spaceId}" lists no files`);
  const resolvedDest = resolve(destDir);
  for (const rel of files) {
    if (rel.includes('\0') || rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s === '')) {
      throw new Error(`unsafe catalog file path: ${rel}`);
    }
    const target = resolve(resolvedDest, rel);
    if (target !== resolvedDest && !target.startsWith(resolvedDest + sep)) {
      throw new Error(`path traversal rejected: ${rel}`);
    }
    const fileUrl = `${storeUrl}/spaces/${encodeURIComponent(spaceId)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`download ${rel} → HTTP ${res.status}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  }
  return space;
}

// ── Install ────────────────────────────────────────────────────────────────

interface InstallSpaceBody {
  spaceId?: unknown;
  projectId?: unknown;
  force?: unknown;
}

/**
 * `POST /api/store/spaces/install { spaceId, projectId?, force? }` — materialize
 * a catalog space (`${store}/spaces/<spaceId>/`) into
 * `<lmthingRoot>/<projectId>/spaces/<spaceId>/`. `projectId` defaults to
 * {@link DEFAULT_PROJECT_ID}; the target project must already exist (404 otherwise).
 *
 * Re-sync semantics on an existing dest, mirroring `apps.ts`'s `handleInstallApp`:
 * a **pristine** copy (unchanged since the last install, or already matching the
 * current shipped template) is re-synced silently; a **locally-edited** copy is
 * held back (`{ ok:false, diverged:true }`) unless `force:true`. A brand-new dest
 * always installs. No db boot, no page build — just the one space dir.
 *
 * On success, best-effort republishes the webhook manifest (fire-and-forget,
 * awaited but internally error-swallowed) so a bundled `triggers:` agent
 * registers with the gateway.
 */
export function handleInstallStoreSpace(
  lmthingRoot: string | undefined,
  storeUrl?: string,
  onInstalled?: (projectId: string) => void,
): StoreHandler {
  return async (req, res) => {
    let body: InstallSpaceBody;
    try {
      body = JSON.parse((await readBody(req)) || '{}') as InstallSpaceBody;
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }

    const spaceId = typeof body.spaceId === 'string' ? body.spaceId : '';
    if (!spaceId || !safeProjectId(spaceId)) {
      sendJson(res, 400, { error: `invalid spaceId: ${JSON.stringify(body.spaceId)}` });
      return;
    }
    const projectId = typeof body.projectId === 'string' && body.projectId.length > 0
      ? body.projectId
      : DEFAULT_PROJECT_ID;
    if (!safeProjectId(projectId) || RESERVED_PROJECT_IDS.has(projectId)) {
      sendJson(res, 400, { error: `invalid projectId: ${JSON.stringify(body.projectId)}` });
      return;
    }
    const force = body.force === true;

    if (!lmthingRoot) {
      sendJson(res, 404, { error: 'no project root configured' });
      return;
    }

    const projectDir = join(lmthingRoot, projectId);
    if (!existsSync(projectDir)) {
      sendJson(res, 404, { error: `project not found: ${projectId}` });
      return;
    }

    const dest = join(projectDir, 'spaces', spaceId);

    // Download the space from the PUBLIC store into a staging dir — there is no
    // local catalog in the pod. The staging copy is the install SOURCE
    // (hash/re-sync/materialize all read from it), then cleaned up in `finally`.
    const staging = mkdtempSync(join(tmpdir(), `lm-space-${spaceId}-`));
    try {
      let catalogSpace: CatalogSpace;
      try {
        catalogSpace = await downloadStoreSpace(storeBaseUrl(storeUrl), spaceId, staging);
      } catch (err) {
        sendJson(res, 404, {
          error: `space not available in store catalog: ${spaceId} (${err instanceof Error ? err.message : String(err)})`,
        });
        return;
      }
      void catalogSpace; // fetched for validation only — no per-space metadata needed here

      const isNew = !existsSync(dest);
      const shippedHash = hashSpaceDir(staging);
      if (!isNew) {
        const currentHash = hashSpaceDir(dest);
        if (currentHash !== shippedHash) {
          const manifest = readInstallMarker(dest);
          const pristine = manifest !== undefined && manifest.sourceHash === currentHash;
          if (!pristine && !force) {
            sendJson(res, 200, {
              ok: false,
              diverged: true,
              projectId,
              spaceId,
              message:
                `"${spaceId}" in project "${projectId}" has local edits that diverge from the ` +
                `store template — pass force:true to overwrite them.`,
            });
            return;
          }
        }
      }

      try {
        materializeSpaceDir(staging, dest);
        writeInstallMarker(dest, { spaceId, sourceHash: shippedHash, installedAt: new Date().toISOString() });
      } catch (err) {
        sendJson(res, 400, { error: `materialize failed: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }

      onInstalled?.(projectId);

      // Best-effort: a freshly-installed space may bundle a `triggers:` agent —
      // republish so the gateway learns about it. Never fails the install.
      await republishWebhookManifest(lmthingRoot);

      sendJson(res, 200, { ok: true, projectId, spaceId });
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  };
}

// ── Materialize (whole-dir copy — the space's OWN dir only) ──────────────────

/** Replace `dest` with the contents of `src` (rm then copy). Never touches
 *  anything outside this one space dir (the rest of the project's `spaces/`
 *  tree is left completely alone). */
function materializeSpaceDir(src: string, dest: string): void {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

/** Dirs never hashed / never part of the pristine-vs-diverged comparison —
 *  generated or runtime-only content. */
const HASH_EXCLUDE_DIRS = new Set(['.data', 'types', 'node_modules']);
/** The install marker itself must not affect its own dir's hash (it doesn't
 *  exist in the staged/shipped copy, only in an already-installed dest). */
const MARKER_FILENAME = '.installed.json';

/**
 * Stable content hash of a space dir — sha256 over each file's relative path +
 * bytes, sorted, excluding {@link HASH_EXCLUDE_DIRS} and the
 * {@link MARKER_FILENAME} marker. Mirrors `apps.ts`'s `hashAppTemplate`,
 * generalized to "the whole dir" since a space has no fixed template-dir
 * allowlist the way a project-app does.
 */
function hashSpaceDir(dir: string): string {
  const relPaths: string[] = [];
  collectSpaceFiles(dir, dir, relPaths);
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

function collectSpaceFiles(absDir: string, base: string, out: string[]): void {
  if (!existsSync(absDir)) return;
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (HASH_EXCLUDE_DIRS.has(entry.name)) continue;
      collectSpaceFiles(join(absDir, entry.name), base, out);
      continue;
    }
    if (entry.isFile()) {
      const rel = relative(base, join(absDir, entry.name));
      if (rel === MARKER_FILENAME) continue;
      out.push(rel);
    }
  }
}

// ── Install marker (pristine-vs-edited tracking, INSIDE the space dir) ───────

interface InstallMarker {
  spaceId: string;
  sourceHash: string;
  installedAt: string;
}

function markerPath(dest: string): string {
  return join(dest, MARKER_FILENAME);
}

function readInstallMarker(dest: string): InstallMarker | undefined {
  try {
    return JSON.parse(readFileSync(markerPath(dest), 'utf8')) as InstallMarker;
  } catch {
    return undefined;
  }
}

function writeInstallMarker(dest: string, marker: InstallMarker): void {
  writeFileSync(markerPath(dest), JSON.stringify(marker, null, 2), 'utf8');
}

// ── Webhook manifest republish (best-effort) ──────────────────────────────────

/**
 * Best-effort republish of the inbound-webhook manifest after a space install —
 * mirrors the gating + swallow-all posture of `serve.ts`'s boot-time publish
 * (`buildWebhookManifest` + `publishWebhookManifest`). A no-op when the pod has
 * no gateway env (local `lmthing serve`), and never throws.
 */
export async function republishWebhookManifest(root: string): Promise<void> {
  try {
    const gatewayUrl = process.env['LMTHING_GATEWAY_URL'];
    const computeJwt = process.env['LMTHING_COMPUTE_JWT'];
    if (!gatewayUrl || !computeJwt) return;
    const projects = (await listProjects(root)).map((p) => p.id).filter((id) => id !== 'system');
    const bindings = await buildWebhookManifest(root, projects);
    await publishWebhookManifest(gatewayUrl, computeJwt, bindings);
  } catch {
    // Never destabilize an install on a webhook-manifest hiccup.
  }
}

// ── Installed integrations listing ────────────────────────────────────────────

/** One installed integration space, as surfaced to Studio's per-project
 *  Integrations settings panel. */
export interface InstalledIntegration {
  spaceId: string;
  title: string;
  icon: string | null;
  tags: string[];
  settings: unknown | null;
}

interface LmthingPackageBlock {
  kind?: unknown;
  title?: unknown;
  icon?: unknown;
  tags?: unknown;
  settings?: unknown;
}

/**
 * `GET /api/projects/:projectId/integrations` — scan
 * `<root>/<projectId>/spaces/*​/package.json` and return the ones whose
 * `lmthing.kind === 'integration'`. Tolerant of a missing/invalid `projectId`,
 * a missing project root, or a missing/malformed `package.json` (skipped, not
 * fatal — one broken space must not blank the whole list).
 */
export function handleListProjectIntegrations(lmthingRoot: string | undefined): StoreHandler {
  return async (_req, res, params) => {
    const projectId = params['projectId'] ?? '';
    if (!safeProjectId(projectId)) {
      sendJson(res, 400, { error: `invalid projectId: ${JSON.stringify(projectId)}` });
      return;
    }
    if (!lmthingRoot) {
      sendJson(res, 200, { integrations: [] });
      return;
    }

    const spacesDir = join(lmthingRoot, projectId, 'spaces');
    const integrations: InstalledIntegration[] = [];
    const entries = await safeReaddir(spacesDir);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let pkg: { lmthing?: LmthingPackageBlock };
      try {
        pkg = JSON.parse(await readFile(join(spacesDir, entry.name, 'package.json'), 'utf8')) as {
          lmthing?: LmthingPackageBlock;
        };
      } catch {
        continue;
      }
      const lm = pkg.lmthing;
      if (!lm || lm.kind !== 'integration') continue;
      integrations.push({
        spaceId: entry.name,
        title: typeof lm.title === 'string' && lm.title.length > 0 ? lm.title : entry.name,
        icon: typeof lm.icon === 'string' ? lm.icon : null,
        tags: Array.isArray(lm.tags) ? lm.tags.filter((t): t is string => typeof t === 'string') : [],
        settings: lm.settings ?? null,
      });
    }
    integrations.sort((a, b) => a.spaceId.localeCompare(b.spaceId));
    sendJson(res, 200, { integrations });
  };
}

/** `readdir` that returns `[]` (not throw) when `dir` is absent. */
async function safeReaddir(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(resolve(dir), { withFileTypes: true });
  } catch {
    return [];
  }
}
