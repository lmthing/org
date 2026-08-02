/**
 * The **compute formula AST** for the declarative query IR (`api/<name>.query.json`, W7 / §7).
 *
 * A `compute` block is a closed, side-effect-free formula language — NOT TypeScript — that the IR
 * compiler ({@link compileFormula}) lowers to a plain JS expression string baked into the generated
 * handler. Because the formula is closed (a fixed operator set over field refs and numeric constants),
 * a generated handler cannot invent a field, call an API, or disagree with the contract the same IR
 * produces: the whole point of §7 ("a generated handler cannot disagree with its own contract").
 *
 * Two evaluation scopes, chosen by the query `kind`:
 *   - **row** (`list`/`get`): each formula is evaluated once per fetched row. A bare `$field` ref reads
 *     that row's column (or an earlier compute key in the same block); a `$rel.field` ref inside an
 *     aggregation op reduces over an included relation array on the row.
 *   - **agg** (`aggregate`): the block produces ONE summary object over the whole result set. There is
 *     no "current row", so a bare `$field` is only meaningful as a prior compute key; column data is
 *     reached through an aggregation op (`{ sum: "$field" }`, `{ count: "" }`, …) that reduces over all
 *     rows.
 *
 * Operators: `add sub mul div neg min max round coalesce` (arithmetic) and `sum count avg first`
 * (aggregation). Operands are a number literal, a `$ref` string, or a nested op object. `{ ref: "…" }`
 * (the §7 app-settings escape) is deliberately NOT supported in this tier — there is no settings store
 * yet, and a rate that varies per app is data that belongs in a table, so a `settings.*` ref is a
 * validation error with that guidance rather than a silent zero.
 */

/** A single compute formula — a number, a `$ref` string, or a one-key operator object. */
export type Formula =
  | number
  | string // a "$ref" (field / prior compute key / relation path inside an aggregation op)
  | { add: Formula[] }
  | { sub: [Formula, Formula] }
  | { mul: Formula[] }
  | { div: [Formula, Formula] }
  | { neg: Formula }
  | { min: Formula[] }
  | { max: Formula[] }
  | { round: Formula | [Formula, number] }
  | { coalesce: Formula[] }
  | { sum: string }
  | { count: string }
  | { avg: string }
  | { first: string };

/** Compilation scope — see the module doc. */
export interface FormulaScope {
  /** `'row'` for list/get (per-row), `'agg'` for aggregate (over the whole set). */
  kind: 'row' | 'agg';
  /** The JS identifier holding the current row (row scope) — e.g. `r`. */
  rowVar: string;
  /** The JS identifier holding the full row array (agg scope) — e.g. `rows`. */
  rowsVar: string;
  /** Compute keys already emitted as local consts before this one — a `$ref` to one resolves to the
   *  const rather than a column read. */
  priorKeys: ReadonlySet<string>;
}

/** The two operand-list arithmetic ops (variadic). */
const VARIADIC = new Set(['add', 'mul', 'min', 'max']);
/** The aggregation ops — their operand is a single `$ref` string. */
const AGG_OPS = new Set(['sum', 'count', 'avg', 'first']);

/** A JS number-coercion wrapper used everywhere a numeric operand is read, so a `null`/`undefined`/
 *  non-numeric column never poisons an arithmetic result with `NaN`. */
function num(expr: string): string {
  return `(Number(${expr}) || 0)`;
}

/** Split a `$ref` into its head (field / prior key / relation) and optional `.field` tail. */
function parseRef(ref: string): { head: string; tail: string | null } {
  const body = ref.startsWith('$') ? ref.slice(1) : ref;
  const dot = body.indexOf('.');
  return dot === -1 ? { head: body, tail: null } : { head: body.slice(0, dot), tail: body.slice(dot + 1) };
}

/** A JS string literal for a property key — quoted so a snake_case or hyphenated column is safe. */
function prop(obj: string, key: string): string {
  return `${obj}[${JSON.stringify(key)}]`;
}

/**
 * Lower a plain `$ref` (no aggregation op) to a JS expression. A ref to a prior compute key reads the
 * local const; otherwise it is a column of the current row (row scope) — a bare column ref is invalid
 * in agg scope (there is no current row) and throws {@link FormulaError}.
 */
