/**
 * `better-sqlite3`-backed project data store — the ONLY place the native
 * `better-sqlite3` module is imported in the whole codebase.
 *
 * A project owns its data as a SQLite database (`<project>/.data/app.db`, WAL).
 * The schemas live on disk as `database/<table>.json` files ({@link TableSchema},
 * table name = file basename); this module turns them into real `CREATE TABLE`
 * statements (with primary keys, `NOT NULL`, `UNIQUE`, `DEFAULT`, and real
 * `FOREIGN KEY … ON DELETE` clauses), and implements the two runtime data
 * surfaces defined in `@lmthing/core`:
 *
 *   - {@link DbApi}      — the **synchronous** agent-side API (same-process host
 *                          call; SQLite runs in the agent's process).
 *   - {@link AsyncDbApi} — a `Promise`-returning mirror for Node handlers. For
 *                          now a thin wrapper (`Promise.resolve(sync)`); a real
 *                          cross-thread proxy is Phase 3.
 *
 * Values are **marshalled** at the boundary so the agent always sees JS scalars
 * (`boolean`, parsed JSON objects, ISO-8601 date strings) rather than the raw
 * SQLite `0/1`/`TEXT` representation. Marshalling needs to know each column's
 * declared {@link ColumnType}; pass the loaded schemas via `openProjectDb(…, {
 * schemas })` so `query`/`insert`/`update` (and relation `include`) know the
 * types and relations. When schemas are absent, types are best-effort inferred
 * from the live table (so `boolean`/`json`/`date` degrade to their storage
 * form) and `include` throws a clear error.
 *
 * Backup is a **`.sql` dump** ({@link ProjectDb.dumpToSql}) — a deterministic,
 * diff-friendly single text file that dodges WAL-file races; {@link
 * restoreFromSql} rebuilds a fresh db from one (disaster-recovery only).
 */

import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import {
  isBelongsTo,
  isHasMany,
  type DbApi,
  type AsyncDbApi,
  type TableSchema,
  type ColumnSchema,
  type ColumnType,
  type OnDelete,
  type ColumnReference,
  type LoadedTable,
  type Row,
  type QueryOpts,
  type UpdateOpts,
  type RemoveOpts,
} from '@lmthing/core';

/** The public handle returned by {@link openProjectDb}. */
/** Fired (main-process, synchronously after commit) on every row-mutating db write, so the
 *  Phase-6 hook dispatcher can enqueue matching `database` hooks. `rows` carries the inserted
 *  rows for `insert`; for `update`/`remove` it is empty (the affected rows are not re-queried). */
export type WriteListener = (e: { table: string; event: 'insert' | 'update' | 'remove'; rows: unknown[] }) => void;

export interface ProjectDb {
  /** The **synchronous** agent-side data API (same-process host call). */
  db: DbApi;
  /** Install (or clear) the write listener that fires on insert/update/remove — the seam the
   *  Phase-6 hook dispatcher uses to react to db changes. Set after boot by the integrator. */
  setOnWrite(fn: WriteListener | undefined): void;
  /**
   * A `Promise`-returning mirror of {@link db} for Node handlers. Currently a
   * thin wrapper (each method returns `Promise.resolve(sync-result)`); a real
   * cross-thread proxy is Phase 3.
   */
  async: AsyncDbApi;
  /** The underlying `better-sqlite3` handle (boot reconcile inspects it). */
  raw: Database.Database;
  /** Full schema + data `.sql` dump (deterministic; for the GitHub backup). */
  dumpToSql(): string;
  /** The user tables present in the live db (excludes `sqlite_*` internal). */
  listTables(): string[];
  /** The column names of a live table (for the boot reconcile diff). */
  tableColumns(table: string): string[];
  /** Close the underlying handle. */
  close(): void;
}

