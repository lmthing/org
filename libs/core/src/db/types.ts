/**
 * Runtime data-access API interfaces — the "two typed surfaces generated from
 * one schema".
 *
 * In the **agent** sandbox `db.*` is a **synchronous** host call (execShell-class;
 * fast local SQLite in the same process) — {@link DbApi}. On the **Node** side
 * (api/hook handlers) the same `db` is a **cross-thread proxy**, so every method
 * is `async` — {@link AsyncDbApi}, derived from `DbApi` so the two can never drift.
 * `libs/core` owns only these interfaces; `libs/cli` provides the `better-sqlite3`
 * implementations.
 */

import type { ColumnSchema, TableSchema } from './schema.js';

/** A database row — a bag of column values keyed by column name. */
export type Row = Record<string, unknown>;

/** Options for {@link DbApi.query}. */
export interface QueryOpts {
  /** Equality filter: each key/value must match the row's column value. */
  where?: Record<string, unknown>;
  /** Named relations to expand inline (a join under the hood, e.g. `['comments']`). */
  include?: string[];
  /** Sort order — a column name, or a column plus direction (default `asc`). */
  orderBy?: string | { column: string; dir?: 'asc' | 'desc' };
  /** Maximum number of rows to return. */
  limit?: number;
  /** Number of leading rows to skip (for pagination). */
  offset?: number;
}

/** Options for {@link DbApi.update}. */
export interface UpdateOpts {
  /** Equality filter selecting the rows to update. */
  where: Record<string, unknown>;
  /** Column/value pairs to assign to the matched rows. */
  set: Record<string, unknown>;
}

/** Options for {@link DbApi.remove}. */
export interface RemoveOpts {
  /** Equality filter selecting the rows to delete. */
  where: Record<string, unknown>;
}

/**
 * The **synchronous** agent-side data API (execShell-class host call). Available
 * in the agent sandbox where SQLite runs in the same process, so no turn
 * boundary is crossed. The Node-side mirror is {@link AsyncDbApi}.
 *
 * Method availability is gated per agent by capabilities: `db:read`
 * (`query`/`tables`), `db:write` (`insert`/`update`/`remove`), and `db:schema`
 * (`createTable`/`addColumn`).
 */
export interface DbApi {
  /**
   * Read rows from a table, optionally filtered, sorted, paginated, and with
   * named relations expanded inline.
   * @param table The table name (file basename).
   * @param opts  Query filter/sort/pagination/include options.
   * @returns The matching rows.
   */
  query(table: string, opts?: QueryOpts): Row[];

  /**
   * List the names of all tables in the project's database.
   * @returns The table names.
   */
  tables(): string[];

  /**
   * Insert one row or a batch of rows, filling in `generated`/`default` values.
   * @param table  The table name.
   * @param values A single row or an array of rows.
   * @returns The inserted row(s), shape mirroring the input (single in → single out).
   */
  insert(table: string, values: Row | Row[]): Row | Row[];

  /**
   * Update the columns of every row matching the filter.
   * @param table The table name.
   * @param opts  The `where` filter and `set` assignments.
   * @returns The number of rows updated.
   */
  update(table: string, opts: UpdateOpts): number;

  /**
   * Delete every row matching the filter.
   * @param table The table name.
   * @param opts  The `where` filter.
   * @returns The number of rows deleted.
   */
  remove(table: string, opts: RemoveOpts): number;

  /**
   * Create a new table from a schema (`CREATE TABLE` + relations). Authoring
   * capability (`db:schema`) — evolves the data model live.
   * @param schema The full table schema (the table name comes from `schema.title`/basename convention at the impl layer).
   */
  createTable(schema: TableSchema): void;

  /**
   * Add a column to an existing table (`ALTER TABLE ADD COLUMN`; additive-lenient
   * evolution). Authoring capability (`db:schema`).
   * @param table  The table to alter.
   * @param name   The new column's name.
   * @param column The new column's schema.
   */
  addColumn(table: string, name: string, column: ColumnSchema): void;
}

/**
 * The **asynchronous** Node-side data API for api/hook handlers — the same
 * method set as {@link DbApi} but every method returns a `Promise` of the same
 * result (a cross-thread proxy, so callers `await`). Derived from `DbApi` by a
 * mapped type so the two surfaces can never drift.
 */
export type AsyncDbApi = {
  [K in keyof DbApi]: (...args: Parameters<DbApi[K]>) => Promise<ReturnType<DbApi[K]>>;
};

/**
 * Call a named project/external endpoint by name (the agent/Node named-endpoint
 * call). External services are named bindings (hidden URL + key); own-project
 * endpoints resolve in-process. Gated by the `api:call` allowlist. Typed
 * overloads per endpoint are generated later (Phase 4).
 * @param name  The endpoint name from the `api:call` allowlist.
 * @param input The endpoint input payload.
 * @returns The endpoint's result.
 */
export type ApiCallFn = (name: string, input?: unknown) => Promise<unknown>;

/**
 * Fire-and-forget spawn of an agent action from a Node handler. Returns
 * immediately with a run id; failures surface via the optional `onError`.
 * @param ref   The action reference, shaped `'space/agent#action'`.
 * @param input The action input payload.
 * @param opts  Optional handlers — `onError` is invoked if the run fails.
 * @returns A handle carrying the spawned `runId`.
 */
export type SpawnFn = (
  ref: string,
  input?: unknown,
  opts?: { onError?: (err: unknown) => void },
) => { runId: string };
