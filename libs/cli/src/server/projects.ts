/**
 * Project helpers — on-disk layout under `lmthingRoot` (<cwd>/.lmthing):
 *
 *   <root>/system/spaces/{system-global,system-engineer,system-architect,system-research,user-memory,user-thing}/
 *   <root>/<projectId>/spaces/
 *   <root>/<projectId>/documents/
 *   <root>/<projectId>/instructions.md
 *   <root>/<projectId>/project.json  ← { id, name, createdAt }
 *
 * The default project id is "user". The system spaces live under
 * `<root>/system/spaces/` and are surfaced as a synthetic, read-only-ish
 * "system" project (id {@link SYSTEM_PROJECT_ID}) so Studio can browse and edit
 * them through the same `/api/projects/:id/spaces/...` endpoints as any other
 * project — `<root>/system/spaces/<id>` matches the generic
 * `<root>/<projectId>/spaces/<id>` shape, so no special-casing is needed in the
 * space/files routes, only in {@link listProjects}.
 */

import { mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export const DEFAULT_PROJECT_ID = 'user';

/**
 * Synthetic project id under which the system spaces (`system-*`) and the
 * per-user materialized spaces (`user-thing`, `user-memory`) are exposed. It
 * is not a real on-disk project directory — it maps to `<root>/system/` (whose
 * `spaces/` subdir holds the system spaces). Reserved: cannot be created or
 * deleted as a normal project.
 */
export const SYSTEM_PROJECT_ID = 'system';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
}

// ─── Path safety ──────────────────────────────────────────────────────────────

/**
 * Validate that `id` is a safe, single-segment identifier (no path separators,
 * no traversal, non-empty, max 200 chars). Returns the id or null on failure.
 */
export function safeProjectId(id: unknown): string | null {
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) return null;
  if (id.includes('/') || id.includes('\\') || id.includes('\0')) return null;
  if (id === '.' || id === '..') return null;
  // Only allow URL-safe slug chars.
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  return id;
}

/**
 * Validate that a file path is relative and free of empty / `.` / `..`
 * segments. Used by the space-file write endpoint to vet each key.
 */
export function isSafeRelPath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0 || p.startsWith('/') || p.includes('\0')) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/**
 * Validate that `name` is a non-empty document/file name (single segment, no
 * separators, max 200 chars). Returns the name or null on failure.
 */
export function safeDocumentName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) return null;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return null;
  if (name === '.' || name === '..') return null;
  return name;
}

/**
 * Convert an arbitrary display name to a slug-style project id: lower-case,
 * replace non-alphanumeric runs with hyphens, trim leading/trailing hyphens.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

// ─── Directories ──────────────────────────────────────────────────────────────

function projectDir(root: string, id: string): string {
  return join(root, id);
}

function spacesDir(root: string, id: string): string {
  return join(root, id, 'spaces');
}

function documentsDir(root: string, id: string): string {
  return join(root, id, 'documents');
}

function instructionsPath(root: string, id: string): string {
  return join(root, id, 'instructions.md');
}

function projectJsonPath(root: string, id: string): string {
  return join(root, id, 'project.json');
}

// ─── Guard against path traversal ────────────────────────────────────────────

/**
 * Resolve `subPath` under `base` and assert it is still within `base`.
 * Returns the resolved absolute path or throws.
 */
function assertUnder(base: string, subPath: string): string {
  const resolved = resolve(base, subPath);
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error(`path traversal detected: ${subPath}`);
  }
  return resolved;
}

// ─── System spaces ────────────────────────────────────────────────────────────

/**
 * List absolute paths for each immediate sub-directory of `<root>/system/`.
 * Returns [] if the directory doesn't exist.
 */
export async function listSystemSpaceDirs(root: string): Promise<string[]> {
  const sysDir = join(root, 'system', 'spaces');
  return listSubdirs(sysDir);
}

// ─── Project spaces ───────────────────────────────────────────────────────────

/**
 * List absolute paths for each immediate sub-directory of
 * `<root>/<projectId>/spaces/`. Returns [] if the directory doesn't exist.
 */
