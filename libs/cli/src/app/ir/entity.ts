/**
 * The **entity model IR** — `model/<entity>.entity.json` (W7 / APPFORMAT §2.1).
 *
 * You author FACTS, not columns: `compileEntity` ({@link compileEntity}) is the `compile()` half of
 * W7 — it projects an {@link EntityIr} into the exact `TableSchema` shape `database/<name>.json`
 * already carries (`store.ts`/`schema.ts` never change), so a rebuild becomes "bind a new column to an
 * existing fact, or declare a new one" instead of a second opinion on the whole table. The enforcement
 * this buys, checked here (mechanically, at write time — not left to a downstream gate):
 *
 *   - **one vocabulary per fact, forever** — an enum fact's `values` may only ever GROW (a second
 *     build that drops or renames a value is rejected), tracked via an optional fact registry the
 *     caller assembles from the project's other `model/*.entity.json` files.
 *   - **a fact key names exactly one column** — two fields in the same entity sharing a `fact` is a
 *     collision error, and re-declaring an existing fact under a DIFFERENT entity/field is too.
 *   - **a `money` field's `currencyField` must be real** — a bare integer with no currency companion
 *     is not `money`, it is a `number` mislabeled.
 *
 * `source` (a material span or an answered-question id) is carried through unenforced here — the
 * grounding gate that fails a missing source (§10 L2) is W10's job, not the compiler's; this module's
 * job is the shape, not the provenance.
 */

import type { ColumnSchema, ColumnType, RelationSchema, TableSchema } from '@lmthing/core';

/** The entity-model field types (§2.1) — a strictly richer vocabulary than {@link ColumnType}, each
 *  projecting onto one (or, for `money`, one plus a require-a-companion check). */
export type EntityFieldType =
  | 'id'
  | 'string'
  | 'text'
  | 'number'
  | 'decimal'
  | 'money'
  | 'boolean'
  | 'date'
  | 'json'
  | 'enum'
  | 'ref';

/** One fact — a field of an {@link EntityIr}. */
export interface EntityField {
  /** The stable semantic key (`job.status`). Unique within the entity; tracked across entities via
   *  an optional fact registry so a rebuild cannot mint a second name for the same concept. */
  fact: string;
  type: EntityFieldType;
  /** `type: "ref"` — the target entity name. */
  to?: string;
  /** `type: "enum"` — the closed value set. Extend-only across rebuilds. */
  values?: string[];
  /** `type: "decimal"` — a unit label (metadata only; still stored as `number`). */
  unit?: string;
  /** `type: "money"` — the name of ANOTHER field in this entity (string or enum) holding the
   *  currency code. A bare integer with no currency companion is not money. */
  currencyField?: string;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  description?: string;
  /** A span in the material, an answered-question id, or `"derived"`. Unenforced here — see module
   *  doc — carried through so a later gate (or a human) can audit it. */
  source?: string;
}

/** One relation — passed through structurally unchanged to {@link TableSchema.relations}. */
export type EntityRelation =
  | { hasMany: string; via: string; description: string }
  | { belongsTo: string; via: string; description: string };

/** The entity-model IR — one `model/<entity>.entity.json`. */
export interface EntityIr {
  entity: string;
  title: string;
  /** The identity field's name (defaults to the sole `type: "id"` field). */
  identity?: string;
  fields: Record<string, EntityField>;
  relations?: Record<string, EntityRelation>;
}

/** A registry entry for one previously-declared fact — carried across a rebuild so `values` can only
 *  grow and a fact key cannot silently move to a different entity/field. */
export interface FactRecord {
  entity: string;
  field: string;
  type: EntityFieldType;
  values?: string[];
}

export interface ValidateEntityOpts {
  /** `fact key → where it was previously declared` — assembled from the project's OTHER
   *  `model/*.entity.json` files (and, for a rebuild, this entity's own prior version). Absent ⇒ no
   *  cross-build history to check against (a fresh project). */
  existingFacts?: Map<string, FactRecord>;
  /** `entity name → its declared field names`, for validating a `belongsTo` relation's `via` column
   *  exists on THIS entity. Absent ⇒ that check is skipped (still valid to author entities one at a
   *  time before every relation target exists). */
  knownEntities?: Set<string>;
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
}

const FIELD_TYPES = new Set<EntityFieldType>([
  'id', 'string', 'text', 'number', 'decimal', 'money', 'boolean', 'date', 'json', 'enum', 'ref',
]);
/** Entity names ARE table names verbatim (`compileEntity`'s `tableName`) — same alphabet as
 *  `TABLE_NAME_RE` in `authoring/globals.ts` (snake_case, since it is used unquoted in `CREATE TABLE`). */
