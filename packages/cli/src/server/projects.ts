/**
 * Project helpers — on-disk layout under `lmthingRoot` (<cwd>/.lmthing):
 *
 *   <root>/system/{global,engineer,architect,solver,deep_research,memory,thing}/
 *   <root>/<projectId>/spaces/
 *   <root>/<projectId>/documents/
 *   <root>/<projectId>/instructions.md
 *   <root>/<projectId>/project.json  ← { id, name, createdAt }
 *
 * The default project id is "user".
 */

import { mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export const DEFAULT_PROJECT_ID = 'user';

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
  const sysDir = join(root, 'system');
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

/** List all projects under `root` (any sub-dir that has a project.json). */
export async function listProjects(root: string): Promise<ProjectMeta[]> {
  const entries = await safeDirEntries(root);
  const results: ProjectMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const meta = await readProjectMeta(root, entry.name);
      results.push(meta);
    } catch {
      // No project.json — skip (e.g. the system dir).
    }
  }
  return results.sort((a, b) => a.createdAt - b.createdAt);
}

/** Delete a project directory (refuses to delete 'user' — caller may override guard). */
export async function deleteProject(root: string, id: string): Promise<void> {
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
 * project.json. Also ensures `<root>/system/` exists for system spaces.
 */
export async function ensureDefaultProject(root: string): Promise<void> {
  // Create root itself and the system dir if absent.
  await mkdir(join(root, 'system'), { recursive: true });

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
  title: string;
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