export async function listProjectSpaceDirs(root: string, projectId: string): Promise<string[]> {
  return listSubdirs(spacesDir(root, projectId));
}

/** Resolve the absolute dir for a single space within a project. */
export function projectSpaceDir(root: string, projectId: string, spaceId: string): string {
  return join(root, projectId, 'spaces', spaceId);
}

/**
 * Read every file under a space dir into a flat `{ relPath: content }` map,
 * excluding runtime junk: a top-level `sessions/` dir, any `conversations/`
 * dir at any depth, and any `.env` file. `relPath` uses forward slashes.
 * Returns {} if the dir doesn't exist.
 */
export async function readSpaceFiles(spaceDir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await safeDirEntries(dir);
    for (const entry of entries) {
      const name = entry.name;
      const childRel = rel ? `${rel}/${name}` : name;
      if (entry.isDirectory()) {
        // Exclude runtime junk dirs.
        if (rel === '' && name === 'sessions') continue;
        if (name === 'conversations') continue;
        await walk(join(dir, name), childRel);
      } else if (entry.isFile()) {
        if (name === '.env') continue;
        try {
          files[childRel] = await readFile(join(dir, name), 'utf8');
        } catch {
          // Unreadable file — skip.
        }
      }
    }
  }

  await walk(spaceDir, '');
  return files;
}

/**
 * Wipe-and-rewrite a space dir with the supplied `{ relPath: content }` map.
 * Each key must pass `isSafeRelPath` and resolve under `spaceDir`. The dir is
 * removed first so deletions in the editor are reflected on disk.
 */
export async function writeSpaceFiles(spaceDir: string, files: Record<string, string>): Promise<void> {
  for (const rel of Object.keys(files)) {
    if (!isSafeRelPath(rel)) throw new Error(`unsafe file path: ${rel}`);
  }
  await rm(spaceDir, { recursive: true, force: true });
  await mkdir(spaceDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const dest = assertUnder(spaceDir, rel);
    await mkdir(resolve(dest, '..'), { recursive: true });
    await writeFile(dest, typeof content === 'string' ? content : String(content ?? ''), 'utf8');
  }
}

/**
 * Reject relative paths that target runtime junk excluded from sync: any
 * `conversations/` dir at any depth, a top-level `sessions/` dir, or a
 * `.env`-prefixed file. Mirrors the exclusions baked into {@link readSpaceFiles}
 * and the client-side `isRunnableSpaceFile` filter in `@lmthing/state`.
 */
export function isExcludedSpaceRelPath(rel: string): boolean {
  const segments = rel.split('/');
  if (segments[0] === 'sessions') return true;
  if (segments.includes('conversations')) return true;
  const base = segments[segments.length - 1] ?? '';
  if (base.startsWith('.env')) return true;
  return false;
}

/**
 * Create or overwrite a single file within a space dir (mkdir -p the parent).
 * `rel` must pass `isSafeRelPath` and must not target excluded runtime junk
 * (see {@link isExcludedSpaceRelPath}); throws otherwise.
 */
export async function writeProjectSpaceFile(spaceDir: string, rel: string, content: string): Promise<void> {
  if (!isSafeRelPath(rel)) throw new Error(`unsafe file path: ${rel}`);
  if (isExcludedSpaceRelPath(rel)) throw new Error(`excluded file path: ${rel}`);
  const dest = assertUnder(spaceDir, rel);
  await mkdir(resolve(dest, '..'), { recursive: true });
  await writeFile(dest, typeof content === 'string' ? content : String(content ?? ''), 'utf8');
}

/**
 * Delete a single file within a space dir. `rel` must pass `isSafeRelPath`
 * and must not target excluded runtime junk; throws on unsafe/excluded paths.
 * Throws an `ENOENT`-style error (via fs) if the file does not exist — callers
 * map that to a 404.
 */
