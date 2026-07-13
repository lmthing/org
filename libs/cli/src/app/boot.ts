/**
 * Per-project app boot sequence (Phase 2, steps 1–3 of the spec's ordered boot).
 *
 * {@link bootProjectApp} brings one project's SQLite store up to date with its
 * `database/*.json` schemas — the JSON is the **sole source of truth** — then
 * returns the open {@link ProjectDb}. It implements:
 *
 *   1. **Restore (DR only)** — if `.data/app.db` is absent and `.data/app.sql`
 *      is present, rebuild from the dump. If `app.db` exists, never touch it
 *      (never clobber live PVC data).
 *   2. **Open db** — `openProjectDb` (sets `PRAGMA foreign_keys=ON` inside).
 *   3. **Reconcile** — for each declared table: create it if missing; else diff
 *      declared vs live columns and apply **additive** `ALTER TABLE ADD COLUMN`
 *      for new columns. **Fail loud** on any non-additive divergence (a dropped/
 *      renamed live column, a PK move, or a text↔numeric type conflict).
 *
 * Returns `null` (skip) for a spaces-only project (the synthetic `system`
 * project) or any project with no `database/` tables — there is no store to
 * boot. Later boot steps (types, pages build, crontab, catch-up) live in other
 * phases.
 *
 * The `better-sqlite3`-backed store lives in {@link ./store.ts} (task 2A); this
 * module consumes only its documented API.
 */

import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ColumnSchema, ColumnType, TableSchema } from '@lmthing/core';
import { openProjectDb, restoreFromSql, schemaToCreateTableSql, type ProjectDb } from './store.js';
import { loadProjectApp } from './loader.js';

/** The subset of a `better-sqlite3` Database we call on `ProjectDb.raw`. */
interface RawDb {
  exec(sql: string): unknown;
  pragma?(source: string): unknown;
}

/** A single row of `PRAGMA table_info(<table>)`. */
interface TableInfoRow {
  name: string;
  type: string;
  pk: number;
}

/**
 * Boot one project's app store (steps 1–3). Returns the open {@link ProjectDb},
 * or `null` when the project has no app / no tables to boot.
 * @param projectRoot Absolute path to the project dir (`<root>/<projectId>`).
 */
