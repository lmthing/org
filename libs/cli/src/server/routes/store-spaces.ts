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
 *  relative path, `/`-joined). The `events`/`functions`/`agents`/`inbound` fields
 *  (S12) are the space's LIFTED producer/consumer surface — the store gen script
 *  (`store/scripts/gen-apps-manifest.mjs`) transpiles each `events/*.ts` emitter
 *  def + statically parses `functions/`/`agents/` at build time, so `system-store`
 *  (S11) can fit-check an install from catalog data alone. Optional (older
 *  manifests / plain spaces omit them). */
export interface CatalogSpace {
  id: string;
  title: string;
  description: string;
  icon: string | null;
  tags: string[];
  kind: string | null;
  settings: unknown | null;
  /** Union of every `events/*.ts` def's `emits` (event name → `{ payload }`,
   *  field → typeString) — the events this space produces. */
  events?: Record<string, { payload: Record<string, string> }>;
  /** Exposed space functions (name + leading-comment summary + declaration sig). */
  functions?: { name: string; summary?: string; signature?: string }[];
  /** Each agent's frontmatter surface (slug + declared actions + trigger kinds). */
  agents?: { slug: string; actions?: string[]; triggers?: string[] }[];
  /** Public inbound path(s) of any `webhook` emitter def + its verify kind. */
  inbound?: { path: string; verify: string }[];
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
 * Catalog entries matching `query` — the pod half of the agent-facing
 * `storeSearch` global (plan S10). Case-insensitive substring match over
 * id/title/description/tags/kind; an empty/omitted query returns the full
 * catalog. Entries pass through VERBATIM (S12 enriches them with
 * events/functions/agents — nothing here picks fields). Throws when the store
 * is unreachable (the yield surfaces a clear, retryable error to the agent —
 * unlike the listing ROUTE, which degrades to `[]` for the UI).
 */
export async function searchCatalog(query?: string, storeUrl?: string): Promise<CatalogSpace[]> {
  const spaces = await fetchStoreSpaces(storeBaseUrl(storeUrl));
  const q = query?.trim().toLowerCase();
  if (!q) return spaces;
  return spaces.filter((s) => {
    const hay = [s.id, s.title, s.description, s.kind ?? '', ...(Array.isArray(s.tags) ? s.tags : [])]
      .join('\n')
      .toLowerCase();
    return hay.includes(q);
  });
}

/**
 * The full catalog entry for one space (the pod half of `storeInspect`), or
 * `undefined` when `spaceId` is not in the catalog. Verbatim entry, like
 * {@link searchCatalog}.
 */
export async function inspectCatalogSpace(spaceId: string, storeUrl?: string): Promise<CatalogSpace | undefined> {
  const spaces = await fetchStoreSpaces(storeBaseUrl(storeUrl));
  return spaces.find((s) => s.id === spaceId);
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

/** Options for the pure {@link installStoreSpace}. */
export interface InstallStoreSpaceOpts {
  /** `.lmthing` root (the projects root). */
  lmthingRoot: string;
  spaceId: string;
  projectId: string;
  /** Overwrite a locally-edited (diverged) copy. */
  force?: boolean;
  /** Store base override (tests / self-hosting). */
  storeUrl?: string;
}

/** Outcome of the pure {@link installStoreSpace} — a discriminated shape the two
 *  callers map to their own contracts (the HTTP route to statuses, the
 *  `installSpace` yield resolver to a {@link StoreInstallOutcome}-alike). */
export type InstallStoreSpaceResult =
  /** Installed (or pristine re-sync). `installedDir` = the materialized space dir. */
  | { ok: true; projectId: string; spaceId: string; installedDir: string }
  /** Local edits held back by the pristine-hash divergence guard. */
  | { ok: false; diverged: true; projectId: string; spaceId: string; message: string }
  /** Validation/download/materialize failure. `status` hints the HTTP mapping. */
  | { ok: false; diverged?: undefined; status: 400 | 404; error: string };

/**
 * The PURE install engine (factored out of the route closure in plan S10 so the
 * HTTP route and the agent-facing `installSpace` yield resolver share ONE code
 * path): download `spaceId` from the public store into staging, apply the
 * pristine-vs-diverged hash guard, and materialize into
 * `<lmthingRoot>/<projectId>/spaces/<spaceId>/` + write the install marker.
 *
 * Re-sync semantics on an existing dest, mirroring `apps.ts`'s `handleInstallApp`:
 * a **pristine** copy (unchanged since the last install, or already matching the
 * current shipped template) is re-synced silently; a **locally-edited** copy is
 * held back (`diverged: true`) unless `force`. A brand-new dest always installs.
 * No db boot, no page build — just the one space dir. Validates its own inputs
 * (agent-supplied ids reach this directly), never throws, and deliberately does
 * NOT republish/notify — each caller owns its post-install effects.
 */
export async function installStoreSpace(opts: InstallStoreSpaceOpts): Promise<InstallStoreSpaceResult> {
  const { lmthingRoot, spaceId, projectId } = opts;
  if (!spaceId || !safeProjectId(spaceId)) {
    return { ok: false, status: 400, error: `invalid spaceId: ${JSON.stringify(spaceId)}` };
  }
  if (!projectId || !safeProjectId(projectId) || RESERVED_PROJECT_IDS.has(projectId)) {
    return { ok: false, status: 400, error: `invalid projectId: ${JSON.stringify(projectId)}` };
  }

  const projectDir = join(lmthingRoot, projectId);
  if (!existsSync(projectDir)) {
    return { ok: false, status: 404, error: `project not found: ${projectId}` };
  }

  const dest = join(projectDir, 'spaces', spaceId);

  // Download the space from the PUBLIC store into a staging dir — there is no
  // local catalog in the pod. The staging copy is the install SOURCE
  // (hash/re-sync/materialize all read from it), then cleaned up in `finally`.
  const staging = mkdtempSync(join(tmpdir(), `lm-space-${spaceId}-`));
  try {
    let catalogSpace: CatalogSpace;
    try {
      catalogSpace = await downloadStoreSpace(storeBaseUrl(opts.storeUrl), spaceId, staging);
    } catch (err) {
      return {
        ok: false,
        status: 404,
        error: `space not available in store catalog: ${spaceId} (${err instanceof Error ? err.message : String(err)})`,
      };
    }
    void catalogSpace; // fetched for validation only — no per-space metadata needed here

    const isNew = !existsSync(dest);
    const shippedHash = hashSpaceDir(staging);
    if (!isNew) {
      const currentHash = hashSpaceDir(dest);
      if (currentHash !== shippedHash) {
        const manifest = readInstallMarker(dest);
        const pristine = manifest !== undefined && manifest.sourceHash === currentHash;
        if (!pristine && !opts.force) {
          return {
            ok: false,
            diverged: true,
            projectId,
            spaceId,
            message:
              `"${spaceId}" in project "${projectId}" has local edits that diverge from the ` +
              `store template — pass force:true to overwrite them.`,
          };
        }
      }
    }

    try {
      materializeSpaceDir(staging, dest);
      writeInstallMarker(dest, { spaceId, sourceHash: shippedHash, installedAt: new Date().toISOString() });
    } catch (err) {
      return { ok: false, status: 400, error: `materialize failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    return { ok: true, projectId, spaceId, installedDir: dest };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * `POST /api/store/spaces/install { spaceId, projectId?, force? }` — the HTTP
 * face of {@link installStoreSpace}. `projectId` defaults to
 * {@link DEFAULT_PROJECT_ID}; the target project must already exist (404
 * otherwise); the divergence guard answers 200 `{ ok:false, diverged:true }`.
 *
 * On success, fires `onInstalled(projectId, spaceId)` (cache invalidation +
 * republish + the S8 `space.installed` signal live in serve.ts's callback) and
 * best-effort republishes the webhook manifest (awaited but internally
 * error-swallowed) so a bundled `triggers:` agent registers with the gateway.
 */
export function handleInstallStoreSpace(
  lmthingRoot: string | undefined,
  storeUrl?: string,
  onInstalled?: (projectId: string, spaceId?: string) => void,
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

    if (!lmthingRoot) {
      sendJson(res, 404, { error: 'no project root configured' });
      return;
    }

    const result = await installStoreSpace({
      lmthingRoot,
      spaceId,
      projectId,
      force: body.force === true,
      storeUrl,
    });

    if (!result.ok && result.diverged !== true) {
      sendJson(res, result.status, { error: result.error });
      return;
    }
    if (!result.ok) {
      sendJson(res, 200, {
        ok: false,
        diverged: true,
        projectId: result.projectId,
        spaceId: result.spaceId,
        message: result.message,
      });
      return;
    }

    onInstalled?.(result.projectId, result.spaceId);

    // Best-effort: a freshly-installed space may bundle a `triggers:` agent —
    // republish so the gateway learns about it. Never fails the install.
    await republishWebhookManifest(lmthingRoot);

    sendJson(res, 200, { ok: true, projectId: result.projectId, spaceId: result.spaceId });
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
  /** The space's bundled `README.md` (setup instructions), `''` if none. */
  readme: string;
  /** Settings-schema `required` env-var NAMES not yet set (absent/empty) in the pod's
   *  `process.env`. NAMES ONLY — never any secret VALUES (which never leave the pod). */
  missingRequired: string[];
  /** Convenience for the UI: `missingRequired.length === 0` (all required keys set). */
  configured: boolean;
}

/** Required env-var NAMES declared by an integration's settings JSON Schema
 *  (`required[]`). The schema's property keys ARE pod env-var names, per contract. */
function requiredEnvKeys(settings: unknown): string[] {
  const s = settings as { required?: unknown } | null | undefined;
  return Array.isArray(s?.required) ? s.required.filter((k): k is string => typeof k === 'string') : [];
}

/** Of `required` env-var NAMES, those absent or empty in `process.env`. Returns
 *  NAMES ONLY — the secret values themselves are never read out or surfaced. */
function missingRequiredEnv(required: string[]): string[] {
  return required.filter((k) => {
    const v = process.env[k];
    return v === undefined || v === '';
  });
}

/**
 * Presence-only config status for the agent-facing `integrationStatus(spaceId)`
 * global (S13): read the installed integration space's settings-schema `required`
 * keys and report which are unset in `process.env` (NAMES only). `ready` is false
 * when `spaceId` isn't an installed integration or any required key is unset. Shares
 * the exact `required`→`process.env` logic the `/integrations` route uses, so the
 * agent's view and the UI's badge never diverge.
 */
export async function integrationStatusFor(
  projectDir: string,
  spaceId: string,
): Promise<{ ready: boolean; missingRequired: string[] }> {
  if (!safeProjectId(spaceId)) return { ready: false, missingRequired: [] };
  let pkg: { lmthing?: LmthingPackageBlock };
  try {
    pkg = JSON.parse(await readFile(join(projectDir, 'spaces', spaceId, 'package.json'), 'utf8')) as {
      lmthing?: LmthingPackageBlock;
    };
  } catch {
    return { ready: false, missingRequired: [] };
  }
  const lm = pkg.lmthing;
  if (!lm || lm.kind !== 'integration') return { ready: false, missingRequired: [] };
  const missingRequired = missingRequiredEnv(requiredEnvKeys(lm.settings));
  return { ready: missingRequired.length === 0, missingRequired };
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
 * every `<root>/<projectId>/spaces/<spaceId>/package.json` and return the ones whose
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
      // Bundled setup instructions (trusted, shipped in the space) — rendered as
      // markdown on the settings page. Missing/unreadable README is not fatal.
      let readme = '';
      try {
        readme = await readFile(join(spacesDir, entry.name, 'README.md'), 'utf8');
      } catch {
        readme = '';
      }
      // Which REQUIRED keys are still unset (names only — never the secret values,
      // which never leave the pod, so the LLM context stays clean).
      const missingRequired = missingRequiredEnv(requiredEnvKeys(lm.settings));
      integrations.push({
        spaceId: entry.name,
        title: typeof lm.title === 'string' && lm.title.length > 0 ? lm.title : entry.name,
        icon: typeof lm.icon === 'string' ? lm.icon : null,
        tags: Array.isArray(lm.tags) ? lm.tags.filter((t): t is string => typeof t === 'string') : [],
        settings: lm.settings ?? null,
        readme,
        missingRequired,
        configured: missingRequired.length === 0,
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