function compileRef(ref: string, scope: FormulaScope): string {
  const { head, tail } = parseRef(ref);
  if (tail) {
    throw new FormulaError(
      `"$${head}.${tail}" is a relation path — it is only valid inside an aggregation op (sum/count/avg/first), not as a bare ref`,
    );
  }
  if (scope.priorKeys.has(head)) return head; // an earlier compute key → its local const
  if (scope.kind === 'agg') {
    throw new FormulaError(
      `"$${head}" reads a column, but an aggregate has no current row — wrap it in an aggregation op, e.g. { "sum": "$${head}" }, or reference a prior compute key`,
    );
  }
  return prop(scope.rowVar, head);
}

/**
 * Lower an aggregation op (`sum`/`count`/`avg`/`first`) to a JS reduction expression.
 *
 * - **row scope**: the ref is a relation path `$rel.field` (or `$rel` for `count`), reducing over the
 *   row's included relation array.
 * - **agg scope**: the ref is a column `$field` (or `""`/`"*"` for `count`), reducing over the full set.
 */
function compileAgg(op: string, ref: string, scope: FormulaScope): string {
  const { head, tail } = parseRef(ref);
  let arrayExpr: string;
  let field: string | null;
  if (scope.kind === 'row') {
    // row scope: reduce over an included relation array on the current row.
    if (op !== 'count' && !tail) {
      throw new FormulaError(
        `{ "${op}": "$${head}" } needs a relation FIELD (e.g. "$${head}.amount") — sum/avg/first reduce a value over the related rows`,
      );
    }
    arrayExpr = `(Array.isArray(${prop(scope.rowVar, head)}) ? ${prop(scope.rowVar, head)} : [])`;
    field = tail;
  } else {
    // agg scope: reduce over the whole result set; the ref is a column (count may be over rows).
    if (op === 'count' && (head === '' || head === '*')) {
      return `${scope.rowsVar}.length`;
    }
    if (!head) {
      throw new FormulaError(`{ "${op}": "…" } needs a column ref, e.g. { "${op}": "$amount" }`);
    }
    if (tail) {
      throw new FormulaError(
        `{ "${op}": "$${head}.${tail}" } — a relation path is only valid in a per-row (list/get) compute, not an aggregate`,
      );
    }
    arrayExpr = scope.rowsVar;
    field = head;
  }

  const item = '_x';
  const valueOf = field === null ? item : prop(item, field);
  switch (op) {
    case 'count':
      // count of the array (row-scope relation) or of the whole set (handled above for agg).
      return `${arrayExpr}.length`;
    case 'sum':
      return `${arrayExpr}.reduce((_s, ${item}) => _s + ${num(valueOf)}, 0)`;
    case 'avg':
      return `(${arrayExpr}.length ? ${arrayExpr}.reduce((_s, ${item}) => _s + ${num(valueOf)}, 0) / ${arrayExpr}.length : 0)`;
    case 'first':
      return `(${arrayExpr}.length ? ${valueOf.replace(item, `${arrayExpr}[0]`)} : null)`;
    default:
      throw new FormulaError(`unknown aggregation op "${op}"`);
  }
}

/** Thrown by {@link compileFormula}/{@link validateFormula} on a malformed formula. */
export class FormulaError extends Error {}

/**
 * Compile one {@link Formula} to a JS expression string, in the given {@link FormulaScope}. Throws
 * {@link FormulaError} on a malformed node — the writer turns that into a retryable authoring error.
 */
