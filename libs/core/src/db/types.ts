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
  /**
   * Sort order. Three accepted shapes:
   * - `'issued_date'` — a column name (ascending).
   * - `{ column: 'issued_date', dir: 'desc' }` — explicit column + direction.
   * - `{ issued_date: 'desc' }` — the column→direction MAP. Every agent writes this shape (it is
   *   what the appbuilder's own instruct teaches), so the runtime must honour it: before, it fell
   *   through to `opts.orderBy.column === undefined` and every authored list route answered 500
   *   while the raw `app/data/<table>` API — which passes no `orderBy` — looked perfectly healthy.
   */
  orderBy?: string | { column: string; dir?: 'asc' | 'desc' } | Record<string, 'asc' | 'desc'>;
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
 * One programmatic-check failure in a live-project app artifact — the PROGRAMMATIC
 * GROUND TRUTH a build gate reads (never a model self-assessment). `phase` names the
 * check that produced it; `file` is project-relative (`pages/index.tsx`).
 *
 * There are exactly THREE phases, run cheapest-first, and each SHORT-CIRCUITS the next: a
 * failing `typecheck` means `contract` never runs, and a failing `contract` means the esbuild
 * `build` never runs — so a clean later phase is never evidence of anything on a failed check
 * (`sdk/org/libs/cli/src/app/build/check.ts#runProjectAppCheck`). `contract` is
 * `generateProjectContracts` (`app/build/contracts.ts`) — the SAME per-endpoint
 * `ts-json-schema-generator` pass `POST .../app/build` runs — reported as its OWN phase because it
 * is a real, distinct failure mode from a different program than `typecheck`'s: `typecheck` runs
 * ONE whole-program `tsc` pass over `pages/`/`components/`/`api/` PLUS `types/contract.d.ts` as a
 * root, so a project with a well-formed contract typechecks clean even when this phase used to
 * throw — `ts-json-schema-generator` builds its OWN program per handler FILE (`app/build/
 * schema.ts#buildGeneratorConfig`) and, until it was also given `contract.d.ts` as a root, could
 * not resolve a bare global name like `Output = FlightsOutput` even though `tsc` could. Before
 * this phase existed, a contract-generation throw propagated UNCAUGHT out of `buildApp()` — the
 * model saw a raw exception instead of a retryable `{ok:false, errors:[...]}`, and
 * `POST .../app/check` returned a clean `ok:true` for a project that could not actually build
 * (`POST .../app/build` failed). A third `'lint'` member used to be declared here and was never
 * emitted by anything — the write-time contract lint is real (`app/authoring/lint.ts`) but it
 * throws a `LintError` at the WRITER, in the authoring turn; it is not a phase of `buildApp()`.
 * Prompts that promised "buildApp runs the lint" were describing a check that would never appear
 * in this list.
 */
export interface AppCheckError {
  phase: 'typecheck' | 'contract' | 'build';
  file: string;
  line?: number;
  column?: number;
  message: string;
}

/**
 * The structured result of building + checking a live-project app — what the
 * model-facing `buildApp()` global resolves. `ok` ⇔ zero errors; `built` ⇔ a clean
 * esbuild bundle was produced (all routes). A non-empty `errors` is a FAIL the caller
 * feeds back and retries (or surfaces loudly), never a partial ship.
 */
export interface AppCheckResult {
  ok: boolean;
  built: boolean;
  routes: string[];
  errors: AppCheckError[];
}

/** Build + programmatically check the session's live-project app (host-supplied). */
export type AppBuildFn = () => Promise<AppCheckResult>;

/**
 * A single authenticated request to a connected external service, made through
 * the gateway egress proxy. `path` is ALWAYS relative to the provider's API base
 * (the gateway pins the host and rejects absolute URLs); the OAuth token is
 * attached server-side and never enters the pod or the sandbox.
 */
export interface ConnectionRequest {
  /** HTTP method (GET/POST/PUT/PATCH/DELETE). */
  method: string;
  /** Path relative to the provider's API base, e.g. `/gmail/v1/users/me/messages`. */
  path: string;
  /** Query-string params appended to the URL. */
  query?: Record<string, string>;
  /** JSON request body (serialized by the proxy). */
  body?: unknown;
  /** Extra request headers (an `Authorization` header here is ignored — the
   *  gateway attaches the connection's token). */
  headers?: Record<string, string>;
}

/** The proxy's normalized response — `data` is parsed JSON (or text on non-JSON). */
export interface ConnectionResponse {
  ok: boolean;
  status: number;
  data: unknown;
}

/**
 * Resolve a `callConnection()` yield — forward a {@link ConnectionRequest} to the
 * gateway's egress proxy for the named provider and return its normalized
 * response. Host-supplied (libs/cli, from the pod's scoped connections JWT);
 * absent outside a pod with a configured connections gateway, in which case a
 * `callConnection` yield rejects with a clear, retryable error.
 * @param provider The connection provider id (e.g. `google`/`slack`/`github`).
 * @param req      The request to forward.
 * @returns The proxy response.
 */
export type ConnectionResolver = (
  provider: string,
  req: ConnectionRequest,
) => Promise<ConnectionResponse>;

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
