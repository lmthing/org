/**
 * The **declarative query IR** — `api/<name>.query.json` (W7 / APPFORMAT §7).
 *
 * Most endpoints are projections, not programs: a list with a filter, a record by id, a dashboard
 * aggregate, a create/update form, a toggle. This module models those as DATA ({@link QueryIr}),
 * validates one against the project's real tables ({@link validateQueryIr}), and lowers it to the
 * exact self-contained `api/<route>/<METHOD>.ts` handler the loader/runtime/contract machinery already
 * consumes ({@link generateQueryHandler}).
 *
 * The point (§7): the handler is GENERATED from the same IR that defines its Output contract, so the
 * two cannot disagree — the whole "handler returns a field its own Output never declared", "invented
 * import", "`ctx.params` instead of `input.id`" class of build-burning repair rounds stops *existing*,
 * because there is no hand-written handler to get wrong. A genuinely bespoke endpoint keeps its
 * `api/<route>/<METHOD>.ts` escape hatch (tier 3) unchanged.
 *
 * The generated handler is deliberately **self-contained**: it declares its own `Input`/`Output` and a
 * local `_Ctx` for `ctx`, and depends on NO ambient (`ApiCtx`, `<Pascal>Output`, `types/contract.d.ts`)
 * — so it typechecks whether or not the plan-based `emit_types` ran. `where`/`order`/`limit` are applied
 * in JS over the fetched rows (not pushed to SQL) so the full operator set is available and provably
 * correct; pushing them into the db query is a later optimization, not a correctness requirement.
 */

import type { ColumnType, TableSchema } from '@lmthing/core';
import {
  compileFormula,
  relationRefsInFormula,
  validateFormula,
  type Formula,
  type FormulaScope,
} from './formula.js';

/** HTTP methods an endpoint route encodes (the loader's method set). */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** The declarative query kinds (tier 1, §7). */
export type QueryKind = 'list' | 'get' | 'aggregate' | 'create' | 'update' | 'toggle' | 'delete';

/** A comparison operator in a `where` clause. `is-null`/`not-null` take no value. */
export type WhereOp =
  | '='
  | '!='
  | 'in'
  | 'not-in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'is-null'
  | 'not-null';

/** A JSON scalar a `where`/`set` may carry as a literal. */
export type JsonScalar = string | number | boolean | null;

/** One `where` clause: a column, an operator, and the comparison value — read from `input.<input>`
 *  (optional, with an optional `default`) or a literal `value` (always applied). */
export interface WhereClause {
  field: string;
  op: WhereOp;
  /** Read the comparison value from `input[<input>]`. */
  input?: string;
  /** A literal comparison value (used when `input` is absent). */
  value?: JsonScalar | JsonScalar[];
  /** Default when `input` is present but the caller omitted it. */
  default?: JsonScalar | JsonScalar[];
}

/** One `order` clause. */
export interface OrderClause {
  field: string;
  dir?: 'asc' | 'desc';
}

/** A `limit`: a fixed number, or read from an input with a default and a hard cap. */
export type LimitSpec = number | { input?: string; default: number; max?: number };

/** A source for one `set` column on a create/update: an input field or a literal value. */
export type SetSource = { input: string; optional?: boolean } | { value: JsonScalar };

/** A source for one companion `set` column on a **toggle** (§7): the value depends on which way the
 *  flip goes, so a plain `{ value }`/`{ input }` (which cannot express "different value each direction")
 *  is not enough. `'now'` is the current ISO timestamp — the one dynamic value a toggle-companion field
 *  legitimately needs (a `collected_date` stamped when a job is picked up, cleared when it is not). */
export type ToggleSetSource = { whenTrue: JsonScalar | 'now'; whenFalse: JsonScalar | 'now' };

/** The declarative query IR — one `api/<name>.query.json`. */
export interface QueryIr {
  /** The endpoint's stable id — `export const name`, and how a view binds it (`useApi('<name>')`). */
  name: string;
  kind: QueryKind;
  /** The table this endpoint reads/writes (the `database/<entity>.json` basename). */
  entity: string;
  /** The URL path, WITHOUT the method (`jobs/list`, `jobs/[id]`). */
  route: string;
  /** HTTP method — defaults from `kind` (read→GET, create→POST, update/toggle→PATCH). */
  method?: HttpMethod;
  description?: string;
  where?: WhereClause[];
  order?: OrderClause[];
  limit?: LimitSpec;
  /** Relation names to expand on each row (belongsTo → object, hasMany → array). */
  include?: string[];
  /** Computed fields: row-level for list/get, the whole summary object for aggregate. */
  compute?: Record<string, Formula>;
  /** create/update: the columns to write, sourced from input or literals. Generated columns
   *  (uuid/now) are filled by the store on insert and are omitted here. toggle: OPTIONAL companion
   *  columns to write in the SAME update as the flip (`ToggleSetSource` only — see toggleField). */
  set?: Record<string, SetSource | ToggleSetSource>;
  /** toggle: the boolean column to flip. */
  toggleField?: string;
}