export function compileFormula(node: Formula, scope: FormulaScope): string {
  if (typeof node === 'number') return Number.isFinite(node) ? String(node) : '0';
  if (typeof node === 'string') {
    if (!node.startsWith('$')) {
      throw new FormulaError(`a string operand must be a "$ref" (got ${JSON.stringify(node)})`);
    }
    return compileRef(node, scope);
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    throw new FormulaError(`a formula must be a number, a "$ref", or a one-key op object (got ${JSON.stringify(node)})`);
  }
  const keys = Object.keys(node);
  if (keys.length !== 1) {
    throw new FormulaError(`a formula op object must have exactly one key (got ${JSON.stringify(keys)})`);
  }
  const op = keys[0];
  const arg = (node as Record<string, unknown>)[op];

  if (AGG_OPS.has(op)) {
    if (typeof arg !== 'string') {
      throw new FormulaError(`{ "${op}": … } takes a single "$ref" string (got ${JSON.stringify(arg)})`);
    }
    return compileAgg(op, arg, scope);
  }
  if (VARIADIC.has(op)) {
    if (!Array.isArray(arg) || arg.length === 0) {
      throw new FormulaError(`{ "${op}": [ … ] } takes a non-empty array of operands`);
    }
    const parts = arg.map((a) => num(compileFormula(a as Formula, scope)));
    if (op === 'add') return `(${parts.join(' + ')})`;
    if (op === 'mul') return `(${parts.join(' * ')})`;
    return `Math.${op}(${parts.join(', ')})`; // min / max
  }
  if (op === 'sub' || op === 'div') {
    if (!Array.isArray(arg) || arg.length !== 2) {
      throw new FormulaError(`{ "${op}": [a, b] } takes exactly two operands`);
    }
    const a = num(compileFormula(arg[0] as Formula, scope));
    const b = num(compileFormula(arg[1] as Formula, scope));
    if (op === 'sub') return `(${a} - ${b})`;
    return `(${b} === 0 ? 0 : ${a} / ${b})`; // div-by-zero guarded to 0, never Infinity/NaN
  }
  if (op === 'neg') {
    return `(-${num(compileFormula(arg as Formula, scope))})`;
  }
  if (op === 'coalesce') {
    if (!Array.isArray(arg) || arg.length === 0) {
      throw new FormulaError(`{ "coalesce": [ … ] } takes a non-empty array of operands`);
    }
    const parts = arg.map((a) => compileFormula(a as Formula, scope));
    return `[${parts.join(', ')}].find((v) => v !== null && v !== undefined) ?? null`;
  }
  if (op === 'round') {
    if (Array.isArray(arg)) {
      if (arg.length !== 2 || typeof arg[1] !== 'number') {
        throw new FormulaError(`{ "round": [value, digits] } — digits must be a number`);
      }
      const value = num(compileFormula(arg[0] as Formula, scope));
      const f = 10 ** (arg[1] as number);
      return `(Math.round(${value} * ${f}) / ${f})`;
    }
    return `Math.round(${num(compileFormula(arg as Formula, scope))})`;
  }
  if (op === 'ref') {
    throw new FormulaError(
      `{ "ref": … } (an app-settings reference) is not supported: there is no settings store. A value that varies per app is DATA — put it in a table and reference it via a relation, or inline the constant number.`,
    );
  }
  throw new FormulaError(`unknown compute op "${op}"`);
}

/**
 * Collect the relation names a compute block references via `$rel.field` aggregation paths (row scope
 * only) — the generator adds these to the query `include` so the relation array is present on each row.
 */
export function relationRefsInFormula(node: Formula, out: Set<string> = new Set()): Set<string> {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    // a bare "$rel.field" string never appears as a top-level operand (only inside an agg op), so a
    // string node here is a plain field/prior-key ref with no relation to include.
    return out;
  }
  const keys = Object.keys(node);
  if (keys.length !== 1) return out;
  const op = keys[0];
  const arg = (node as Record<string, unknown>)[op];
  if (AGG_OPS.has(op) && typeof arg === 'string') {
    const { head, tail } = parseRef(arg);
    // `count` reduces the relation ARRAY itself (`$rel`); sum/avg/first reduce a FIELD (`$rel.field`).
    // Either way the relation `head` must be included so its array is present on the row.
    if (head && (op === 'count' || tail)) out.add(head);
    return out;
  }
  if (Array.isArray(arg)) {
    for (const a of arg) relationRefsInFormula(a as Formula, out);
  } else if (arg && typeof arg === 'object') {
    relationRefsInFormula(arg as Formula, out);
  }
  return out;
}

/** Validate a formula by attempting compilation; returns an error message or `null`. */
export function validateFormula(node: Formula, scope: FormulaScope): string | null {
  try {
    compileFormula(node, scope);
    return null;
  } catch (e) {
    return e instanceof FormulaError ? e.message : String(e);
  }
}
