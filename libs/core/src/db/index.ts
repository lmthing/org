/**
 * `@lmthing/core` database subsystem — schema types, runtime data-API
 * interfaces, and the fail-loud schema validator. Interfaces only: the
 * `better-sqlite3`-backed implementation lives in `libs/cli` (this package stays
 * browser-safe, no native deps).
 */

export type {
  BelongsToRelation,
  ColumnReference,
  ColumnSchema,
  ColumnType,
  GeneratedKind,
  HasManyRelation,
  LoadedTable,
  OnDelete,
  RelationSchema,
  TableSchema,
} from './schema.js';
export { isBelongsTo, isHasMany } from './schema.js';

export type {
  ApiCallFn,
  AppCheckError,
  AppCheckResult,
  AsyncDbApi,
  ConnectionRequest,
  ConnectionResolver,
  ConnectionResponse,
  DbApi,
  QueryOpts,
  RemoveOpts,
  Row,
  SpawnFn,
  UpdateOpts,
} from './types.js';

export { validateSchemaSet, validateTableSchema } from './validate.js';
