import ts from 'typescript';
import type { QuickJSAsyncContext, QuickJSHandle } from 'quickjs-emscripten';
import { marshalToHost, marshalToQuickJS } from '../sandbox/host-bridge.js';
import type { TraceWriter } from '../sandbox/trace.js';
import { BudgetTracker } from './budget.js';

export { BudgetTracker } from './budget.js';
export type { Budget } from './budget.js';

// ── InspectQuery (re-exported) ──

export interface InspectQuery {
  path?: string;
  slice?: [number, number?];
  depth?: number;
  filter?: string;
  sample?: number;
  keys?: boolean;
  count?: boolean;
  search?: string;
}

// ── Filter expression parser ──

export interface FilterNode {
  type: 'binary' | 'unary' | 'access' | 'index' | 'literal' | 'identifier';
  op?: string;
  left?: FilterNode;
  right?: FilterNode;
  operand?: FilterNode;
  object?: FilterNode;
  property?: string;
  indexValue?: number | string;
  value?: unknown;
  name?: string;
}

export function parseFilterExpression(filter: string): FilterNode {
  const sf = ts.createSourceFile(
    '_filter.ts',
    filter,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  if (sf.statements.length !== 1) {
    throw new Error(`Filter must be a single expression, got ${sf.statements.length} statements`);
  }
  const stmt = sf.statements[0];
  if (!ts.isExpressionStatement(stmt)) {
    throw new Error('Filter must be an expression');
  }
  return parseExprNode(stmt.expression);
}

function parseExprNode(node: ts.Expression): FilterNode {
  if (ts.isBinaryExpression(node)) {
    const opToken = node.operatorToken;
    const allowedOps = [
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.LessThanToken,
      ts.SyntaxKind.GreaterThanToken,
      ts.SyntaxKind.LessThanEqualsToken,
      ts.SyntaxKind.GreaterThanEqualsToken,
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ];
    if (!allowedOps.includes(opToken.kind)) {
      throw new Error(`Disallowed operator in filter: ${node.getText()}`);
    }
    return {
      type: 'binary',
      op: opToken.getText(),
      left: parseExprNode(node.left as ts.Expression),
      right: parseExprNode(node.right as ts.Expression),
    };
  }

  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator !== ts.SyntaxKind.ExclamationToken) {
      throw new Error('Only ! unary operator is allowed in filters');
    }
    return {
      type: 'unary',
      op: '!',
      operand: parseExprNode(node.operand as ts.Expression),
    };
  }

  if (ts.isPropertyAccessExpression(node)) {
    return {
      type: 'access',
      object: parseExprNode(node.expression as ts.Expression),
      property: node.name.text,
    };
  }

  if (ts.isElementAccessExpression(node)) {
    const arg = node.argumentExpression;
    if (!ts.isNumericLiteral(arg) && !ts.isStringLiteral(arg)) {
      throw new Error('Computed access in filter only allows literal indices');
    }
    const indexValue = ts.isNumericLiteral(arg) ? Number(arg.text) : arg.text;
    return {
      type: 'index',
      object: parseExprNode(node.expression as ts.Expression),
      indexValue,
    };
  }

  if (ts.isIdentifier(node)) {
    return { type: 'identifier', name: node.text };
  }

  if (ts.isNumericLiteral(node)) {
    return { type: 'literal', value: Number(node.text) };
  }

  if (ts.isStringLiteral(node)) {
    return { type: 'literal', value: node.text };
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return { type: 'literal', value: true };
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return { type: 'literal', value: false };
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return { type: 'literal', value: null };
  }

  if (ts.isCallExpression(node)) {
    throw new Error('Function calls are not allowed in filter expressions');
  }

  throw new Error(`Unsupported expression in filter: ${ts.SyntaxKind[node.kind]}`);
}

export function evalFilter(node: FilterNode, el: unknown): boolean {
  return Boolean(evalNode(node, el));
}