export async function deleteProjectSpaceFile(spaceDir: string, rel: string): Promise<void> {
  if (!isSafeRelPath(rel)) throw new Error(`unsafe file path: ${rel}`);
  if (isExcludedSpaceRelPath(rel)) throw new Error(`excluded file path: ${rel}`);
  const dest = assertUnder(spaceDir, rel);
  await rm(dest, { force: false });
}

// ─── Projects CRUD ────────────────────────────────────────────────────────────

/** Scaffold a new project directory, writing project.json + empty files. */
export async function scaffoldProject(root: string, id: string, name: string): Promise<ProjectMeta> {
  const dir = projectDir(root, id);
  // Guard: confirm the dir is under root.
  assertUnder(root, id);

  await mkdir(join(dir, 'spaces'), { recursive: true });
  await mkdir(join(dir, 'documents'), { recursive: true });

  const meta: ProjectMeta = { id, name, createdAt: Date.now() };
  await writeFile(projectJsonPath(root, id), JSON.stringify(meta, null, 2), 'utf8');
  await writeFile(instructionsPath(root, id), '', 'utf8');
  return meta;
}

/** Read project.json for a project. Throws if not found. */
export async function readProjectMeta(root: string, id: string): Promise<ProjectMeta> {
  assertUnder(root, id);
  const raw = await readFile(projectJsonPath(root, id), 'utf8');
  return JSON.parse(raw) as ProjectMeta;
}

/**
 * List all projects under `root` (any sub-dir that has a project.json), plus a
 * synthetic {@link SYSTEM_PROJECT_ID} project (prepended) whenever the system
 * spaces dir exists and is non-empty. The system entry lets Studio list, view,
 * and edit the system/user spaces through the standard project/space routes.
 */
export async function listProjects(root: string): Promise<ProjectMeta[]> {
  const entries = await safeDirEntries(root);
  const results: ProjectMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === SYSTEM_PROJECT_ID) continue; // surfaced synthetically below
    try {
      const meta = await readProjectMeta(root, entry.name);
      results.push(meta);
    } catch {
      // No project.json — skip (e.g. the system dir).
    }
  }
  results.sort((a, b) => a.createdAt - b.createdAt);

  // Prepend the synthetic "system" project when system spaces are present.
  const systemSpaces = await listSubdirs(join(root, SYSTEM_PROJECT_ID, 'spaces'));
  if (systemSpaces.length > 0) {
    results.unshift({ id: SYSTEM_PROJECT_ID, name: 'System', createdAt: 0 });
  }
  return results;
}

/**
 * Delete a project directory. Refuses to delete the synthetic
 * {@link SYSTEM_PROJECT_ID} project (it would wipe the system spaces). The
 * default 'user' project can be deleted (the caller layer in serve.ts may
 * choose to guard against it).
 */
export async function deleteProject(root: string, id: string): Promise<void> {
  if (id === SYSTEM_PROJECT_ID) {
    throw new Error('the system project cannot be deleted');
  }
  assertUnder(root, id);
  const dir = projectDir(root, id);
  await rm(dir, { recursive: true, force: true });
}

/** Read the instructions.md for a project. Returns '' if the file doesn't exist. */
export async function getInstructions(root: string, id: string): Promise<string> {
  assertUnder(root, id);
  try {
    return await readFile(instructionsPath(root, id), 'utf8');
  } catch {
    return '';
  }
}

/** Write the instructions.md for a project (creates parent dirs if needed). */
export async function setInstructions(root: string, id: string, content: string): Promise<void> {
  assertUnder(root, id);
  await mkdir(projectDir(root, id), { recursive: true });
  await writeFile(instructionsPath(root, id), content, 'utf8');
}

// ─── Documents ────────────────────────────────────────────────────────────────

/** List document names in `<root>/<id>/documents/`. */
export async function listDocuments(root: string, id: string): Promise<string[]> {
  assertUnder(root, id);
  const dir = documentsDir(root, id);
  const entries = await safeDirEntries(dir);
  return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
}

