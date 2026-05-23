/**
 * Recover source-level argument names from the LAST `inspect(...)` call in
 * a TypeScript source string.
 *
 * The runtime InspectEngine can only see the marshaled values inside QuickJS,
 * not the call-site identifiers — names must be reconstructed from the
 * emitted source. The CLI calls this after the cycle's stream completes
 * and merges the names into the captured InspectCall args.
 *
 * Rules per argument:
 *   - `varName`                → name = "varName"
 *   - `[varName, { ... }]`     → name = "varName"  (query tuple)
 *   - `[expr, { ... }]` where expr is not a bare identifier → name = "" (anonymous)
 *   - `expr` (any other expression) → name = ""  (let the CLI fall back to "argN")
 *
 * Returns one entry per argument, in source order.
 */

import ts from 'typescript';

export interface InspectCallNames {
  /** Argument names in source order. Empty string for non-identifier expressions. */
  names: string[];
  /** Whether a chained `.options({...})` call was present. */
  hasOptions: boolean;
}

export function extractInspectArgNames(source: string): InspectCallNames | null {
  const sf = ts.createSourceFile('inline.ts', source, ts.ScriptTarget.ES2022, true);

  let last: ts.CallExpression | null = null;

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      // Match `inspect(...)` directly OR `inspect(...).options({...})`
      const target = unwrapOptions(node);
      if (ts.isIdentifier(target.expression) && target.expression.text === 'inspect') {
        last = target;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (!last) return null;

  // TypeScript's narrowing inside the closure forgets that we re-assigned `last`;
  // assert non-null after the visit.
  const call = last as unknown as ts.CallExpression;
  const names = call.arguments.map((arg): string => {
    if (ts.isIdentifier(arg)) return arg.text;
    if (ts.isArrayLiteralExpression(arg) && arg.elements.length >= 1) {
      const first = arg.elements[0]!;
      if (ts.isIdentifier(first)) return first.text;
      // could also be a property access like excerpts[0].text — name by source
      return first.getText(sf);
    }
    return arg.getText(sf);
  });

  // Detect chained .options(...)
  const original = last as unknown as ts.CallExpression;
  const hasOptions = original.parent && ts.isPropertyAccessExpression(original.parent)
    && original.parent.name.text === 'options'
    && ts.isCallExpression(original.parent.parent)
    || false;

  return { names, hasOptions };
}

function unwrapOptions(node: ts.CallExpression): ts.CallExpression {
  // If this is `inspect(...).options({...})`, the OUTER call is .options;
  // the inner inspect call is one level down through PropertyAccessExpression.
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'options' &&
    ts.isCallExpression(node.expression.expression)
  ) {
    return node.expression.expression;
  }
  return node;
}