const ENTITY_NAME_RE = /^[a-z][a-z0-9_]*$/;
const FIELD_NAME_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * Validate an entity IR: shape, fact-key uniqueness within the entity, `money`/`enum`/`ref`
 * companion requirements, and — when {@link ValidateEntityOpts.existingFacts} is given — the
 * cross-build fact-registry rules (one vocabulary per fact forever; a fact key names one column).
 */
export function validateEntityIr(ir: unknown, opts: ValidateEntityOpts = {}): ValidateResult {
  const errors: string[] = [];
  const push = (m: string) => errors.push(m);

  if (!ir || typeof ir !== 'object' || Array.isArray(ir)) {
    return { ok: false, errors: ['an entity IR must be an object'] };
  }
  const e = ir as Record<string, unknown>;

  if (typeof e.entity !== 'string' || !ENTITY_NAME_RE.test(e.entity)) {
    push(`"entity" must be a lowercase name (/${ENTITY_NAME_RE.source}/) — got ${JSON.stringify(e.entity)}`);
  }
  if (typeof e.title !== 'string' || !e.title.trim()) {
    push('"title" (a human-readable label) is required');
  }
  if (!e.fields || typeof e.fields !== 'object' || Array.isArray(e.fields)) {
    return { ok: false, errors: [...errors, '"fields" (a map of fieldName → fact def) is required'] };
  }
  const fields = e.fields as Record<string, EntityField>;
  const fieldNames = Object.keys(fields);
  if (fieldNames.length === 0) push('an entity needs at least one field');

  const factKeysSeen = new Map<string, string>(); // fact -> field name (within THIS entity)
  const idFields: string[] = [];

  for (const [fieldName, f] of Object.entries(fields)) {
    if (!FIELD_NAME_RE.test(fieldName)) {
      push(`field "${fieldName}": not a valid identifier (/${FIELD_NAME_RE.source}/)`);
    }
    if (!f || typeof f !== 'object') {
      push(`field "${fieldName}": must be an object`);
      continue;
    }
    if (typeof f.fact !== 'string' || !f.fact.trim()) {
      push(`field "${fieldName}": "fact" (a stable semantic key) is required`);
    } else {
      const priorField = factKeysSeen.get(f.fact);
      if (priorField) {
        push(`field "${fieldName}": fact "${f.fact}" is already used by field "${priorField}" in this entity — a fact key names exactly ONE column`);
      }
      factKeysSeen.set(f.fact, fieldName);
    }
    if (!FIELD_TYPES.has(f.type)) {
      push(`field "${fieldName}": "type" must be one of ${[...FIELD_TYPES].join(', ')} — got ${JSON.stringify(f.type)}`);
      continue;
    }
    if (f.type === 'id') idFields.push(fieldName);
    if (f.type === 'ref' && (typeof f.to !== 'string' || !f.to)) {
      push(`field "${fieldName}" (type: ref): "to" (the target entity) is required`);
    }
    if (f.type === 'enum') {
      if (!Array.isArray(f.values) || f.values.length === 0 || !f.values.every((v) => typeof v === 'string')) {
        push(`field "${fieldName}" (type: enum): "values" must be a non-empty array of strings`);
      }
    }
    if (f.type === 'money') {
      if (typeof f.currencyField !== 'string' || !f.currencyField) {
        push(`field "${fieldName}" (type: money): "currencyField" is required (name another field on this entity holding the currency code) — a bare integer with no currency companion is not money`);
      } else {
        const companion = fields[f.currencyField];
        if (!companion) {
          push(`field "${fieldName}": currencyField "${f.currencyField}" does not exist on this entity`);
        } else if (companion.type !== 'string' && companion.type !== 'enum') {
          push(`field "${fieldName}": currencyField "${f.currencyField}" must be type "string" or "enum" (got "${companion.type}")`);
        }
      }
    }

    // Fact-registry checks (cross-entity / cross-rebuild history).
    if (opts.existingFacts && typeof f.fact === 'string') {
      const prior = opts.existingFacts.get(f.fact);
      if (prior && (prior.entity !== e.entity || prior.field !== fieldName)) {
        push(`field "${fieldName}": fact "${f.fact}" was previously declared on ${prior.entity}.${prior.field} — a fact key cannot move to a different column. Use a new fact key, or fix the field name to match.`);
      }
      if (prior && f.type === 'enum' && prior.values) {
        const dropped = prior.values.filter((v) => !(f.values ?? []).includes(v));
        if (dropped.length) {
          push(`field "${fieldName}": enum fact "${f.fact}" DROPPED value(s) ${dropped.map((v) => `"${v}"`).join(', ')} — one vocabulary per fact, forever. Extend "values", never remove or rename.`);
        }
      }
    }
  }

  if (idFields.length > 1) {
    push(`only one field may be type "id" (got ${idFields.join(', ')}) — an entity has one identity`);
  }
  const identity = typeof e.identity === 'string' ? e.identity : idFields[0];
  if (identity && !fields[identity]) {
    push(`"identity": "${identity}" names no field on this entity`);
  } else if (identity && fields[identity]?.type !== 'id') {
    push(`"identity": "${identity}" must be a field of type "id"`);
  }
  if (!identity) {
    push('no identity field: declare one field with type "id" (or set "identity" to name it)');
  }

  // relations
  if (e.relations !== undefined) {
    if (typeof e.relations !== 'object' || e.relations === null || Array.isArray(e.relations)) {
      push('"relations" must be an object of { relationName: relationDef }');
    } else {
      for (const [relName, rel] of Object.entries(e.relations as Record<string, EntityRelation>)) {
        if (!rel || typeof rel !== 'object') {
          push(`relation "${relName}": must be an object`);
          continue;
        }
        const isBelongs = 'belongsTo' in rel;
        const isHasMany = 'hasMany' in rel;
        if (!isBelongs && !isHasMany) {
          push(`relation "${relName}": must declare "belongsTo" or "hasMany"`);
          continue;
        }
        if (typeof rel.via !== 'string' || !rel.via) {
          push(`relation "${relName}": "via" (the FK column) is required`);
        }
        if (typeof rel.description !== 'string' || !rel.description.trim()) {
          push(`relation "${relName}": "description" is required`);
        }
        if (isBelongs && rel.via && !fields[rel.via]) {
          push(`relation "${relName}" (belongsTo): "via" names "${rel.via}", which is not a field on this entity — belongsTo's via is the FK column HERE`);
        }
        const target = isBelongs ? (rel as { belongsTo: string }).belongsTo : (rel as { hasMany: string }).hasMany;
        if (opts.knownEntities && !opts.knownEntities.has(target)) {
          push(`relation "${relName}": target entity "${target}" is not known yet (declare it, or ignore this if it's still being authored)`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Map an {@link EntityFieldType} to its storage {@link ColumnType}. */
function storageType(type: EntityFieldType): ColumnType {
  switch (type) {
    case 'id':
    case 'string':
    case 'text':
    case 'enum':
    case 'ref':
      return 'string';
    case 'number':
    case 'decimal':
    case 'money':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'json':
      return 'json';
  }
}

/**
 * Compile one {@link EntityField} to its {@link ColumnSchema}. Assumes {@link validateEntityIr} has
 * already passed — this does not re-validate, it projects.
 */
function compileField(name: string, f: EntityField, identity: string | undefined): ColumnSchema {
  const column: ColumnSchema = {
    type: storageType(f.type),
    description: f.description ?? `${f.fact} (${f.type})`,
  };
  if (name === identity) {
    column.primaryKey = true;
    column.generated = 'uuid';
  }
  if (f.required) column.required = true;
  if (f.unique) column.unique = true;
  if (f.default !== undefined) column.default = f.default;
  if (f.type === 'enum' && f.values) column.enum = f.values;
  if (f.type === 'ref' && f.to) {
    column.references = { table: f.to };
  }
  return column;
}

/** The compiled table + a `facts` map for building/updating a fact registry after a successful write. */
export interface CompiledEntity {
  tableName: string;
  schema: TableSchema;
  /** `fieldName → FactRecord`, for the caller to fold into its project-wide fact registry. */
  facts: Map<string, FactRecord>;
}

/**
 * `compile()` — project an {@link EntityIr} to the exact `TableSchema` shape `database/<name>.json`
 * already uses (nothing downstream — `store.ts`, `schema.ts`, the loader — changes). The table name is
 * the entity name verbatim (entities are already validated snake-free lowercase identifiers, which is
 * also a legal `TABLE_NAME_RE` table name).
 */
export function compileEntity(ir: EntityIr): CompiledEntity {
  const identity = ir.identity ?? Object.entries(ir.fields).find(([, f]) => f.type === 'id')?.[0];
  const columns: Record<string, ColumnSchema> = {};
  const facts = new Map<string, FactRecord>();
  for (const [name, f] of Object.entries(ir.fields)) {
    columns[name] = compileField(name, f, identity);
    facts.set(f.fact, { entity: ir.entity, field: name, type: f.type, values: f.values });
  }
  const relations: Record<string, RelationSchema> | undefined = ir.relations
    ? Object.fromEntries(Object.entries(ir.relations).map(([k, v]) => [k, v as RelationSchema]))
    : undefined;

  const schema: TableSchema = {
    title: ir.title,
    description: ir.title,
    columns,
    ...(relations ? { relations } : {}),
  };
  return { tableName: ir.entity, schema, facts };
}
