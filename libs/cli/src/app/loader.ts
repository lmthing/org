/**
 * Project **app-layer** loader (Phase 2).
 *
 * A project owns an app whose declaration lives at the project root, as siblings
 * of `spaces/`:
 *
 *   <projectRoot>/database/<table>.json   — table schemas (table name = basename)
 *   <projectRoot>/pages/                  — client-side React app
 *   <projectRoot>/api/                    — named Node handlers
 *   <projectRoot>/hooks/                  — cron/db triggers
 *
 * {@link loadProjectApp} reads the `database/*.json` schemas (fail-loud via
 * `validateSchemaSet`) and reports which app dirs are present. It **tolerates a
 * spaces-only project** — the synthetic `system` project has no app layer, so a
 * project with no `database/` (and no `pages/`/`api/`/`hooks/`) loads to an empty
 * app with `hasApp: false`, never a throw. Boot ({@link ./boot.ts}) skips such
 * projects.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { validateSchemaSet, type LoadedTable, type TableSchema } from '@lmthing/core';

/**
 * The result of loading a project's app layer.
 * `hasApp` is the OR of all four app dirs — a project with any of
 * `database/`/`pages/`/`api/`/`hooks/` "has an app"; a spaces-only project
 * (e.g. `system`) has `hasApp: false` and no tables.
 */
export interface ProjectApp {
  /** Table schemas parsed from `database/*.json` (empty when there is no `database/`). */
  tables: LoadedTable[];
  /** Whether `<projectRoot>/pages/` exists. */
  hasPages: boolean;
  /** Whether `<projectRoot>/api/` exists. */
  hasApi: boolean;
  /** Whether `<projectRoot>/hooks/` exists. */
  hasHooks: boolean;
  /** Whether the project has any app layer at all (`database`|`pages`|`api`|`hooks`). */
  hasApp: boolean;
}

const JSON_EXT = '.json';

/**
 * Load a project's app layer from its root dir.
 *
 * Reads every `<projectRoot>/database/<table>.json` into a {@link LoadedTable}
 * (table name = file basename) and runs `validateSchemaSet` (**fail-loud** on a
 * missing description, dup/absent PK, or a dangling FK/relation). Detects the
 * presence of `pages/`/`api/`/`hooks/`. A project with **no `database/`** yields
 * `tables: []` and — combined with no other app dir — `hasApp: false`; it never
 * throws (this is how the spaces-only `system` project loads).
 */
export async function loadProjectApp(projectRoot: string): Promise<ProjectApp> {
  const loaded = await loadTables(join(projectRoot, 'database'));
  const tables = loaded ?? [];
  const hasDatabase = loaded !== null;

  const [hasPages, hasApi, hasHooks] = await Promise.all([
    dirExists(join(projectRoot, 'pages')),
    dirExists(join(projectRoot, 'api')),
    dirExists(join(projectRoot, 'hooks')),
  ]);

  const hasApp = hasDatabase || hasPages || hasApi || hasHooks;
  return { tables, hasPages, hasApi, hasHooks, hasApp };
}

/**
 * Read + validate `database/*.json`. Returns `null` when the `database/` dir is
 * absent (spaces-only tolerance), an empty array when it exists but holds no
 * schema files, or the loaded+validated tables otherwise. Throws (fail-loud) on
 * invalid JSON or a schema-set violation.
 */
async function loadTables(dbDir: string): Promise<LoadedTable[] | null> {
  const entries = await safeReaddir(dbDir);
  if (entries === null) return null; // no database/ — spaces-only project

  const tables: LoadedTable[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(JSON_EXT)) continue;
    const name = entry.name.slice(0, -JSON_EXT.length);
    const raw = await readFile(join(dbDir, entry.name), 'utf8');
    let schema: TableSchema;
    try {
      schema = JSON.parse(raw) as TableSchema;
    } catch (err) {
      throw new Error(`[app-loader] database/${entry.name}: invalid JSON — ${(err as Error).message}`);
    }
    tables.push({ name, schema });
  }

  // Deterministic order so migrations/dumps are stable across boots.
  tables.sort((a, b) => a.name.localeCompare(b.name));
  // Fail-loud: required descriptions, exactly-one PK, resolvable FKs/relations.
  validateSchemaSet(tables);
  return tables;
}

/** `readdir` that returns `null` (not throw) when the dir is absent. */
async function safeReaddir(dir: string): Promise<Dirent[] | null> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** True when `p` exists and is a directory. */
async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}
