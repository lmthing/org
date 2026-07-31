import ts from 'typescript';

/**
 * The missing-`await` lint — write-time feedback for the one model mistake this
 * runtime cannot recover cleanly.
 *
 * Value-yielding globals register their yield at CALL time (`exec/bootstrap.ts`'s
 * `pushYield`), so `const r = ask("q");` — no `await` — still suspends the turn and
 * the host still resolves the value correctly. What the binding holds, though, is the
 * QuickJS **Promise object**: reading it back tells the model the tool "returned
 * nothing" (`{}`), or takes the turn down outright (`getVar`'s dump consumes a promise
 * handle — see `turn-loop.ts#bindYieldResults`). Typecheck alone cannot catch it: only
 * a property ACCESS on the `Promise<T>`-typed binding errors — `display(r)`,
 * `JSON.stringify(r)` and passing `r` onward all typecheck clean.
 *
 * So the statement is failed BEFORE it evaluates, with a one-line fix the model can
 * apply verbatim (per the project's "catch faults in the WRITER" directive). The
 * runtime-side binding rule in `turn-loop.ts#bindYieldResults` is the safety net for
 * every shape this deliberately does not flag.
 */

/** A lint verdict: the offending global plus the model-facing message. */
export interface AwaitLintFinding {
  /** The yielding global that was called without `await`. */
  name: string;
  /** One-line, model-facing: names the exact fix. */
  message: string;
}

/**
 * The set of names a missing `await` can hurt, derived from the ambient DTS the VM
 * was built with — NOT a hardcoded list.
 *
 * `buildAmbientDts` (`exec/bootstrap.ts`) composes that DTS from the per-capability
 * fragments in `typecheck/library-dts.ts`, emitting a declaration exactly where the
 * matching global is injected ("not granted ⇒ not injected AND absent from the DTS").
 * Every value-yielding global is declared `Promise<…>`-returning there, and every
 * fire-and-forget/synchronous one (`display`, `setActivity`, `writeProject*`,
 * `execShell`, …) is not — so "declared function returning a Promise, in THIS
 * context's DTS" is the same set the bootstrap gated, per context, for free. The
 * function-overlay's own `async` space functions (`typecheck/overlay.ts`) join it on
 * the same terms, which is correct: their result is a Promise too.
 */
export function yieldingGlobalNames(ambientDts: string): Set<string> {
  const names = new Set<string>();
  if (!ambientDts) return names;
  const sf = ts.createSourceFile('__ambient__.d.ts', ambientDts, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && returnsPromise(node.type)) {
      names.add(node.name.text);
    }
    // Declarations nested in a `declare namespace`/`declare module` block are not
    // callable as bare globals — only the top level and module blocks are walked.
    if (ts.isModuleDeclaration(node) || ts.isModuleBlock(node)) return;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return names;
}

function returnsPromise(type: ts.TypeNode | undefined): boolean {
  return (
    !!type &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === 'Promise'
  );
}

const COMBINATORS = new Set(['all', 'allSettled', 'race', 'any']);

/** `Promise.all(…)` / `allSettled` / `race` / `any` — a call whose arguments are a
 *  legal home for an un-awaited yielding call. */
function isPromiseCombinator(callee: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'Promise' &&
    COMBINATORS.has(callee.name.text)
  );
}

/** Expression wrappers that keep a value in the same binding position. */
function isTransparent(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  );
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/**
 * Is this call's result already handled as a promise? True when an ancestor is an
 * `await`, a `.then/.catch/.finally` chain, or a `Promise.all/allSettled/race/any`
 * argument — and also when the call sits inside a NESTED function, where the awaiting
 * happens (or does not) somewhere this lint cannot see. `await Promise.all(items.map(
 * (x) => fork(x)))` clears on the first rule alone; a bare `items.map((x) => fork(x))`
 * clears on the last, deliberately (see the "not flagged" list on {@link
 * lintMissingAwait}).
 */
function isHandled(call: ts.CallExpression): boolean {
  let child: ts.Node = call;
  let parent: ts.Node | undefined = call.parent;
  while (parent) {
    if (ts.isAwaitExpression(parent)) return true;
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === child &&
      (parent.name.text === 'then' || parent.name.text === 'catch' || parent.name.text === 'finally')
    ) {
      return true;
    }
    if (ts.isCallExpression(parent) && isPromiseCombinator(parent.expression)) return true;
    if (isFunctionLike(parent)) return true;
    if (ts.isReturnStatement(parent) || ts.isYieldExpression(parent)) return true;
    child = parent;
    parent = parent.parent;
  }
  return false;
}

/**
 * The name this call's value is BOUND to, if it is bound at all: the initializer of a
 * variable declaration or the right-hand side of an assignment (through parentheses /
 * `as` / `!`). `null` for every other position.
 *
 * Binding is what makes a missing `await` destructive — the bound name is what the
 * model reads back as `{}` in VARIABLES. A bare `inspect(x);` or a yielding call passed
 * as an argument (`display(await summarize(ask("q")))`) binds nothing here, so it is
 * left alone.
 */
function boundName(call: ts.CallExpression): string | null {
  let child: ts.Node = call;
  let parent: ts.Node | undefined = call.parent;
  while (parent && isTransparent(parent)) {
    child = parent;
    parent = parent.parent;
  }
  if (!parent) return null;
  if (ts.isVariableDeclaration(parent) && parent.initializer === child) {
    return ts.isIdentifier(parent.name) ? parent.name.text : 'r';
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === child
  ) {
    return ts.isIdentifier(parent.left) ? parent.left.text : 'r';
  }
  return null;
}

/**
 * Flag a statement that BINDS the result of a value-yielding call without `await`.
 *
 * Deliberately NOT flagged (the binding rule in `bindYieldResults` covers these; a
 * false positive costs the model a whole retry on code that would have worked):
 *   - anything under `await`, `.then/.catch/.finally`, or inside
 *     `Promise.all/allSettled/race/any(…)` — including
 *     `await Promise.all(items.map((x) => fork(x)))`;
 *   - a call inside a nested function (`items.map((x) => webSearch(x))`), where the
 *     await may legitimately live at the call site of that function;
 *   - an un-bound call (`inspect(x);`) or one passed as an argument to another call —
 *     no binding, so nothing shows up as `{}` in VARIABLES;
 *   - `return`ed / `yield`ed values.
 *
 * Returns the FIRST finding in source order, or `null` when the statement is clean.
 */
export function lintMissingAwait(statement: string, yielding: ReadonlySet<string>): AwaitLintFinding | null {
  if (yielding.size === 0 || !statement.trim()) return null;
  // Cheap pre-filter: no `(` ⇒ no call site to flag.
  if (!statement.includes('(')) return null;
  const sf = ts.createSourceFile('__stmt__.tsx', statement, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);

  let finding: AwaitLintFinding | null = null;
  const visit = (node: ts.Node): void => {
    if (finding) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && yielding.has(node.expression.text)) {
      const name = node.expression.text;
      const bound = boundName(node);
      if (bound !== null && !isHandled(node)) {
        finding = { name, message: missingAwaitMessage(name, bound) };
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return finding;
}

/** The model-facing one-liner. Names the call AND spells out the corrected statement,
 *  so the retry is a copy of the fix rather than a guess. */
export function missingAwaitMessage(name: string, bound: string): string {
  return (
    `\`${name}(...)\` must be awaited: \`const ${bound} = await ${name}(...)\` — ` +
    `${name}() returns a Promise, so without \`await\` \`${bound}\` holds the Promise object ` +
    `(it shows up as {} in VARIABLES), never the value.`
  );
}
