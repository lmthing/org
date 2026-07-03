/**
 * Table-schema types for the project `database/<table>.json` files.
 *
 * A project owns its data as a set of JSON table schemas (table name = file
 * basename). Each table and every column and relation carries a **required
 * `description`** — the schema is the agent's mental model of the data, not just
 * its shape — so the loader ({@link ./validate.ts}) fails loud when one is
 * missing. These types describe the on-disk JSON exactly; the runtime row APIs
 * live in {@link ./types.ts}.
 */

/** The primitive value kinds a column may hold. `json` is an arbitrary JSON-serialisable value. */
export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json';

/**
 * How a column's value is auto-generated when a row is inserted without one.
 * - `uuid` — a fresh unique id (recommended for the primary key).
 * - `now`  — the current timestamp.
 */
export type GeneratedKind = 'uuid' | 'now';

/**
 * Referential action applied to this row when the referenced row is deleted.
 * Mirrors the SQLite `FOREIGN KEY … ON DELETE` clause. Defaults to `restrict`.
 */
export type OnDelete = 'cascade' | 'setNull' | 'restrict';

/** A foreign-key reference from a column to another table's column. */
export interface ColumnReference {
  /** The target table name (file basename, e.g. `feed_items`). */
  table: string;
  /** The target column; defaults to the target table's primary key. */
  column?: string;
  /** What happens to this row when the referenced row is deleted (default `restrict`). */
  onDelete?: OnDelete;
}

/**
 * One column in a table schema. `description` is mandatory (agent- and
 * human-facing JSDoc source); all other fields are per-column flags.
 */
export interface ColumnSchema {
  /** The column's value kind. */
  type: ColumnType;
  /** Required, human-readable description — the agent's mental model of this field. */
  description: string;
  /** Marks this column as the table's primary key. Exactly one column per table must set this. */
  primaryKey?: boolean;
  /** Whether a value must be supplied on insert (unless `default`/`generated` provides one). */
  required?: boolean;
  /** Whether values in this column must be unique across rows. */
  unique?: boolean;
  /** A literal default value used when none is supplied on insert. */
  default?: unknown;
  /** Auto-generate the value on insert (`uuid` or `now`). */
  generated?: GeneratedKind;
  /** A foreign-key reference to another table (real SQLite `FOREIGN KEY`). */
  references?: ColumnReference;
}

/**
 * A `belongsTo` relation — this table holds the foreign key pointing at a
 * single row of the target table (the "one" side).
 */
export interface BelongsToRelation {
  /** The target table this row belongs to. */
  belongsTo: string;
  /** The foreign-key column on THIS table that points at the target. */
  via: string;
  /** Required, human-readable description of the link. */
  description: string;
}

/**
 * A `hasMany` relation — the target table holds a foreign key pointing back at
 * this table (the "many" side, expandable via `db.query(..., { include })`).
 */
export interface HasManyRelation {
  /** The target table whose rows point back at this one. */
  hasMany: string;
  /** The foreign-key column on the TARGET table that points at this table. */
  via: string;
  /** Required, human-readable description of the link. */
  description: string;
}

/**
 * A navigable relation between tables. Discriminated by the presence of
 * `belongsTo` (one side) vs `hasMany` (many side).
 */
export type RelationSchema = BelongsToRelation | HasManyRelation;

/**
 * The full schema for one table, matching a `database/<table>.json` file.
 * The table name is the file basename and is NOT stored inside the JSON — see
 * {@link LoadedTable} for the name-carrying pair.
 */
export interface TableSchema {
  /** Display title for the table. */
  title: string;
  /** Required, human-readable description of what the table stores. */
  description: string;
  /** The table's columns, keyed by column name. */
  columns: Record<string, ColumnSchema>;
  /** Named navigable relations to other tables, keyed by relation name. */
  relations?: Record<string, RelationSchema>;
}

/**
 * A {@link TableSchema} paired with its table `name` (the file basename), used
 * for set-level validation where cross-table references must resolve.
 */
export interface LoadedTable {
  /** The table name — the `database/<name>.json` file basename. */
  name: string;
  /** The parsed table schema. */
  schema: TableSchema;
}

/** Type guard: is this relation the `belongsTo` (one) side? */
export function isBelongsTo(rel: RelationSchema): rel is BelongsToRelation {
  return 'belongsTo' in rel;
}

/** Type guard: is this relation the `hasMany` (many) side? */
export function isHasMany(rel: RelationSchema): rel is HasManyRelation {
  return 'hasMany' in rel;
}