function evalNode(node: FilterNode, el: unknown): unknown {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'identifier':
      if (node.name === 'el') return el;
      return undefined;
    case 'access': {
      const obj = evalNode(node.object!, el);
      if (obj == null || typeof obj !== 'object') return undefined;
      return (obj as Record<string, unknown>)[node.property!];
    }
    case 'index': {
      const obj = evalNode(node.object!, el);
      if (obj == null) return undefined;
      if (Array.isArray(obj) && typeof node.indexValue === 'number') {
        return obj[node.indexValue];
      }
      if (typeof obj === 'object') {
        return (obj as Record<string, unknown>)[String(node.indexValue)];
      }
      return undefined;
    }
    case 'unary': {
      const val = evalNode(node.operand!, el);
      if (node.op === '!') return !val;
      return undefined;
    }
    case 'binary': {
      const left = evalNode(node.left!, el);
      const right = evalNode(node.right!, el);
      switch (node.op) {
        case '==': return left == right; // eslint-disable-line eqeqeq
        case '!=': return left != right; // eslint-disable-line eqeqeq
        case '===': return left === right;
        case '!==': return left !== right;
        case '<': return (left as number) < (right as number);
        case '>': return (left as number) > (right as number);
        case '<=': return (left as number) <= (right as number);
        case '>=': return (left as number) >= (right as number);
        case '&&': return left && right;
        case '||': return left || right;
      }
      return undefined;
    }
  }
}

// ── applyQuery ──

export function applyQuery(value: unknown, query: InspectQuery): unknown {
  let result = value;

  if (query.path) {
    result = applyPath(result, query.path);
  }

  if (query.count) {
    if (Array.isArray(result)) return result.length;
    if (result instanceof Set) return result.size;
    if (result instanceof Map) return result.size;
    if (result !== null && typeof result === 'object') return Object.keys(result as object).length;
    return 0;
  }

  if (query.keys) {
    if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
      return Object.keys(result as object);
    }
    return [];
  }

  if (query.filter && Array.isArray(result)) {
    const filterNode = parseFilterExpression(query.filter);
    result = (result as unknown[]).filter((el) => evalFilter(filterNode, el));
  }

  if (query.search !== undefined && Array.isArray(result)) {
    const term = String(query.search).toLowerCase();
    result = (result as unknown[]).filter((el) => {
      return JSON.stringify(el).toLowerCase().includes(term);
    });
  }

  if (query.slice && Array.isArray(result)) {
    const [start, end] = query.slice;
    result = (result as unknown[]).slice(start, end);
  }

  if (query.sample !== undefined && Array.isArray(result)) {
    result = sampleArray(result as unknown[], query.sample);
  }

  return result;
}

function applyPath(value: unknown, path: string): unknown {
  const parts = parsePath(path);
  let current = value;
  for (const part of parts) {
    if (current == null) return undefined;
    if (typeof part === 'number') {
      current = Array.isArray(current) ? (current as unknown[])[part] : undefined;
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }
  return current;
}

function parsePath(path: string): (string | number)[] {
  const parts: (string | number)[] = [];
  const re = /(\w+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) parts.push(m[1]);
    else if (m[2] !== undefined) parts.push(parseInt(m[2], 10));
  }
  return parts;
}

function sampleArray(arr: unknown[], n: number): unknown[] {
  if (arr.length <= n) return arr;
  const result: unknown[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    result.push(arr[Math.round(i * step)]);
  }
  return result;
}

// ── parseInspectArgNames ──

export function parseInspectArgNames(source: string): string[] {
  const sf = ts.createSourceFile(
    '_inspect.ts',
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  let callExpr: ts.CallExpression | null = null;

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'inspect'
    ) {
      callExpr = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);

  if (!callExpr) return [];

  const args = (callExpr as ts.CallExpression).arguments;
  const names: string[] = [];

  for (const arg of args) {
    if (ts.isArrayLiteralExpression(arg)) {
      // [value, query] tuple — first element is the actual value
      if (arg.elements.length > 0) {
        names.push(getArgName(arg.elements[0], source));
      }
    } else {
      names.push(getArgName(arg, source));
    }
  }

  return names;
}

function getArgName(node: ts.Expression, source: string): string {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  // For complex expressions, return the source text
  return source.slice(node.getStart(), node.getEnd());
}

// ── InspectArg + InspectCall ──

export interface InspectArg {
  name: string;
  value: unknown;
  query?: InspectQuery;
}

export interface InspectCall {
  args: InspectArg[];
  timeout: number;
}

