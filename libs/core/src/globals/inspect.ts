import { serialize } from './serialize.js';
import type { YieldRequest } from '../eval/yield.js';

export interface InspectQuery {
  path?: string;
  slice?: [number, number];
  depth?: number;
  filter?: string;
  sample?: number;
  keys?: boolean;
  count?: boolean;
  search?: string;
}

/**
 * Create the `inspect` global function that pushes a yield request and
 * returns a Promise. The turn loop resolves it and emits VARIABLES.
 */
export function createInspectGlobal(
  pushYield: (req: YieldRequest) => void,
): (...args: unknown[]) => Promise<void> {
  return function inspect(...args: unknown[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Process args: each arg is either a plain value or [value, query]
      const processed = args.map((arg) => {
        if (Array.isArray(arg) && arg.length === 2 && isInspectQuery(arg[1])) {
          const [value, query] = arg as [unknown, InspectQuery];
          return { value: applyQuery(value, query), query };
        }
        return { value: arg, query: undefined };
      });

      pushYield({
        kind: 'inspect',
        args: processed,
        deferred: {
          resolve: () => resolve(),
          reject,
        },
        vmPromiseHandle: undefined,
      });
    });
  };
}

function isInspectQuery(val: unknown): val is InspectQuery {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/**
 * Apply an InspectQuery to a value, transforming it according to the query.
 */
export function applyQuery(value: unknown, query: InspectQuery): unknown {
  let result = value;

  // path: dotted path access
  if (query.path) {
    result = getPath(result, query.path);
  }

  // keys: return object keys
  if (query.keys && typeof result === 'object' && result !== null) {
    return Object.keys(result as object);
  }

  // count: return length
  if (query.count) {
    if (Array.isArray(result)) return result.length;
    if (typeof result === 'string') return result.length;
    if (typeof result === 'object' && result !== null) return Object.keys(result as object).length;
    return 0;
  }

  // search: filter array by string match
  if (query.search !== undefined && Array.isArray(result)) {
    const term = query.search.toLowerCase();
    result = (result as unknown[]).filter((item) =>
      JSON.stringify(item).toLowerCase().includes(term),
    );
  }

  // filter: predicate expression over array items
  if (query.filter && Array.isArray(result)) {
    result = applyFilter(result as unknown[], query.filter);
  }

  // slice: [start, end) — of an array's items, or (just as often, since this is the
  // documented escape hatch from serialize()'s own "chars total" truncation message) a
  // window of a STRING's characters. A big delegate result, a document body, or an API
  // response is exactly as likely to be a giant string as a giant array.
  if (query.slice) {
    if (Array.isArray(result)) {
      result = (result as unknown[]).slice(query.slice[0], query.slice[1]);
    } else if (typeof result === 'string') {
      result = (result as string).slice(query.slice[0], query.slice[1]);
    }
  }

  // sample: random sample of n items
  if (query.sample !== undefined && Array.isArray(result)) {
    const arr = result as unknown[];
    if (query.sample >= arr.length) return arr;
    const sampled: unknown[] = [];
    const indices = new Set<number>();
    while (indices.size < query.sample) {
      indices.add(Math.floor(Math.random() * arr.length));
    }
    for (const i of indices) sampled.push(arr[i]);
    result = sampled;
  }

  return result;
}

function getPath(value: unknown, path: string): unknown {
  const parts = path.split('.');
  let current = value;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = parseInt(part, 10);
      current = (current as unknown[])[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Very restricted predicate evaluator over array items.
 * Supports: `<dotted.path> <op> <literal>` joined by AND/OR.
 * Ops: == != > < >= <=
 */
function applyFilter(arr: unknown[], filterExpr: string): unknown[] {
  return arr.filter((item) => evalPredicate(item, filterExpr));
}

function evalPredicate(item: unknown, expr: string): boolean {
  // Split by OR first (lower precedence)
  const orParts = expr.split(/\bOR\b/);
  return orParts.some((orPart) => evalAndPredicate(item, orPart.trim()));
}

function evalAndPredicate(item: unknown, expr: string): boolean {
  const andParts = expr.split(/\bAND\b/);
  return andParts.every((part) => evalComparison(item, part.trim()));
}

function evalComparison(item: unknown, expr: string): boolean {
  const match = expr.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) return false;

  const [, pathStr, op, literalStr] = match as [string, string, string, string, string];
  const lhs = getPath(item, pathStr.trim());
  const rhs = parseLiteral(literalStr.trim());

  switch (op) {
    case '==': return lhs == rhs; // eslint-disable-line eqeqeq
    case '!=': return lhs != rhs; // eslint-disable-line eqeqeq
    case '>': return (lhs as number) > (rhs as number);
    case '<': return (lhs as number) < (rhs as number);
    case '>=': return (lhs as number) >= (rhs as number);
    case '<=': return (lhs as number) <= (rhs as number);
    default: return false;
  }
}

function parseLiteral(s: string): unknown {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  // String literal
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * `inspect()`'s whole purpose is to let the model see more of a value than the standard
 * 200-char VARIABLES preview shows — so its OWN output must not re-apply that same cap.
 * Bounded (not unlimited) purely as a pathological-outlier guard, matching the precedent
 * set by `formatLoadKnowledgeContents`/`formatReadDocuments` in `eval/turn-loop.ts`.
 */
const INSPECT_STR_CAP = 20_000;
const INSPECT_BYTE_CAP = 24_000;

/**
 * Format inspect results as a VARIABLES block string.
 */
export function formatInspectResult(args: Array<{ value: unknown; query?: InspectQuery }>): string {
  const lines: string[] = ['VARIABLES'];
  for (let i = 0; i < args.length; i++) {
    const { value, query } = args[i]!;
    const key = query?.path ? `inspected[${i}].${query.path}` : `inspected[${i}]`;
    lines.push(`${key}: ${serialize(value, { strCap: INSPECT_STR_CAP, byteCap: INSPECT_BYTE_CAP })}`);
  }
  return lines.join('\n');
}