/** The compiled handler ready to hand to `writeProjectApi`. */
export interface GeneratedHandler {
  /** `export const name`. */
  name: string;
  method: HttpMethod;
  /** URL path (no method), `[param]` form. */
  route: string;
  /** The `writeProjectApi` route string — `<route>/<METHOD>`. */
  apiRoute: string;
  /** The full ESM handler source. */
  source: string;
}

const KINDS = new Set<QueryKind>(['list', 'get', 'aggregate', 'create', 'update', 'toggle', 'delete']);
const METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const WHERE_OPS = new Set<WhereOp>([
  '=', '!=', 'in', 'not-in', 'gt', 'gte', 'lt', 'lte', 'contains', 'is-null', 'not-null',
]);
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const ROUTE_SEG_RE = /^\[?[a-z][a-z0-9_-]*\]?$/;

/** The default HTTP method for a kind. */
export function defaultMethod(kind: QueryKind): HttpMethod {
  switch (kind) {
    case 'create':
      return 'POST';
    case 'update':
    case 'toggle':
      return 'PATCH';
    case 'delete':
      return 'DELETE';
    default:
      return 'GET';
  }
}

/** Is this a read kind (produces rows) rather than a mutation? */
function isRead(kind: QueryKind): boolean {
  return kind === 'list' || kind === 'get' || kind === 'aggregate';
}

/** Path-param names in a route (`jobs/[id]` → `['id']`). */
export function routeParams(route: string): string[] {
  return [...route.matchAll(/\[([a-z][a-z0-9_]*)\]/g)].map((m) => m[1]);
}

/** The primary-key column of a table (falls back to `id` when the schema is absent/undeclared). */
function primaryKeyOf(table: TableSchema | undefined): string {
  if (table) {
    const pk = Object.keys(table.columns).find((c) => table.columns[c].primaryKey);
    if (pk) return pk;
  }
  return 'id';
}

/** Map a column {@link ColumnType} to its TS type text (mirrors `build/schema.ts` COLUMN_TS). */
function tsForColumn(type: ColumnType | undefined): string {
  switch (type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'json':
      return 'unknown';
    case 'string':
    case 'date':
      return 'string';
    default:
      return 'string';
  }
}

/** Resolve a column's type from a table schema (or `undefined` if unknown). */
function columnType(table: TableSchema | undefined, field: string): ColumnType | undefined {
  return table?.columns?.[field]?.type;
}

/** The TS type of a computed field. Every arithmetic/aggregation op lowers to a `number` expression
 *  (operands are wrapped in `Number(x) || 0`); only `coalesce`/`first` may yield a non-number, so those
 *  are typed `unknown` to keep the generated return assignable under strict null checks. */