// ── InspectSignal ──

export class InspectSignal extends Error {
  readonly call: InspectCall;

  constructor(call: InspectCall) {
    super('inspect()');
    this.name = 'InspectSignal';
    this.call = call;
  }
}

// ── Tuple detection ──

const INSPECT_QUERY_KEYS = new Set(['path', 'slice', 'depth', 'filter', 'sample', 'keys', 'count', 'search']);

/**
 * Returns true only if `raw` looks like an explicit `[value, InspectQuery]` tuple
 * (exactly 2 elements, second is an object with only InspectQuery fields).
 * Bare arrays like `["url1", "url2"]` must NOT be treated as tuples.
 */
function isInspectTuple(raw: unknown[]): boolean {
  if (raw.length !== 2) return false;
  const second = raw[1];
  if (second === null || typeof second !== 'object' || Array.isArray(second)) return false;
  const keys = Object.keys(second as object);
  return keys.length > 0 && keys.every((k) => INSPECT_QUERY_KEYS.has(k));
}

// ── registerInspectGlobals ──

export function registerInspectGlobals(
  ctx: QuickJSAsyncContext,
  opts: {
    budget: BudgetTracker;
    trace: TraceWriter;
    onInspect: (call: InspectCall) => void;
  },
): void {
  let pendingCall: InspectCall | null = null;

  // __inspectSetOptions — updates timeout on the pending call
  const setOptionsFn = ctx.newFunction('__inspectSetOptions', (optsHandle: QuickJSHandle) => {
    if (!pendingCall) return ctx.undefined;
    const optsVal = marshalToHost(ctx, optsHandle) as { timeout?: number } | null;
    if (optsVal && typeof optsVal.timeout === 'number') {
      pendingCall.timeout = optsVal.timeout;
    }
    return ctx.undefined;
  });
  ctx.setProp(ctx.global, '__inspectSetOptions', setOptionsFn);
  setOptionsFn.dispose();

  // inject the InspectBuilder constructor into QuickJS
  const builderCode = `
var __InspectBuilder = function() {};
__InspectBuilder.prototype.options = function(opts) {
  if (typeof __inspectSetOptions === 'function') __inspectSetOptions(opts);
  return this;
};
`;
  const res = ctx.evalCode(builderCode, '__inspect-builder.js');
  if ('error' in res && res.error !== undefined) {
    res.error.dispose();
  } else if ('value' in res && res.value !== undefined) {
    res.value.dispose();
  }

  // inspect() host function
  const inspectFn = ctx.newFunction('inspect', (...argHandles: QuickJSHandle[]) => {
    const args: InspectArg[] = [];
    for (const handle of argHandles) {
      const raw = marshalToHost(ctx, handle);
      if (Array.isArray(raw) && isInspectTuple(raw)) {
        const [value, query] = raw as [unknown, InspectQuery | undefined];
        args.push({ name: '', value, query });
      } else {
        args.push({ name: '', value: raw });
      }
    }

    const call: InspectCall = { args, timeout: 30000 };
    pendingCall = call;
    opts.onInspect(call);
    opts.trace.write({ type: 'inspect', argCount: args.length });

    // Return InspectBuilder from QuickJS global
    const builderResult = ctx.evalCode('new __InspectBuilder()', '_ib.js');
    if ('value' in builderResult && builderResult.value !== undefined) {
      return builderResult.value;
    }
    if ('error' in builderResult && builderResult.error !== undefined) {
      builderResult.error.dispose();
    }
    return ctx.undefined;
  });
  ctx.setProp(ctx.global, 'inspect', inspectFn);
  inspectFn.dispose();

  // budget() host function — sync, returns current snapshot
  const budgetFn = ctx.newFunction('budget', () => {
    const snap = opts.budget.snapshot();
    return marshalToQuickJS(ctx, snap as unknown as Record<string, unknown>);
  });
  ctx.setProp(ctx.global, 'budget', budgetFn);
  budgetFn.dispose();
}

// ── Preview serializer (re-exported) ──
export { previewSerialize, type PreviewLimits } from "./serialize.js";

// ── Source AST name recovery for inspect args ──
export { extractInspectArgNames, type InspectCallNames } from "./extract-names.js";