export async function bootProjectApp(projectRoot: string): Promise<ProjectDb | null> {
  const app = await loadProjectApp(projectRoot);
  // Spaces-only project (e.g. `system`) or an app with no data model → nothing to boot.
  if (!app.hasApp || app.tables.length === 0) return null;

  const dataDir = join(projectRoot, '.data');
  const dbPath = join(dataDir, 'app.db');
  const sqlPath = join(dataDir, 'app.sql');
  await mkdir(dataDir, { recursive: true });

  // ── Step 1: restore (DR only) ──────────────────────────────────────────────
  if (!(await fileExists(dbPath)) && (await fileExists(sqlPath))) {
    const sql = await readFile(sqlPath, 'utf8');
    restoreFromSql(dbPath, sql);
  }

  // ── Step 2: open db (FK pragma set inside) ─────────────────────────────────
  const pdb = openProjectDb(dbPath, { create: true, schemas: app.tables });

  // ── Step 3: reconcile schemas vs live tables ───────────────────────────────
  // A reconcile problem must be ISOLATED to its one table — never abort the whole boot. Bricking the
  // project db here bricks session init for the ENTIRE project (every session errors, silently), so a
  // single divergent table would take down the whole app. A genuinely dangerous divergence (a type or
  // primary-key change reconcileTable still throws on) quarantines just that table with a loud warning;
  // the rest of the app boots so the user keeps access and can repair the schema through THING.
  const live = new Set(pdb.listTables());
  for (const { name, schema } of app.tables) {
    try {
      if (!live.has(name)) {
        rawExec(pdb, schemaToCreateTableSql(name, schema));
        continue;
      }
      reconcileTable(pdb, name, schema);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[app-boot] table "${name}" failed to reconcile — skipping it (the app still boots): ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  return pdb;
}

/**
 * Reconcile one existing table's live columns against its declared schema:
 * additive `ADD COLUMN` for a declared column missing live; **warn and keep** an
 * orphaned live column the schema no longer declares (a harmless drop/rename — no
 * data loss, the app reads only declared columns); **throw** only on a genuinely
 * dangerous divergence (a PK move or a clear text↔numeric type conflict), which
 * `bootProjectApp` isolates to that one table so the rest of the app still boots.
 */
function reconcileTable(pdb: ProjectDb, table: string, schema: TableSchema): void {
  const declared = schema.columns;
  const declaredNames = Object.keys(declared);
  const declaredSet = new Set(declaredNames);
  const liveNames = pdb.tableColumns(table);
  const liveSet = new Set(liveNames);

  // A live column the schema no longer declares (a column drop or rename). This is HARMLESS to boot:
  // SQLite keeps the orphaned column, the app only ever reads/writes the columns it declares, and no
  // data is lost. Dropping/renaming a column in the JSON is a normal schema evolution an authoring
  // agent (or the user) will do, so this must NOT be fatal — throwing here would brick EVERY session
  // in the project (getProjectAppGlobals runs at session init) and leave a non-technical user with a
  // totally unopenable app they cannot even ask THING to repair. Warn and carry on.
  for (const live of liveNames) {
    if (!declaredSet.has(live)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[app-boot] table "${table}": live column "${live}" is absent from database/${table}.json ` +
          `(a column drop or rename). Keeping the orphaned column; the app reads only declared columns.`,
      );
    }
  }

  // Best-effort PK/type conflict detection via PRAGMA table_info (mapping-agnostic).
  const info = tableInfo(pdb, table);
  if (info) {
    const declaredPk = declaredNames.find((n) => declared[n]?.primaryKey);
    const livePk = [...info.entries()].find(([, i]) => i.pk > 0)?.[0];
    if (declaredPk && livePk && declaredPk !== livePk) {
      throw new Error(
        `[app-boot] Non-additive schema divergence in table "${table}": declared primary key "${declaredPk}" ` +
          `conflicts with the live primary key "${livePk}" (a primary-key change is not additive).`,
      );
    }
    for (const cn of declaredNames) {
      const liveCol = liveSet.has(cn) ? info.get(cn) : undefined;
      if (!liveCol) continue;
      const expected = expectedBucket(declared[cn]!.type);
      const actual = affinityBucket(liveCol.type);
      // Only flag the unambiguous text↔numeric contradiction (mapping variants of
      // int/real/numeric all bucket to "numeric", so this never false-positives).
      if ((expected === 'text' && actual === 'numeric') || (expected === 'numeric' && actual === 'text')) {
        throw new Error(
          `[app-boot] Non-additive schema divergence in table "${table}", column "${cn}": declared type ` +
            `"${declared[cn]!.type}" conflicts with the live column type "${liveCol.type}" (a type change is not additive).`,
        );
      }
    }
  }

  // Additive: a declared column missing from the live table.
  for (const cn of declaredNames) {
    if (!liveSet.has(cn)) {
      rawExec(pdb, addColumnSql(table, cn, declared[cn]!));
    }
  }
}

/** Build an additive `ALTER TABLE … ADD COLUMN` DDL (never `NOT NULL`; DEFAULT when a literal default is declared). */
function addColumnSql(table: string, column: string, col: ColumnSchema): string {
  let ddl = `ALTER TABLE ${quoteId(table)} ADD COLUMN ${quoteId(column)} ${sqlAffinity(col.type)}`;
  if (col.default !== undefined) ddl += ` DEFAULT ${literal(col.type, col.default)}`;
  return ddl;
}

/** Read `PRAGMA table_info(<table>)` into a name→{type,pk} map, or `null` if unavailable. */
function tableInfo(pdb: ProjectDb, table: string): Map<string, { type: string; pk: number }> | null {
  const raw = pdb.raw as RawDb;
  if (typeof raw.pragma !== 'function') return null;
  try {
    const rows = raw.pragma(`table_info(${quoteId(table)})`) as TableInfoRow[];
    if (!Array.isArray(rows)) return null;
    const map = new Map<string, { type: string; pk: number }>();
    for (const r of rows) map.set(r.name, { type: String(r.type ?? ''), pk: Number(r.pk ?? 0) });
    return map;
  } catch {
    return null; // best-effort — a missing pragma never blocks boot
  }
}

/** Run raw DDL against the project db. */
function rawExec(pdb: ProjectDb, sql: string): void {
  (pdb.raw as RawDb).exec(sql);
}

/** Declared column type → coarse SQLite storage bucket. */
function expectedBucket(type: ColumnType): 'text' | 'numeric' {
  return type === 'number' || type === 'boolean' ? 'numeric' : 'text';
}

/** A live SQLite declared-type string → coarse bucket (SQLite affinity rules). */
function affinityBucket(typeStr: string): 'text' | 'numeric' | 'blob' | 'unknown' {
  const s = typeStr.toUpperCase();
  if (s === '') return 'unknown';
  if (s.includes('INT')) return 'numeric';
  if (s.includes('CHAR') || s.includes('CLOB') || s.includes('TEXT')) return 'text';
  if (s.includes('BLOB')) return 'blob';
  if (s.includes('REAL') || s.includes('FLOA') || s.includes('DOUB')) return 'numeric';
  return 'numeric'; // NUMERIC affinity
}

/** SQLite affinity used for an additively-added column. */
function sqlAffinity(type: ColumnType): string {
  switch (type) {
    case 'number':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    default:
      return 'TEXT';
  }
}

/** Render a literal DEFAULT value for `ADD COLUMN`. */
function literal(type: ColumnType, value: unknown): string {
  if (type === 'boolean') return value ? '1' : '0';
  if (type === 'number') return String(Number(value));
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Quote a SQLite identifier. */
function quoteId(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/** True when a filesystem path exists. */
async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