function computeFieldTsType(formula: Formula): 'number' | 'unknown' {
  if (formula !== null && typeof formula === 'object' && !Array.isArray(formula)) {
    const op = Object.keys(formula)[0];
    if (op === 'coalesce' || op === 'first') return 'unknown';
  }
  return 'number';
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidateResult {
  ok: boolean;
  /** Human-readable, retryable messages (empty when `ok`). */
  errors: string[];
}

/**
 * Validate a query IR against the project's real tables. Every message is written to be actionable in
 * the authoring turn (names the offending field + the columns that DO exist), mirroring `writeProjectApi`'s
 * write-time lint. `tables` maps table name → schema; pass every `database/*.json` the project has.
 */
export function validateQueryIr(ir: unknown, tables: Map<string, TableSchema>): ValidateResult {
  const errors: string[] = [];
  const push = (m: string) => errors.push(m);

  if (!ir || typeof ir !== 'object' || Array.isArray(ir)) {
    return { ok: false, errors: ['a query IR must be an object'] };
  }
  const q = ir as Record<string, unknown>;

  if (typeof q.name !== 'string' || !NAME_RE.test(q.name)) {
    push(`"name" must be a kebab-case id (/${NAME_RE.source}/) — got ${JSON.stringify(q.name)}`);
  }
  if (typeof q.kind !== 'string' || !KINDS.has(q.kind as QueryKind)) {
    push(`"kind" must be one of ${[...KINDS].join(', ')} — got ${JSON.stringify(q.kind)}`);
  }
  const kind = q.kind as QueryKind;

  if (typeof q.entity !== 'string') {
    push('"entity" (the table name) is required');
  } else if (tables.size && !tables.has(q.entity)) {
    push(`"entity": no table "${q.entity}". The tables that exist are: ${[...tables.keys()].join(', ') || '(none yet)'}.`);
  }
  const table = typeof q.entity === 'string' ? tables.get(q.entity) : undefined;

  if (typeof q.route !== 'string' || !q.route.split('/').every((s) => ROUTE_SEG_RE.test(s))) {
    push(`"route" must be a lowercase slash path, segments optionally a [param] (e.g. "jobs/list", "jobs/[id]") — got ${JSON.stringify(q.route)}`);
  }
  if (q.method !== undefined && !METHODS.has(q.method as HttpMethod)) {
    push(`"method" must be one of ${[...METHODS].join(', ')}`);
  }

  const cols = table ? new Set(Object.keys(table.columns)) : null;
  const knownCol = (f: string): boolean => !cols || cols.has(f);
  const colList = () => (table ? Object.keys(table.columns).join(', ') : '');

  // where
  if (q.where !== undefined) {
    if (!Array.isArray(q.where)) push('"where" must be an array of clauses');
    else
      q.where.forEach((c, i) => {
        const w = c as WhereClause;
        if (!w || typeof w.field !== 'string') return push(`where[${i}]: "field" is required`);
        if (!WHERE_OPS.has(w.op)) push(`where[${i}]: "op" must be one of ${[...WHERE_OPS].join(', ')} — got ${JSON.stringify(w.op)}`);
        if (!knownCol(w.field)) push(`where[${i}]: no column "${w.field}" on "${q.entity}". Columns: ${colList()}.`);
        const needsValue = w.op !== 'is-null' && w.op !== 'not-null';
        if (needsValue && w.input === undefined && w.value === undefined) {
          push(`where[${i}] (${w.field} ${w.op}): needs either "input" (read from the request) or "value" (a literal)`);
        }
      });
  }

  // order
  if (q.order !== undefined) {
    if (!Array.isArray(q.order)) push('"order" must be an array of { field, dir? }');
    else
      q.order.forEach((c, i) => {
        const o = c as OrderClause;
        if (!o || typeof o.field !== 'string') return push(`order[${i}]: "field" is required`);
        if (!knownCol(o.field)) push(`order[${i}]: no column "${o.field}" on "${q.entity}". Columns: ${colList()}.`);
        if (o.dir !== undefined && o.dir !== 'asc' && o.dir !== 'desc') push(`order[${i}]: "dir" must be "asc" or "desc"`);
      });
  }

  // limit
  if (q.limit !== undefined) {
    const l = q.limit as LimitSpec;
    if (typeof l !== 'number' && (typeof l !== 'object' || l === null || typeof (l as { default?: unknown }).default !== 'number')) {
      push('"limit" must be a number, or { input?, default: number, max? }');
    }
  }

  // include
  if (q.include !== undefined) {
    if (!Array.isArray(q.include)) push('"include" must be an array of relation names');
    else if (table)
      q.include.forEach((rel) => {
        if (typeof rel !== 'string' || !table.relations?.[rel]) {
          push(`include: no relation "${String(rel)}" on "${q.entity}". Relations: ${Object.keys(table.relations ?? {}).join(', ') || '(none)'}.`);
        }
      });
  }

  // compute
  if (q.compute !== undefined) {
    if (typeof q.compute !== 'object' || q.compute === null || Array.isArray(q.compute)) {
      push('"compute" must be an object of { fieldName: formula }');
    } else {
      const scope = formulaScope(kind, new Set(Object.keys(q.compute)));
      // validate each formula with only the keys DECLARED BEFORE it visible (forward refs are an error)
      const priorKeys = new Set<string>();
      for (const [key, formula] of Object.entries(q.compute)) {
        const err = validateFormula(formula as Formula, { ...scope, priorKeys: new Set(priorKeys) });
        if (err) push(`compute.${key}: ${err}`);
        priorKeys.add(key);
      }
    }
  }

  // kind-specific
  if (kind === 'aggregate' && (q.compute === undefined || Object.keys(q.compute as object).length === 0)) {
    push('an "aggregate" needs a "compute" block (the summary fields)');
  }
  if ((kind === 'create' || kind === 'update') && (!q.set || typeof q.set !== 'object')) {
    push(`a "${kind}" needs a "set" map (column → { input } | { value })`);
  }
  if (q.set !== undefined && typeof q.set === 'object' && q.set !== null) {
    for (const [col, src] of Object.entries(q.set as Record<string, SetSource | ToggleSetSource>)) {
      if (!knownCol(col)) push(`set.${col}: no column "${col}" on "${q.entity}". Columns: ${colList()}.`);
      const isPlain = src && typeof src === 'object' && ('input' in src || 'value' in src);
      const isToggleConditional = src && typeof src === 'object' && 'whenTrue' in src && 'whenFalse' in src;
      if (kind === 'toggle') {
        if (!isPlain && !isToggleConditional) {
          push(`set.${col}: on a toggle, must be { input } | { value } (always the same) or { whenTrue, whenFalse } (depends on the flip direction)`);
        }
      } else {
        if (isToggleConditional) push(`set.${col}: { whenTrue, whenFalse } is only valid on a "toggle" — a ${kind} has no flip direction to key off of`);
        else if (!isPlain) push(`set.${col}: must be { input: "<field>" } or { value: <literal> }`);
      }
    }
  }
  if (kind === 'update' && routeParams(String(q.route)).length === 0 && !(q.where && (q.where as unknown[]).length)) {
    push('an "update" needs a [param] in its route (or a "where") to identify the row to change');
  }
  if (kind === 'delete' && routeParams(String(q.route)).length === 0 && !(q.where && (q.where as unknown[]).length)) {
    push('a "delete" needs a [param] in its route (or a "where") to identify the row to remove');
  }
  if (kind === 'toggle') {
    if (typeof q.toggleField !== 'string') push('a "toggle" needs "toggleField" (the boolean column to flip)');
    else if (table && columnType(table, q.toggleField) !== 'boolean') {
      push(`toggle: "${q.toggleField}" must be a boolean column on "${q.entity}" (its type is ${columnType(table, q.toggleField) ?? 'unknown'})`);
    }
    if (routeParams(String(q.route)).length === 0) push('a "toggle" needs a [param] in its route to identify the row');
  }

  return { ok: errors.length === 0, errors };
}

/** The formula scope for a kind. */
function formulaScope(kind: QueryKind, computeKeys: ReadonlySet<string>): FormulaScope {
  return {
    kind: kind === 'aggregate' ? 'agg' : 'row',
    rowVar: 'r',
    rowsVar: 'rows',
    priorKeys: computeKeys,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────────────────────

/** The banner every generated handler carries — the marker `check()` and humans read. */
export const GENERATED_BANNER = (name: string): string =>
  `// @generated from api/${name}.query.json — DO NOT EDIT. Change the .query.json and regenerate (writeProjectQuery / \`generate\`).`;

/** JS expression comparing `r[field] <op> value` (value is a JS expression already). */
function whereExpr(field: string, op: WhereOp, valueExpr: string): string {
  const f = `r[${JSON.stringify(field)}]`;
  switch (op) {
    case '=':
      return `${f} === ${valueExpr}`;
    case '!=':
      return `${f} !== ${valueExpr}`;
    case 'in':
      return `(Array.isArray(${valueExpr}) ? ${valueExpr} : [${valueExpr}]).includes(${f})`;
    case 'not-in':
      return `!(Array.isArray(${valueExpr}) ? ${valueExpr} : [${valueExpr}]).includes(${f})`;
    case 'gt':
      return `${f} > ${valueExpr}`;
    case 'gte':
      return `${f} >= ${valueExpr}`;
    case 'lt':
      return `${f} < ${valueExpr}`;
    case 'lte':
      return `${f} <= ${valueExpr}`;
    case 'contains':
      return `String(${f} ?? '').toLowerCase().includes(String(${valueExpr}).toLowerCase())`;
    case 'is-null':
      return `(${f} === null || ${f} === undefined)`;
    case 'not-null':
      return `(${f} !== null && ${f} !== undefined)`;
  }
}

/** Read a where clause's comparison value into a JS expression (input-or-literal, with default). */
function whereValueExpr(c: WhereClause): { decl: string | null; valueExpr: string; guarded: boolean } {
  if (c.op === 'is-null' || c.op === 'not-null') return { decl: null, valueExpr: '', guarded: false };
  if (c.input !== undefined) {
    const dflt = c.default !== undefined ? ` ?? ${JSON.stringify(c.default)}` : '';
    const v = `input[${JSON.stringify(c.input)}]${dflt}`;
    return { decl: null, valueExpr: v, guarded: c.default === undefined };
  }
  return { decl: null, valueExpr: JSON.stringify(c.value), guarded: false };
}

/** The filter/order/limit block shared by list/get/aggregate reads. Emits lines mutating `rows`. */
function readPipeline(ir: QueryIr): string[] {
  const lines: string[] = [];
  for (const c of ir.where ?? []) {
    const { valueExpr, guarded } = whereValueExpr(c);
    if (guarded) {
      // an optional input with no default: only filter when the caller actually sent it.
      lines.push(
        `{ const _v = ${valueExpr}; if (_v !== undefined && _v !== null && _v !== '') rows = rows.filter((r) => ${whereExpr(c.field, c.op, '_v')}); }`,
      );
    } else {
      lines.push(`rows = rows.filter((r) => ${whereExpr(c.field, c.op, valueExpr)});`);
    }
  }
  if (ir.order && ir.order.length) {
    const cmps = ir.order
      .map((o) => {
        const dir = o.dir === 'desc' ? -1 : 1;
        return `((d) => d ? ${dir} * d : 0)(_cmp(a[${JSON.stringify(o.field)}], b[${JSON.stringify(o.field)}]))`;
      })
      .join(' || ');
    lines.push(`rows = rows.slice().sort((a, b) => ${cmps});`);
  }
  if (ir.limit !== undefined) {
    if (typeof ir.limit === 'number') {
      lines.push(`rows = rows.slice(0, ${ir.limit});`);
    } else {
      const cap = ir.limit.max !== undefined ? `Math.min(_lim, ${ir.limit.max})` : '_lim';
      const src = ir.limit.input !== undefined ? `Number(input[${JSON.stringify(ir.limit.input)}] ?? ${ir.limit.default}) || ${ir.limit.default}` : String(ir.limit.default);
      lines.push(`const _lim = ${src}; rows = rows.slice(0, ${cap});`);
    }
  }
  return lines;
}

/** The relations to include: explicit `include` plus any `$rel.field` referenced by row compute. */
function includesFor(ir: QueryIr): string[] {
  const set = new Set(ir.include ?? []);
  if (ir.kind !== 'aggregate' && ir.compute) {
    for (const f of Object.values(ir.compute)) relationRefsInFormula(f, set);
  }
  return [...set];
}

/** The `.map((r) => { const key = expr; ...; return { ...r, [key]: key } })` row projection. Emits
 *  each compute key as a sequential local const so a later key can reference an earlier one (`$key`). */
function rowProjection(ir: QueryIr): string {
  if (!ir.compute || !Object.keys(ir.compute).length) return 'rows';
  const scope = formulaScope(ir.kind, new Set());
  const seq: string[] = [];
  const outParts: string[] = ['...r'];
  const prior = new Set<string>();
  for (const [key, formula] of Object.entries(ir.compute)) {
    const expr = compileFormula(formula, { ...scope, priorKeys: new Set(prior) });
    seq.push(`const ${key} = ${expr};`);
    outParts.push(`[${JSON.stringify(key)}]: ${key}`);
    prior.add(key);
  }
  return `rows.map((r) => { ${seq.join(' ')} return { ${outParts.join(', ')} }; })`;
}

/** The aggregate summary object literal `{ key: expr, ... }` (over `rows`). */
function aggregateProjection(ir: QueryIr): string {
  const scope = formulaScope('aggregate', new Set());
  const seq: string[] = [];
  const outParts: string[] = [];
  const prior = new Set<string>();
  for (const [key, formula] of Object.entries(ir.compute ?? {})) {
    const expr = compileFormula(formula, { ...scope, priorKeys: new Set(prior) });
    seq.push(`const ${key} = ${expr};`);
    outParts.push(`[${JSON.stringify(key)}]: ${key}`);
    prior.add(key);
  }
  return `(() => { ${seq.join(' ')} return { ${outParts.join(', ')} }; })()`;
}

/** Collect the input properties (name → TS type) the handler reads. */
function inputProps(ir: QueryIr, table: TableSchema | undefined): Array<{ key: string; type: string; optional: boolean }> {
  const out = new Map<string, { type: string; optional: boolean }>();
  // path params — always required strings
  for (const p of routeParams(ir.route)) out.set(p, { type: 'string', optional: false });
  // where inputs
  for (const c of ir.where ?? []) {
    if (c.input === undefined || out.has(c.input)) continue;
    const base = tsForColumn(columnType(table, c.field));
    const arr = c.op === 'in' || c.op === 'not-in';
    out.set(c.input, { type: arr ? `${base}[]` : base, optional: true });
  }
  // limit input
  if (ir.limit !== undefined && typeof ir.limit !== 'number' && ir.limit.input) {
    if (!out.has(ir.limit.input)) out.set(ir.limit.input, { type: 'number', optional: true });
  }
  // set inputs (create/update)
  for (const [col, src] of Object.entries(ir.set ?? {})) {
    if (!('input' in src)) continue;
    if (out.has(src.input)) continue;
    out.set(src.input, { type: tsForColumn(columnType(table, col)), optional: Boolean(src.optional) });
  }
  return [...out].map(([key, v]) => ({ key, ...v }));
}

/** The `_Item` interface fields for a read's Output row (columns + compute + relations). */
function itemFields(ir: QueryIr, table: TableSchema | undefined): string[] {
  const fields: string[] = [];
  if (table) {
    for (const [col, def] of Object.entries(table.columns)) fields.push(`${JSON.stringify(col)}: ${tsForColumn(def.type)};`);
  } else {
    fields.push('[k: string]: unknown;');
  }
  for (const rel of ir.include ?? []) {
    const r = table?.relations?.[rel];
    const t = r && 'hasMany' in r ? 'Array<Record<string, unknown>>' : 'Record<string, unknown> | null';
    fields.push(`${JSON.stringify(rel)}: ${t};`);
  }
  for (const [key, formula] of Object.entries(ir.compute ?? {})) {
    fields.push(`${JSON.stringify(key)}: ${computeFieldTsType(formula)};`);
  }
  return fields;
}

/** The shared self-contained preamble: `_Row`/`_Ctx`/`_cmp`, plus the optional HttpError import. */
function preamble(needHttpError: boolean): string {
  const lines: string[] = [];
  if (needHttpError) lines.push(`import { HttpError } from '@app/runtime';`);
  lines.push(
    `type _Row = Record<string, any>;`,
    `interface _Ctx { db: {`,
    `  query: (table: string, opts?: { where?: Record<string, unknown>; include?: string[]; orderBy?: unknown; limit?: number; offset?: number }) => Promise<_Row[]>;`,
    `  insert: (table: string, values: Record<string, unknown>) => Promise<_Row | _Row[]>;`,
    `  update: (table: string, opts: { where: Record<string, unknown>; set: Record<string, unknown> }) => Promise<number>;`,
    `  remove: (table: string, opts: { where: Record<string, unknown> }) => Promise<number>;`,
    `} }`,
  );
  return lines.join('\n');
}

/** The `_cmp` null-safe comparator (only emitted when a read has an `order`). */
const CMP_HELPER = `const _cmp = (x: any, y: any): number => (x === y ? 0 : x === null || x === undefined ? -1 : y === null || y === undefined ? 1 : x < y ? -1 : 1);`;

/** Build the `set` object literal from an IR `set` map (create/update). */
function setLiteral(set: Record<string, SetSource>): string {
  const parts = Object.entries(set).map(([col, src]) =>
    'input' in src
      ? `${JSON.stringify(col)}: input[${JSON.stringify(src.input)}]`
      : `${JSON.stringify(col)}: ${JSON.stringify(src.value)}`,
  );
  return `{ ${parts.join(', ')} }`;
}

/** Is this `set` entry a toggle-conditional source (`{ whenTrue, whenFalse }`), as opposed to a plain
 *  create/update `SetSource` (`{ input }` / `{ value }`)? */
function isToggleConditionalSource(src: SetSource | ToggleSetSource): src is ToggleSetSource {
  return typeof src === 'object' && src !== null && 'whenTrue' in src && 'whenFalse' in src;
}

/** Narrow an IR `set` map to its plain (create/update) entries — `validateQueryIr` already rejects a
 *  `{ whenTrue, whenFalse }` entry on anything but a toggle, so this is a type-level narrowing of an
 *  invariant already enforced at runtime, not a second check. */
function plainSetEntries(set: Record<string, SetSource | ToggleSetSource> | undefined): Record<string, SetSource> {
  const out: Record<string, SetSource> = {};
  for (const [col, src] of Object.entries(set ?? {})) {
    if (!isToggleConditionalSource(src)) out[col] = src;
  }
  return out;
}

/** A toggle companion value (`'now'` or a JSON literal) as a JS expression. */
function toggleValueExpr(value: JsonScalar | 'now'): string {
  return value === 'now' ? 'new Date().toISOString()' : JSON.stringify(value);
}

/**
 * Generate the self-contained `<METHOD>.ts` handler for a query IR. Assumes {@link validateQueryIr}
 * has passed (it re-derives nothing it cannot from a valid IR). `tables` types the Input/Output.
 */
export function generateQueryHandler(ir: QueryIr, tables: Map<string, TableSchema>): GeneratedHandler {
  const table = tables.get(ir.entity);
  const method = ir.method ?? defaultMethod(ir.kind);
  const params = routeParams(ir.route);
  const idParam = params[0];
  const needHttpError = ir.kind === 'get' || ir.kind === 'update' || ir.kind === 'toggle' || ir.kind === 'delete';

  const inputs = inputProps(ir, table);
  const inputDecl = inputs.length
    ? inputs.map((p) => `  ${JSON.stringify(p.key)}${p.optional ? '?' : ''}: ${p.type};`).join('\n')
    : '  [k: string]: unknown;';

  const includes = includesFor(ir);
  const includeOpt = includes.length ? `, { include: ${JSON.stringify(includes)} }` : '';

  const head: string[] = [
    GENERATED_BANNER(ir.name),
    preamble(needHttpError),
    `export const name = ${JSON.stringify(ir.name)};`,
    `export const description = ${JSON.stringify(ir.description ?? ir.name)};`,
    `export interface Input {\n${inputDecl}\n}`,
  ];

  let body: string[];
  let outputDecl: string;

  if (ir.kind === 'list' || ir.kind === 'get') {
    outputDecl = `interface _Item {\n${itemFields(ir, table).map((f) => `  ${f}`).join('\n')}\n}\nexport interface Output { items: _Item[]; }`;
    const pipeline: string[] = [];
    if (ir.kind === 'get' && idParam && !(ir.where && ir.where.length)) {
      // a `get` with an [id] param and no explicit where → filter by primary key = input.<param>.
      const pk = primaryKeyOf(table);
      pipeline.push(`rows = rows.filter((r) => r[${JSON.stringify(pk)}] === input[${JSON.stringify(idParam)}]);`);
    }
    pipeline.push(...readPipeline(ir));
    const needCmp = Boolean(ir.order && ir.order.length);
    const projection = rowProjection(ir);
    body = [
      needCmp ? CMP_HELPER : '',
      `export default async function handler(input: Input, ctx: _Ctx): Promise<Output> {`,
      `  let rows = await ctx.db.query(${JSON.stringify(ir.entity)}${includeOpt});`,
      ...pipeline.map((l) => `  ${l}`),
      // The projection is built from `_Row` (`Record<string, any>`) values — an index-signature type
      // is NOT structurally assignable to a specific named interface (`_Item`) even though every
      // property reads as `any`, so the boundary needs one explicit cast. This is generated code with
      // no author to mislead; the real guarantee (the row really has these columns) comes from
      // `validateQueryIr` checking the IR against the table schema before this ever compiles.
      ir.kind === 'get'
        ? `  const items = (${projection}).slice(0, 1) as _Item[];`
        : `  const items = (${projection}) as _Item[];`,
      `  return { items };`,
      `}`,
    ].filter(Boolean);
  } else if (ir.kind === 'aggregate') {
    const entries = Object.entries(ir.compute ?? {});
    outputDecl = `interface _Summary {\n${entries.map(([k, f]) => `  ${JSON.stringify(k)}: ${computeFieldTsType(f)};`).join('\n')}\n}\nexport interface Output { items: _Summary[]; }`;
    const pipeline = readPipeline(ir);
    const needCmp = Boolean(ir.order && ir.order.length);
    body = [
      needCmp ? CMP_HELPER : '',
      `export default async function handler(input: Input, ctx: _Ctx): Promise<Output> {`,
      `  let rows = await ctx.db.query(${JSON.stringify(ir.entity)}${includeOpt});`,
      ...pipeline.map((l) => `  ${l}`),
      `  const summary = ${aggregateProjection(ir)};`,
      `  return { items: [summary] };`,
      `}`,
    ].filter(Boolean);
  } else if (ir.kind === 'create') {
    outputDecl = `interface _Item {\n${itemFields(ir, table).map((f) => `  ${f}`).join('\n')}\n}\nexport interface Output { items: _Item[]; }`;
    body = [
      `export default async function handler(input: Input, ctx: _Ctx): Promise<Output> {`,
      `  const created = await ctx.db.insert(${JSON.stringify(ir.entity)}, ${setLiteral(plainSetEntries(ir.set))});`,
      `  const row = (Array.isArray(created) ? created[0] : created) as _Item;`,
      `  return { items: [row] };`,
      `}`,
    ];
  } else if (ir.kind === 'update') {
    const pk = primaryKeyOf(table);
    outputDecl = `interface _Item {\n${itemFields(ir, table).map((f) => `  ${f}`).join('\n')}\n}\nexport interface Output { items: _Item[]; }`;
    body = [
      `export default async function handler(input: Input, ctx: _Ctx): Promise<Output> {`,
      `  const n = await ctx.db.update(${JSON.stringify(ir.entity)}, { where: { ${JSON.stringify(pk)}: input[${JSON.stringify(idParam)}] }, set: ${setLiteral(plainSetEntries(ir.set))} });`,
      `  if (n === 0) throw new HttpError(404, ${JSON.stringify(`no ${ir.entity} to update`)});`,
      `  const [row] = (await ctx.db.query(${JSON.stringify(ir.entity)})).filter((r) => r[${JSON.stringify(pk)}] === input[${JSON.stringify(idParam)}]);`,
      `  return { items: [row as _Item] };`,
      `}`,
    ];
  } else if (ir.kind === 'delete') {
    const pk = primaryKeyOf(table);
    outputDecl = `interface _Item {\n${itemFields(ir, table).map((f) => `  ${f}`).join('\n')}\n}\nexport interface Output { items: _Item[]; }`;
    body = [
      `export default async function handler(input: Input, ctx: _Ctx): Promise<Output> {`,
      `  const [row] = (await ctx.db.query(${JSON.stringify(ir.entity)})).filter((r) => r[${JSON.stringify(pk)}] === input[${JSON.stringify(idParam)}]);`,
      `  if (!row) throw new HttpError(404, ${JSON.stringify(`no such ${ir.entity}`)});`,
      `  await ctx.db.remove(${JSON.stringify(ir.entity)}, { where: { ${JSON.stringify(pk)}: input[${JSON.stringify(idParam)}] } });`,
      `  return { items: [row as _Item] };`,
      `}`,
    ];
  } else {
    // toggle
    const pk = primaryKeyOf(table);
    const field = ir.toggleField as string;
    const companions = Object.entries(ir.set ?? {}).filter(
      (e): e is [string, ToggleSetSource] => isToggleConditionalSource(e[1]),
    );
    const companionFields = companions
      .map(([col, src]) => {
        const nullable = src.whenTrue === null || src.whenFalse === null;
        return `${JSON.stringify(col)}: ${tsForColumn(columnType(table, col))}${nullable ? ' | null' : ''};`;
      })
      .join('\n  ');
    outputDecl = `export interface Output { items: Array<{ ${JSON.stringify(pk)}: string; ${JSON.stringify(field)}: boolean;${companionFields ? `\n  ${companionFields}` : ''} }>; }`;
    const companionConsts = companions.map(
      ([col, src]) => `  const ${col} = next ? ${toggleValueExpr(src.whenTrue)} : ${toggleValueExpr(src.whenFalse)};`,
    );
    const companionSetParts = companions.map(([col]) => `${JSON.stringify(col)}: ${col}`);
    const companionItemParts = companions.map(([col]) => `${JSON.stringify(col)}: ${col}`);
    body = [
      `export default async function handler(input: Input, ctx: _Ctx): Promise<Output> {`,
      `  const [row] = (await ctx.db.query(${JSON.stringify(ir.entity)})).filter((r) => r[${JSON.stringify(pk)}] === input[${JSON.stringify(idParam)}]);`,
      `  if (!row) throw new HttpError(404, ${JSON.stringify(`no such ${ir.entity}`)});`,
      `  const next = !row[${JSON.stringify(field)}];`,
      ...companionConsts,
      `  await ctx.db.update(${JSON.stringify(ir.entity)}, { where: { ${JSON.stringify(pk)}: input[${JSON.stringify(idParam)}] }, set: { ${JSON.stringify(field)}: next${companionSetParts.length ? ', ' + companionSetParts.join(', ') : ''} } });`,
      `  return { items: [{ ${JSON.stringify(pk)}: input[${JSON.stringify(idParam)}], ${JSON.stringify(field)}: next${companionItemParts.length ? ', ' + companionItemParts.join(', ') : ''} }] };`,
      `}`,
    ];
  }

  const source = [...head, outputDecl, ...body].join('\n') + '\n';
  const apiRoute = `${ir.route}/${method}`;
  return { name: ir.name, method, route: ir.route, apiRoute, source };
}
