/**
 * Evaluate a condition DSL expression against outputs.
 *
 * Grammar:
 *   expr     = clause (WS* ("AND"|"OR") WS* clause)*
 *   clause   = path WS+ op WS+ literal
 *   path     = identifier ("." identifier)*
 *   op       = "==" | "!=" | ">" | "<" | ">=" | "<="
 *   literal  = string | number | "true" | "false" | "null"
 *   string   = '"' ... '"' | "'" ... "'"
 *
 * NO raw JS eval is used.
 */

type Operator = '==' | '!=' | '>' | '<' | '>=' | '<=';

interface Clause {
  path: string[];
  op: Operator;
  literal: unknown;
}

type Token = { type: 'clause'; clause: Clause } | { type: 'and' } | { type: 'or' };

function getAtPath(obj: unknown, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function parseLiteral(s: string): unknown {
  const t = s.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;

  // String literal
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }

  // Number
  const n = Number(t);
  if (!isNaN(n) && t !== '') return n;

  // Bare string fallback
  return t;
}

function isNullish(v: unknown): boolean {
  return v === null || v === undefined;
}

function compareValues(left: unknown, op: Operator, right: unknown): boolean {
  switch (op) {
    case '==':
      // Use loose-null semantics: undefined == null is true
      if (isNullish(left) && isNullish(right)) return true;
      return left === right;
    case '!=':
      if (isNullish(left) && isNullish(right)) return false;
      return left !== right;
    case '>':
      return (left as number) > (right as number);
    case '<':
      return (left as number) < (right as number);
    case '>=':
      return (left as number) >= (right as number);
    case '<=':
      return (left as number) <= (right as number);
    default:
      return false;
  }
}

const OPS: Operator[] = ['>=', '<=', '==', '!=', '>', '<'];

function parseClause(s: string): Clause {
  for (const op of OPS) {
    const idx = s.indexOf(op);
    if (idx === -1) continue;

    const pathStr = s.slice(0, idx).trim();
    const literalStr = s.slice(idx + op.length).trim();

    if (!pathStr || !literalStr) continue;

    const path = pathStr.split('.');
    return { path, op, literal: parseLiteral(literalStr) };
  }

  throw new Error(`Cannot parse condition clause: "${s}"`);
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];

  // Split on AND/OR with word boundaries
  const parts = expr.split(/\b(AND|OR)\b/i);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.trim();

    if (part.toUpperCase() === 'AND') {
      tokens.push({ type: 'and' });
    } else if (part.toUpperCase() === 'OR') {
      tokens.push({ type: 'or' });
    } else if (part) {
      tokens.push({ type: 'clause', clause: parseClause(part) });
    }
  }

  return tokens;
}

export function evaluateCondition(expr: string, outputs: Record<string, unknown>): boolean {
  const tokens = tokenize(expr);

  if (tokens.length === 0) return true;

  // Evaluate left to right with AND/OR (no precedence — simple sequential)
  let result: boolean | null = null;
  let pendingOp: 'and' | 'or' | null = null;

  for (const token of tokens) {
    if (token.type === 'and' || token.type === 'or') {
      pendingOp = token.type;
      continue;
    }

    const { clause } = token;
    const left = getAtPath(outputs, clause.path);
    const clauseResult = compareValues(left, clause.op, clause.literal);

    if (result === null) {
      result = clauseResult;
    } else if (pendingOp === 'and') {
      result = result && clauseResult;
    } else if (pendingOp === 'or') {
      result = result || clauseResult;
    }

    pendingOp = null;
  }

  return result ?? true;
}