/** Write a document to `<root>/<id>/documents/<name>`. */
export async function addDocument(root: string, id: string, name: string, content: string): Promise<void> {
  assertUnder(root, id);
  const dir = documentsDir(root, id);
  await mkdir(dir, { recursive: true });
  // Also guard the document name itself.
  const dest = resolve(dir, name);
  if (dest !== dir && !dest.startsWith(dir + sep)) {
    throw new Error(`unsafe document name: ${name}`);
  }
  await writeFile(dest, content, 'utf8');
}

// ─── Ensure default project ───────────────────────────────────────────────────

/**
 * Ensure the default "user" project exists under `root`. Creates it (with an
 * empty instructions.md and project.json) if it does not already have a
 * project.json. Also ensures `<root>/system/spaces/` exists for system spaces.
 */
export async function ensureDefaultProject(root: string): Promise<void> {
  // Create root itself and the system spaces dir if absent.
  await mkdir(join(root, 'system', 'spaces'), { recursive: true });

  try {
    await stat(projectJsonPath(root, DEFAULT_PROJECT_ID));
    // Already exists — nothing to do.
  } catch {
    await scaffoldProject(root, DEFAULT_PROJECT_ID, 'Personal');
  }
}

// ─── Session persistence ──────────────────────────────────────────────────────

/** Metadata stored in each session's meta.json. */
export interface PersistedSessionMeta {
  sessionId: string;
  projectId: string;
  agentSlug: string;
  spaceDir: string;
  /** When set, this session belongs to a project space (chat under
   *  `<project>/spaces/<spaceId>/sessions/`) rather than the project root. */
  spaceId?: string;
  title: string;
  /** URL-safe handle set by the agent via setSessionMeta(). */
  slug?: string;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
  status: string;
  totalCostUsd?: number;
}

/** `<root>/<projectId>/sessions/` */
export function sessionsDir(root: string, projectId: string): string {
  return join(root, projectId, 'sessions');
}

/**
 * List persisted session metas for a project, sorted by lastActivity desc.
 * Tolerates a missing sessions dir — returns [].
 */
export async function listProjectSessions(
  root: string,
  projectId: string,
): Promise<PersistedSessionMeta[]> {
  const dir = sessionsDir(root, projectId);
  const entries = await safeDirEntries(dir);
  const results: PersistedSessionMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const metaPath = join(dir, entry.name, 'meta.json');
      const raw = await readFile(metaPath, 'utf8');
      results.push(JSON.parse(raw) as PersistedSessionMeta);
    } catch {
      // Corrupt or incomplete — skip.
    }
  }
  return results.sort((a, b) => b.lastActivity - a.lastActivity);
}

/** `<root>/<projectId>/spaces/<spaceId>/sessions/` — where chat sessions bound to
 *  a specific project space are persisted (net-new; the project-root
 *  `<root>/<projectId>/sessions/` remains for plain project sessions). */
export function spaceSessionsDir(root: string, projectId: string, spaceId: string): string {
  return join(root, projectId, 'spaces', spaceId, 'sessions');
}

/**
 * List persisted session metas for a single project space
 * (`<root>/<projectId>/spaces/<spaceId>/sessions/`), sorted by lastActivity
 * desc. Mirrors {@link listProjectSessions}; tolerates a missing dir → [].
 */
export async function listSpaceSessions(
  root: string,
  projectId: string,
  spaceId: string,
): Promise<PersistedSessionMeta[]> {
  const dir = spaceSessionsDir(root, projectId, spaceId);
  const entries = await safeDirEntries(dir);
  const results: PersistedSessionMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const metaPath = join(dir, entry.name, 'meta.json');
      const raw = await readFile(metaPath, 'utf8');
      results.push(JSON.parse(raw) as PersistedSessionMeta);
    } catch {
      // Corrupt or incomplete — skip.
    }
  }
  return results.sort((a, b) => b.lastActivity - a.lastActivity);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function listSubdirs(dir: string): Promise<string[]> {
  const entries = await safeDirEntries(dir);
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => join(dir, e.name));
}

async function safeDirEntries(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
