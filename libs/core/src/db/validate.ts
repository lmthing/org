/**
 * Fail-loud, dependency-free validator for `database/<table>.json` schemas.
 *
 * Mirrors the loader precedent in {@link ../spaces/load.ts}: rather than
 * silently tolerating a malformed schema, every problem throws an `Error` whose
 * message names the offending table/column/relation so the author gets an
 * actionable fix. {@link validateTableSchema} checks one table in isolation;
 * {@link validateSchemaSet} additionally resolves cross-table `references` and
 * `relations` across the whole set.
 */

import {
  isBelongsTo,
  isHasMany,
  type ColumnSchema,
  type LoadedTable,
  type RelationSchema,
  type TableSchema,
} from './schema.js';

const COLUMN_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'date',
  'json',
]);

const GENERATED_KINDS: ReadonlySet<string> = new Set(['uuid', 'now']);

/** Extract the target table name from either relation shape. */
function relationTarget(rel: RelationSchema): string {
  return isBelongsTo(rel) ? rel.belongsTo : isHasMany(rel) ? rel.hasMany : '';
}

/**
 * Validate a single table schema in isolation (no cross-table resolution).
 * Fails loud on: missing table/column/relation description, an unknown column
 * `type`, an unknown `generated` kind, or not exactly one primary-key column.
 *
 * @param name   The table name (file basename), used in error messages.
 * @param schema The parsed table schema to validate.
 * @throws Error with a message naming the offending table/column/relation.
 */
export function validateTableSchema(name: string, schema: TableSchema): void {
  if (typeof schema.description !== 'string' || schema.description.trim() === '') {
    throw new Error(`${name}: table is missing required "description"`);
  }

  if (!schema.columns || typeof schema.columns !== 'object') {
    throw new Error(`${name}: table is missing required "columns"`);
  }

  const columnNames = Object.keys(schema.columns);
  if (columnNames.length === 0) {
    throw new Error(`${name}: table must declare at least one column`);
  }

  let primaryKeyCount = 0;
  for (const [columnName, column] of Object.entries(schema.columns)) {
    validateColumn(name, columnName, column);
    if (column.primaryKey) primaryKeyCount++;
  }

  if (primaryKeyCount !== 1) {
    throw new Error(
      `${name}: table must have exactly one primaryKey column (found ${primaryKeyCount})`,
    );
  }

  if (schema.relations) {
    for (const [relationName, relation] of Object.entries(schema.relations)) {
      if (
        typeof relation.description !== 'string' ||
        relation.description.trim() === ''
      ) {
        throw new Error(
          `${name}.${relationName}: relation is missing required "description"`,
        );
      }
      if (!isBelongsTo(relation) && !isHasMany(relation)) {
        throw new Error(
          `${name}.${relationName}: relation must declare either "belongsTo" or "hasMany"`,
        );
      }
      if (typeof relation.via !== 'string' || relation.via.trim() === '') {
        throw new Error(`${name}.${relationName}: relation is missing required "via" column`);
      }
    }
  }
}

/** Validate one column's intrinsic shape (description, type, generated kind). */
function validateColumn(table: string, column: string, schema: ColumnSchema): void {
  if (typeof schema.description !== 'string' || schema.description.trim() === '') {
    throw new Error(`${table}.${column}: column is missing required "description"`);
  }
  if (!COLUMN_TYPES.has(schema.type)) {
    throw new Error(
      `${table}.${column}: unknown column type "${String(schema.type)}" (expected one of ${[...COLUMN_TYPES].join(', ')})`,
    );
  }
  if (schema.generated !== undefined && !GENERATED_KINDS.has(schema.generated)) {
    throw new Error(
      `${table}.${column}: unknown "generated" kind "${String(schema.generated)}" (expected uuid or now)`,
    );
  }
}

/**
 * Validate a whole set of tables: runs {@link validateTableSchema} on each, then
 * resolves cross-table links. Fails loud on: a `references` whose `table` or
 * `column` does not resolve; a relation whose target table or `via` column does
 * not exist.
 *
 * @param tables The full set of loaded tables (name + schema).
 * @throws Error with a message naming the offending table/column/relation.
 */
export function validateSchemaSet(tables: LoadedTable[]): void {
  for (const { name, schema } of tables) {
    validateTableSchema(name, schema);
  }

  const byName = new Map<string, TableSchema>();
  for (const { name, schema } of tables) {
    if (byName.has(name)) {
      throw new Error(`${name}: duplicate table name in schema set`);
    }
    byName.set(name, schema);
  }

  const primaryKeyOf = (schema: TableSchema): string | undefined =>
    Object.entries(schema.columns).find(([, c]) => c.primaryKey)?.[0];

  for (const { name, schema } of tables) {
    // Resolve foreign-key references.
    for (const [columnName, column] of Object.entries(schema.columns)) {
      const ref = column.references;
      if (!ref) continue;
      const target = byName.get(ref.table);
      if (!target) {
        throw new Error(
          `${name}.${columnName}: references unknown table "${ref.table}"`,
        );
      }
      const targetColumn = ref.column ?? primaryKeyOf(target);
      if (!targetColumn || !(targetColumn in target.columns)) {
        throw new Error(
          `${name}.${columnName}: references unknown column "${ref.table}.${String(ref.column ?? targetColumn)}"`,
        );
      }
    }

    // Resolve relations.
    if (!schema.relations) continue;
    for (const [relationName, relation] of Object.entries(schema.relations)) {
      const targetName = relationTarget(relation);
      const target = byName.get(targetName);
      if (!target) {
        throw new Error(
          `${name}.${relationName}: relation targets unknown table "${targetName}"`,
        );
      }
      // The `via` FK column lives on the "this" table for belongsTo and on the
      // "target" table for hasMany.
      const viaHost = isHasMany(relation) ? target : schema;
      const viaHostName = isHasMany(relation) ? targetName : name;
      if (!(relation.via in viaHost.columns)) {
        throw new Error(
          `${name}.${relationName}: relation "via" column "${viaHostName}.${relation.via}" does not exist`,
        );
      }
    }
  }
}