/** Options for {@link openProjectDb}. */
export interface OpenProjectDbOpts {
  /** Create the db file if absent (default `true`). */
  create?: boolean;
  /**
   * The loaded table schemas (name + schema). Passed so `query`/`insert`/
   * `update` marshalling knows column types and relation `include` can resolve
   * links. Strongly preferred; when omitted, types are inferred from the live
   * table and `include` throws.
   */
  schemas?: LoadedTable[];
  /** Initial write listener (Phase 6 hook dispatch); also settable later via `setOnWrite`. */
  onWrite?: WriteListener;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type mapping & value marshalling
// ─────────────────────────────────────────────────────────────────────────────

/** Map a schema {@link ColumnType} to its SQLite storage type. */
function sqlType(type: ColumnType): 'TEXT' | 'REAL' | 'INTEGER' {
  switch (type) {
    case 'number':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    case 'string':
    case 'date':
    case 'json':
    default:
      return 'TEXT';
  }
}

/** Best-effort inverse: a live SQLite declared type → a {@link ColumnType}. */
function inferColumnType(sqliteDecl: string): ColumnType {
  const t = sqliteDecl.toUpperCase();
  if (t.includes('INT')) return 'number';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'number';
  // TEXT and everything else collapses to string (boolean/json/date are lossy
  // without a schema — pass `schemas` to recover them).
  return 'string';
}

/** Marshal a JS value → the SQLite scalar for a column of the given type (write). */
function toSqlite(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'boolean':
      return value ? 1 : 0;
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'json':
      return JSON.stringify(value);
    case 'date':
      return value instanceof Date ? value.toISOString() : String(value);
    case 'string':
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

/** Marshal a SQLite scalar → the JS value for a column of the given type (read). */
function fromSqlite(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'boolean':
      return value !== 0;
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'json':
      return typeof value === 'string' ? JSON.parse(value) : value;
    case 'date':
      return String(value);
    case 'string':
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

/** Encode a raw SQLite scalar as a SQL literal (for the `.sql` dump). */
function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Quote a SQL identifier (table/column name). */
function ident(name: string): string {
  // Fail LOUDLY on a non-string: an undefined column used to surface as the opaque
  // "Cannot read properties of undefined (reading 'replace')" inside a 500, which tells the
  // agent that authored the handler nothing about what it got wrong.
  if (typeof name !== 'string' || name === '') {
    throw new Error(`store: invalid SQL identifier ${JSON.stringify(name)} (expected a column/table name)`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Normalize every accepted `orderBy` shape to `{ col, dir }` (see {@link QueryOpts.orderBy}).
 *
 * The column→direction MAP (`{ issued_date: 'desc' }`) is the shape agents actually write — it is
 * what the appbuilder's instruct teaches — so it must work, not 500.
 */
function normalizeOrderBy(orderBy: QueryOpts['orderBy']): { col: string; dir: 'ASC' | 'DESC' } | null {
  if (!orderBy) return null;
  const up = (d: unknown): 'ASC' | 'DESC' => (String(d).toUpperCase() === 'DESC' ? 'DESC' : 'ASC');
  if (typeof orderBy === 'string') return { col: orderBy, dir: 'ASC' };
  if (typeof (orderBy as { column?: unknown }).column === 'string') {
    const o = orderBy as { column: string; dir?: string };
    return { col: o.column, dir: up(o.dir ?? 'asc') };
  }
  const [col, dir] = Object.entries(orderBy as Record<string, unknown>)[0] ?? [];
  return typeof col === 'string' && col !== '' ? { col, dir: up(dir) } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE TABLE / ALTER TABLE SQL
// ─────────────────────────────────────────────────────────────────────────────

/** Map a schema `onDelete` to its SQLite clause. */
function onDeleteClause(onDelete: OnDelete): string {
  switch (onDelete) {
    case 'cascade':
      return 'CASCADE';
    case 'setNull':
      return 'SET NULL';
    case 'restrict':
    default:
      return 'RESTRICT';
  }
}

/** Build the `REFERENCES target(col) ON DELETE …` fragment for a column reference. */
function foreignKeyReferenceClause(ref: ColumnReference): string {
  // Omitting the column makes SQLite reference the target's PRIMARY KEY, which
  // matches the schema's "column defaults to the target's primary key" rule.
  const target = ref.column ? `${ident(ref.table)}(${ident(ref.column)})` : ident(ref.table);
  return `REFERENCES ${target} ON DELETE ${onDeleteClause(ref.onDelete ?? 'restrict')}`;
}

/** Build the per-column definition fragment for a `CREATE TABLE` / `ALTER TABLE`. */
function columnDefSql(colName: string, column: ColumnSchema, forAlter: boolean): string {
  const parts = [ident(colName), sqlType(column.type)];
  // PRIMARY KEY / UNIQUE are illegal on `ALTER TABLE ADD COLUMN`.
  if (!forAlter && column.primaryKey) parts.push('PRIMARY KEY');
  if (column.required && !column.primaryKey) parts.push('NOT NULL');
  if (!forAlter && column.unique && !column.primaryKey) parts.push('UNIQUE');
  if (column.default !== undefined) {
    parts.push(`DEFAULT ${sqlLiteral(toSqlite(column.type, column.default))}`);
  }
  // An inline `REFERENCES` is legal on `ALTER TABLE ADD COLUMN`; a table-level
  // `FOREIGN KEY` is emitted separately for the `CREATE TABLE` path.
  if (forAlter && column.references) {
    parts.push(foreignKeyReferenceClause(column.references));
  }
  return parts.join(' ');
}

/**
 * Build the `CREATE TABLE` statement for a table schema. **This is the
 * authoritative path** the loader/boot uses, passing the real table name (the
 * `database/<name>.json` basename) — the name is NOT read from the schema JSON.
 *
 * @param name   The table name (file basename).
 * @param schema The parsed table schema.
 * @returns A single `CREATE TABLE …` statement (no trailing semicolon).
 */
export function schemaToCreateTableSql(name: string, schema: TableSchema): string {
  const columnDefs = Object.entries(schema.columns).map(([colName, column]) =>
    columnDefSql(colName, column, false),
  );
  const fkDefs = Object.entries(schema.columns)
    .filter(([, column]) => column.references)
    .map(
      ([colName, column]) =>
        `FOREIGN KEY (${ident(colName)}) ${foreignKeyReferenceClause(column.references!)}`,
    );
  const body = [...columnDefs, ...fkDefs].join(', ');
  return `CREATE TABLE ${ident(name)} (${body})`;
}

/**
 * Slugify a table title into a table name — the fallback the agent-facing
 * `db.createTable(schema)` uses, since its {@link DbApi.createTable} signature
 * carries no name argument. The **authoritative** path is
 * {@link schemaToCreateTableSql}, which boot/migrations call with the real
 * `database/<name>.json` basename resolved by the loader.
 */
function slugifyTitle(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'table'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open (or create) the project SQLite database at `dbPath`, returning the
 * {@link ProjectDb} handle. Sets `PRAGMA journal_mode=WAL` and
 * `PRAGMA foreign_keys=ON`, and `mkdir -p`s the parent directory.
 */
export function openProjectDb(dbPath: string, opts: OpenProjectDbOpts = {}): ProjectDb {
  const create = opts.create ?? true;
  mkdirSync(dirname(dbPath), { recursive: true });

  const raw = new Database(dbPath, { fileMustExist: !create });
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  // Schema registry — maps a live table name to the loaded schema, so
  // marshalling knows column types and `include` can resolve relations. Seeded
  // from `opts.schemas` and kept in sync by createTable/addColumn.
  // A defensive shallow clone (incl. the `columns` map) so `addColumn` mutating
  // a registry entry never leaks back into the caller's schema objects.
  const cloneSchema = (schema: TableSchema): TableSchema => ({
    ...schema,
    columns: { ...schema.columns },
  });
  const registry = new Map<string, TableSchema>();
  for (const { name, schema } of opts.schemas ?? []) registry.set(name, cloneSchema(schema));

  /** Resolve a table's column → {@link ColumnType} map (schema-first, live fallback). */
  function columnTypes(table: string): Map<string, ColumnType> {
    const out = new Map<string, ColumnType>();
    const schema = registry.get(table);
    if (schema) {
      for (const [col, def] of Object.entries(schema.columns)) out.set(col, def.type);
      return out;
    }
    // No schema — infer from the live table (lossy for boolean/json/date).
    const info = raw.prepare(`PRAGMA table_info(${ident(table)})`).all() as Array<{
      name: string;
      type: string;
    }>;
    for (const c of info) out.set(c.name, inferColumnType(c.type));
    return out;
  }

  /** The primary-key column of a table (schema-first, live fallback). */
  function primaryKeyOf(table: string): string {
    const schema = registry.get(table);
    if (schema) {
      const pk = Object.entries(schema.columns).find(([, c]) => c.primaryKey)?.[0];
      if (pk) return pk;
    }
    const info = raw.prepare(`PRAGMA table_info(${ident(table)})`).all() as Array<{
      name: string;
      pk: number;
    }>;
    const pk = info.find((c) => c.pk > 0);
    if (!pk) throw new Error(`store: table "${table}" has no primary key`);
    return pk.name;
  }

  /** Marshal a whole raw SQLite row → a JS row using the table's column types. */
  function marshalRow(table: string, rawRow: Row): Row {
    const types = columnTypes(table);
    const out: Row = {};
    for (const [col, value] of Object.entries(rawRow)) {
      const t = types.get(col) ?? 'string';
      out[col] = fromSqlite(t, value);
    }
    return out;
  }

  function listTables(): string[] {
    const rows = raw
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  function tableColumns(table: string): string[] {
    const info = raw.prepare(`PRAGMA table_info(${ident(table)})`).all() as Array<{
      name: string;
      cid: number;
    }>;
    return info.map((c) => c.name);
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  function insertOne(table: string, values: Row): Row {
    const schema = registry.get(table);
    const types = columnTypes(table);
    const row: Row = { ...values };

    // Apply generated + default values for columns missing from the input.
    if (schema) {
      for (const [col, def] of Object.entries(schema.columns)) {
        if (row[col] !== undefined) continue;
        if (def.generated === 'uuid') row[col] = randomUUID();
        else if (def.generated === 'now') row[col] = new Date().toISOString();
        else if (def.default !== undefined) row[col] = def.default;
      }
    }

    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(', ');
    const bind = cols.map((c) => toSqlite(types.get(c) ?? 'string', row[c]));
    const sql =
      cols.length === 0
        ? `INSERT INTO ${ident(table)} DEFAULT VALUES RETURNING *`
        : `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const inserted = raw.prepare(sql).get(...bind) as Row;
    return marshalRow(table, inserted);
  }

  function insert(table: string, values: Row | Row[]): Row | Row[] {
    if (Array.isArray(values)) {
      const txn = raw.transaction((rows: Row[]) => rows.map((r) => insertOne(table, r)));
      return txn(values);
    }
    return insertOne(table, values);
  }

  /** Build a `WHERE` clause + bind values from an equality map. */
  function buildWhere(
    table: string,
    where: Record<string, unknown> | undefined,
  ): { clause: string; binds: unknown[] } {
    if (!where || Object.keys(where).length === 0) return { clause: '', binds: [] };
    const types = columnTypes(table);
    const cols = Object.keys(where);
    const clause =
      ' WHERE ' +
      cols
        .map((c) => (where[c] === null ? `${ident(c)} IS NULL` : `${ident(c)} = ?`))
        .join(' AND ');
    const binds = cols
      .filter((c) => where[c] !== null)
      .map((c) => toSqlite(types.get(c) ?? 'string', where[c]));
    return { clause, binds };
  }

  function update(table: string, o: UpdateOpts): number {
    const types = columnTypes(table);
    const setCols = Object.keys(o.set);
    if (setCols.length === 0) return 0;
    const setClause = setCols.map((c) => `${ident(c)} = ?`).join(', ');
    const setBinds = setCols.map((c) => toSqlite(types.get(c) ?? 'string', o.set[c]));
    const { clause, binds } = buildWhere(table, o.where);
    const info = raw
      .prepare(`UPDATE ${ident(table)} SET ${setClause}${clause}`)
      .run(...setBinds, ...binds);
    return info.changes;
  }

  function remove(table: string, o: RemoveOpts): number {
    const { clause, binds } = buildWhere(table, o.where);
    const info = raw.prepare(`DELETE FROM ${ident(table)}${clause}`).run(...binds);
    return info.changes;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  function query(table: string, opts: QueryOpts = {}): Row[] {
    const { clause, binds } = buildWhere(table, opts.where);
    let sql = `SELECT * FROM ${ident(table)}${clause}`;
    const order = normalizeOrderBy(opts.orderBy);
    if (order) sql += ` ORDER BY ${ident(order.col)} ${order.dir}`;
    if (opts.limit !== undefined) sql += ` LIMIT ${Number(opts.limit)}`;
    if (opts.offset !== undefined) {
      // SQLite requires a LIMIT before OFFSET.
      if (opts.limit === undefined) sql += ` LIMIT -1`;
      sql += ` OFFSET ${Number(opts.offset)}`;
    }
    const rawRows = raw.prepare(sql).all(...binds) as Row[];
    const rows = rawRows.map((r) => marshalRow(table, r));

    if (opts.include && opts.include.length > 0) expandIncludes(table, rows, opts.include);
    return rows;
  }

  /** Expand declared relations for each row (belongsTo → object, hasMany → array). */
  function expandIncludes(table: string, rows: Row[], include: string[]): void {
    const schema = registry.get(table);
    if (!schema) {
      throw new Error(
        `store: query "include" for table "${table}" requires the loaded schemas — pass { schemas } to openProjectDb`,
      );
    }
    for (const relName of include) {
      const rel = schema.relations?.[relName];
      if (!rel) throw new Error(`store: table "${table}" has no relation "${relName}"`);
      if (isBelongsTo(rel)) {
        // This table holds the FK (`via`) pointing at one target row.
        const targetPk = primaryKeyOf(rel.belongsTo);
        for (const row of rows) {
          const fk = row[rel.via];
          row[relName] =
            fk === null || fk === undefined
              ? null
              : query(rel.belongsTo, { where: { [targetPk]: fk } })[0] ?? null;
        }
      } else if (isHasMany(rel)) {
        // The target table holds the FK (`via`) pointing back at this row's PK.
        const thisPk = primaryKeyOf(table);
        for (const row of rows) {
          row[relName] = query(rel.hasMany, { where: { [rel.via]: row[thisPk] } });
        }
      }
    }
  }

  // ── Schema authoring ────────────────────────────────────────────────────────

  function createTable(schema: TableSchema): void {
    // `DbApi.createTable(schema)` carries no name arg; the agent-facing path
    // slugifies `schema.title`. Boot/migrations use the authoritative
    // `schemaToCreateTableSql(name, schema)` with the real basename instead.
    const name = slugifyTitle(schema.title);
    raw.exec(schemaToCreateTableSql(name, schema));
    registry.set(name, cloneSchema(schema));
  }

  function addColumn(table: string, name: string, column: ColumnSchema): void {
    raw.exec(`ALTER TABLE ${ident(table)} ADD COLUMN ${columnDefSql(name, column, true)}`);
    // Keep the registry in sync so subsequent marshalling knows the new type.
    const schema = registry.get(table);
    if (schema) schema.columns[name] = column;
  }

  function tables(): string[] {
    return listTables();
  }

  // ── Dump / restore ──────────────────────────────────────────────────────────

  function dumpToSql(): string {
    const out: string[] = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
    for (const table of listTables()) {
      const createSql = (
        raw
          .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
          .get(table) as { sql: string }
      ).sql;
      out.push(`${createSql};`);
      const pk = safePrimaryKey(table);
      const orderBy = pk ? ` ORDER BY ${ident(pk)}` : '';
      const cols = tableColumns(table);
      const dataRows = raw.prepare(`SELECT * FROM ${ident(table)}${orderBy}`).all() as Row[];
      for (const row of dataRows) {
        const values = cols.map((c) => sqlLiteral(row[c])).join(', ');
        out.push(
          `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES (${values});`,
        );
      }
    }
    out.push('COMMIT;');
    return out.join('\n') + '\n';
  }

  /** Primary key of a live table, or `undefined` if none — used for dump ordering. */
  function safePrimaryKey(table: string): string | undefined {
    try {
      return primaryKeyOf(table);
    } catch {
      return undefined;
    }
  }

  // Write listener seam (Phase 6): fires synchronously after a committed row mutation.
  let writeListener: WriteListener | undefined = opts.onWrite;
  const notify = (event: 'insert' | 'update' | 'remove', table: string, rows: unknown[]): void => {
    if (writeListener) { try { writeListener({ table, event, rows }); } catch { /* dispatch is best-effort */ } }
  };

  const db: DbApi = {
    query,
    tables,
    insert: (table, values) => {
      const r = insert(table, values);
      notify('insert', table, Array.isArray(r) ? r : [r]);
      return r;
    },
    update: (table, o) => {
      const n = update(table, o);
      if (n > 0) notify('update', table, []);
      return n;
    },
    remove: (table, o) => {
      const n = remove(table, o);
      if (n > 0) notify('remove', table, []);
      return n;
    },
    createTable,
    addColumn,
  };

  const async: AsyncDbApi = {
    query: (...a) => Promise.resolve(db.query(...a)),
    tables: (...a) => Promise.resolve(db.tables(...a)),
    insert: (...a) => Promise.resolve(db.insert(...a)),
    update: (...a) => Promise.resolve(db.update(...a)),
    remove: (...a) => Promise.resolve(db.remove(...a)),
    createTable: (...a) => Promise.resolve(db.createTable(...a)),
    addColumn: (...a) => Promise.resolve(db.addColumn(...a)),
  };

  return {
    db,
    async,
    raw,
    dumpToSql,
    listTables,
    tableColumns,
    close: () => raw.close(),
    setOnWrite: (fn) => { writeListener = fn; },
  };
}

/**
 * Rebuild a fresh SQLite database at `dbPath` from a `.sql` dump produced by
 * {@link ProjectDb.dumpToSql} (disaster recovery only). Any existing db file at
 * `dbPath` (and its `-wal`/`-shm` siblings) is removed first.
 */
export function restoreFromSql(dbPath: string, sql: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
  }
  const raw = new Database(dbPath);
  try {
    raw.pragma('journal_mode = WAL');
    raw.exec(sql);
    raw.pragma('foreign_keys = ON');
  } finally {
    raw.close();
  }
}
